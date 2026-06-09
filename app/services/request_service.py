from datetime import datetime, timezone, timedelta, date
from uuid import UUID
from typing import List, Optional, Sequence
from fastapi import HTTPException, status
from sqlalchemy import select, func, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.request import PaymentRequest, ApprovalStatus, PaymentStatus
from app.models.organization import Organization, Cluster
from app.models.direction import Direction, DirectionCategory
from app.models.budget import BudgetItem
from app.models.user import User
from app.models.audit import AuditLog
from app.models.notification import Notification
from app.schemas.request import RequestCreate, RequestUpdate
from app.services import notification_service as notif_svc
from sqlalchemy.orm import selectinload

def get_gmt3_time():
    """Возвращает текущее время по МСК (UTC+3)."""
    tz_moscow = timezone(timedelta(hours=3))
    return datetime.now(tz_moscow).replace(tzinfo=None)

def request_title(req: PaymentRequest) -> str:
    return f"Заявка № {req.request_number or str(req.id)[:8].upper()}"


def write_audit(db: AsyncSession, req: PaymentRequest, action: str, actor, summary: str, extra: Optional[dict] = None) -> None:
    """Добавляет запись AuditLog для перехода состояния заявки.

    summary — человекочитаемый текст (тот же, что и в уведомлении).
    extra — доп. поля для changes (например {"old": ..., "new": ...}).
    """
    changes: dict = {"summary": summary}
    if extra:
        changes.update(extra)
    db.add(AuditLog(
        user_id=actor.id if actor else None,
        entity_name="PaymentRequest",
        entity_id=req.id,
        action=action,
        changes=changes,
    ))

async def create_payment_request(db: AsyncSession, request_data: RequestCreate, user_id: UUID) -> PaymentRequest:
    """
    Создание черновика заявки. Шлюз не проверяется — черновик можно создать с любой датой.
    Проверка шлюза выполняется при отправке на согласование (DRAFT → PENDING).
    """
    # 4. Сохранение заявки
    new_request = PaymentRequest(
        **request_data.model_dump(),
        creator_id=user_id,
        approval_status=ApprovalStatus.DRAFT,
        payment_status=PaymentStatus.UNPAID,
    )

    # Генерация номера заявки (если у организации задан префикс)
    org = await db.get(Organization, request_data.organization_id)
    if org and org.prefix:
        today = date.today()
        date_part = today.strftime('%y%m%d')
        count = await db.scalar(
            select(func.count()).select_from(PaymentRequest).where(
                PaymentRequest.organization_id == request_data.organization_id,
                cast(PaymentRequest.created_at, Date) == today,
                PaymentRequest.request_number.is_not(None),
            )
        ) or 0
        new_request.request_number = f"{org.prefix}-{date_part}-{count + 1:02d}"

    db.add(new_request)
    await db.flush()

    # 5. Аудит
    audit_log = AuditLog(
        user_id=user_id,
        entity_name="PaymentRequest",
        entity_id=new_request.id,
        action="CREATE",
        changes={
            "amount": str(new_request.amount),
            "status": "DRAFT",
        }
    )
    db.add(audit_log)
    
    await db.commit()
    return await get_request_by_id(db, new_request.id)

def _with_relations():
    return [
        selectinload(PaymentRequest.organization),
        selectinload(PaymentRequest.direction).selectinload(Direction.category),
        selectinload(PaymentRequest.budget_item),
        selectinload(PaymentRequest.creator),
        selectinload(PaymentRequest.gate_approver),
    ]

async def get_my_requests(db: AsyncSession, user_id: UUID) -> Sequence[PaymentRequest]:
    result = await db.execute(
        select(PaymentRequest)
        .options(*_with_relations())
        .where(PaymentRequest.creator_id == user_id)
        .order_by(PaymentRequest.created_at.desc())
    )
    return result.scalars().all()

async def get_all_requests(
    db: AsyncSession,
    current_user: User,
    approval_status: Optional[ApprovalStatus] = None,
    payment_status: Optional[PaymentStatus] = None,
    organization_id: Optional[UUID] = None,
    direction_id: Optional[UUID] = None,
) -> Sequence[PaymentRequest]:
    query = select(PaymentRequest).options(*_with_relations()).order_by(PaymentRequest.created_at.desc())

    # RLS: определяем видимость по иерархии прав
    perms = {p.name for p in current_user.role.permissions} if current_user.role and current_user.role.permissions else set()
    is_god = bool(current_user.role and getattr(current_user.role, 'is_superadmin', False))

    if not is_god and "req_view_all" not in perms:
        if "req_view_cluster" in perms:
            # Организации в кластерах, где user — руководитель
            cluster_ids_q = select(Cluster.id).where(Cluster.head_id == current_user.id)
            org_ids_q = select(Organization.id).where(Organization.cluster_id.in_(cluster_ids_q))
            query = query.where(PaymentRequest.organization_id.in_(org_ids_q))
        elif "req_view_org" in perms:
            # Организации, где user — директор (один user → много org)
            org_ids_q = select(Organization.id).where(Organization.director_id == current_user.id)
            query = query.where(PaymentRequest.organization_id.in_(org_ids_q))
        elif "req_view_dept" in perms:
            query = query.where(PaymentRequest.direction_id == current_user.direction_id)
        else:
            # req_view_own — только свои
            query = query.where(PaymentRequest.creator_id == current_user.id)

    if approval_status:
        query = query.where(PaymentRequest.approval_status == approval_status)
    if payment_status:
        query = query.where(PaymentRequest.payment_status == payment_status)
    if organization_id:
        query = query.where(PaymentRequest.organization_id == organization_id)
    if direction_id:
        query = query.where(PaymentRequest.direction_id == direction_id)
    result = await db.execute(query)
    return result.scalars().all()

async def get_request_by_id(db: AsyncSession, request_id: UUID) -> Optional[PaymentRequest]:
    result = await db.execute(
        select(PaymentRequest)
        .options(*_with_relations())
        .where(PaymentRequest.id == request_id)
    )
    return result.scalars().first()


def _user_perms(user: User) -> set:
    """Множество кодов прав пользователя (без учёта superadmin)."""
    if user.role and user.role.permissions:
        return {p.name for p in user.role.permissions}
    return set()


async def user_can_view_request(db: AsyncSession, user: User, req: PaymentRequest) -> bool:
    """Может ли пользователь видеть конкретную заявку (object-level RLS).

    Реализует OR по ВСЕМ выданным областям видимости (в отличие от if/elif
    в списочной выборке): пользователь с несколькими областями получает их
    объединение, а не только «высшую».

    Эффективность: req.organization уже eager-loaded через _with_relations(),
    поэтому проверки org/dept/own не делают доп. запросов. Для проверки
    «руководитель кластера» нужен один маленький запрос head_id кластера
    организации (только если это право выдано и более ранние не прошли).
    """
    # superadmin / req_view_all → всё
    if user.role and getattr(user.role, "is_superadmin", False):
        return True
    perms = _user_perms(user)
    if "req_view_all" in perms:
        return True

    org = req.organization  # eager-loaded

    # req_view_org: пользователь — директор организации заявки
    if "req_view_org" in perms and org is not None and org.director_id == user.id:
        return True

    # req_view_dept: заявка относится к направлению (ЦФО) пользователя
    if "req_view_dept" in perms and user.direction_id is not None and req.direction_id == user.direction_id:
        return True

    # req_view_own: пользователь — автор заявки
    if "req_view_own" in perms and req.creator_id == user.id:
        return True

    # req_view_cluster: организация заявки в кластере, где пользователь — руководитель.
    # head_id кластера не eager-loaded → один точечный запрос (без N+1).
    if "req_view_cluster" in perms and org is not None and org.cluster_id is not None:
        head_id = await db.scalar(
            select(Cluster.head_id).where(Cluster.id == org.cluster_id)
        )
        if head_id == user.id:
            return True

    return False


async def assert_can_view_request(db: AsyncSession, user: User, req: PaymentRequest) -> None:
    """Бросает 403, если пользователь не может видеть заявку."""
    if not await user_can_view_request(db, user, req):
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")


# Допустимые исходные статусы для целевого статуса при согласовании.
# Применяется ко всем (включая суперадмина): недопустимые переходы состояний невозможны.
ALLOWED_FROM = {
    ApprovalStatus.APPROVED:      {ApprovalStatus.PENDING},
    ApprovalStatus.REJECTED:      {ApprovalStatus.PENDING, ApprovalStatus.CLARIFICATION},
    ApprovalStatus.CLARIFICATION: {ApprovalStatus.PENDING},
}


async def _lock_request_for_update(db: AsyncSession, request_id: UUID) -> PaymentRequest:
    """Загружает базовую строку PaymentRequest с блокировкой FOR UPDATE на время транзакции.

    Без selectinload — чтобы не было проблем FOR UPDATE + outer join.
    Бросает 404, если строки нет.
    """
    result = await db.execute(
        select(PaymentRequest)
        .where(PaymentRequest.id == request_id)
        .with_for_update()
    )
    locked = result.scalars().first()
    if not locked:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return locked

async def update_request(db: AsyncSession, request_id: UUID, data: RequestUpdate, user_id: UUID, bypass_owner: bool = False) -> PaymentRequest:
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.is_marked_for_deletion:
        raise HTTPException(status_code=400, detail="Заявка помечена на удаление — действие недоступно.")
    if req.approval_status != ApprovalStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Редактировать можно только черновики")
    if not bypass_owner and req.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Нельзя редактировать чужую заявку")
    changes = {}
    for field, value in data.model_dump(exclude_unset=True).items():
        old = getattr(req, field)
        if old != value:
            changes[field] = {"old": str(old), "new": str(value)}
            setattr(req, field, value)
    if changes:
        db.add(AuditLog(user_id=user_id, entity_name="PaymentRequest", entity_id=req.id, action="UPDATE", changes=changes))
    await db.commit()
    await db.refresh(req)
    return await get_request_by_id(db, request_id)

async def delete_request(db: AsyncSession, request_id: UUID, user_id: UUID) -> None:
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Удалять можно только черновики")
    if req.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Нельзя удалить чужую заявку")
    db.add(AuditLog(user_id=user_id, entity_name="PaymentRequest", entity_id=req.id, action="DELETE", changes={}))
    await db.delete(req)
    await db.commit()

async def update_request_status(
    db: AsyncSession, 
    request_id: UUID, 
    status: ApprovalStatus, 
    reason: Optional[str] = None,
    current_user: Optional[User] = None,
) -> PaymentRequest:
    """"""
    # Блокируем строку на время транзакции (защита от гонок двойной обработки).
    await _lock_request_for_update(db, request_id)
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    # Object-level RLS: актор должен иметь право ВИДЕТЬ заявку (в дополнение к
    # праву на действие, проверенному PermissionChecker на эндпоинте).
    if current_user is not None:
        await assert_can_view_request(db, current_user, req)
    if req.is_marked_for_deletion:
        raise HTTPException(status_code=400, detail="Заявка помечена на удаление — действие недоступно.")
    old_status = req.approval_status
    # Защита по исходному статусу: запрещаем недопустимые переходы состояний
    # (например, согласовать DRAFT в обход шлюза или повторно согласовать PAID/REJECTED).
    allowed_sources = ALLOWED_FROM.get(status)
    if allowed_sources is not None and old_status not in allowed_sources:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый переход из статуса «{old_status}» в «{status}»",
        )
    req.approval_status = status
    if reason:
        req.rejection_reason = reason

    # Человекочитаемый текст строим один раз — используем и в аудите, и в уведомлении.
    title = request_title(req)
    notif_map = {
        ApprovalStatus.APPROVED:      ("APPROVED",      f"{title}: согласована ФЭО. {req.counterparty}, {req.amount:,.0f} ₽."),
        ApprovalStatus.REJECTED:      ("REJECTED",      f"{title}: отклонена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {reason or '—'}"),
        ApprovalStatus.CLARIFICATION: ("CLARIFICATION", f"{title}: требуется уточнение. {req.counterparty}, {req.amount:,.0f} ₽. Комментарий: {reason or '—'}"),
    }
    summary = None
    notif_type = None
    if status in notif_map:
        notif_type, summary = notif_map[status]
        if current_user and status == ApprovalStatus.APPROVED:
            summary = f"{title}: согласована ФЭО ({current_user.full_name}). {req.counterparty}, {req.amount:,.0f} ₽."

    old_str = old_status.value if isinstance(old_status, ApprovalStatus) else str(old_status)
    new_str = status.value if isinstance(status, ApprovalStatus) else str(status)
    db.add(AuditLog(
        user_id=current_user.id if current_user else None,
        entity_name="PaymentRequest",
        entity_id=req.id,
        action="UPDATE_APPROVAL",
        changes={
            "summary": summary or f"Статус согласования: {old_str} → {new_str}",
            "old": old_str,
            "new": new_str,
        }
    ))

    # Уведомления-алерты ответственным ролям (актор себя не уведомляет)
    actor_id = current_user.id if current_user else None
    if status in notif_map and summary:
        if status == ApprovalStatus.APPROVED:
            # Инициатор + кассиры (теперь нужна оплата)
            recipients = [req.creator_id]
            recipients += await notif_svc.get_active_users_with_permission(db, "req_pay")
            await notif_svc.fan_out_notification(
                db, recipients, summary, notif_type,
                request_id=req.id, exclude_user_id=actor_id,
            )
        else:
            # REJECTED / CLARIFICATION → инициатор
            await notif_svc.fan_out_notification(
                db, [req.creator_id], summary, notif_type,
                request_id=req.id, exclude_user_id=actor_id,
            )

    await db.commit()
    await db.refresh(req)
    return req

async def update_payment_status(
    db: AsyncSession,
    request_id: UUID,
    status: PaymentStatus,
    current_user: Optional[User] = None,
) -> PaymentRequest:
    """"""
    # Блокируем строку на время транзакции (защита от гонок: два кассира оплачивают одну заявку).
    await _lock_request_for_update(db, request_id)
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    # Object-level RLS: актор должен иметь право ВИДЕТЬ заявку (в дополнение к
    # праву req_pay, проверенному PermissionChecker на эндпоинте).
    if current_user is not None:
        await assert_can_view_request(db, current_user, req)
    if req.is_marked_for_deletion:
        raise HTTPException(status_code=400, detail="Заявка помечена на удаление — действие недоступно.")
    # Повторная проверка под блокировкой.
    if req.payment_status == PaymentStatus.PAID:
        raise HTTPException(status_code=400, detail="Заявка уже оплачена")
    if req.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Оплатить можно только утверждённую заявку")
    old_status = req.payment_status
    req.payment_status = status

    # Человекочитаемый текст строим один раз — используем и в аудите, и в уведомлении.
    summary = None
    if status == PaymentStatus.PAID:
        actor = f" ({current_user.full_name})" if current_user else ""
        summary = f"{request_title(req)}: оплачена казначеем{actor}. {req.counterparty}, {req.amount:,.0f} ₽."

    old_str = old_status.value if isinstance(old_status, PaymentStatus) else str(old_status)
    new_str = status.value if isinstance(status, PaymentStatus) else str(status)
    db.add(AuditLog(
        user_id=current_user.id if current_user else None,
        entity_name="PaymentRequest",
        entity_id=req.id,
        action="UPDATE_PAYMENT",
        changes={
            "summary": summary or f"Статус оплаты: {old_str} → {new_str}",
            "old": old_str,
            "new": new_str,
        }
    ))
    if status == PaymentStatus.PAID and summary:
        # Алерт инициатору (актор-кассир себя не уведомляет)
        await notif_svc.fan_out_notification(
            db, [req.creator_id], summary, "PAID",
            request_id=req.id,
            exclude_user_id=current_user.id if current_user else None,
        )
    await db.commit()
    await db.refresh(req)
    return req

async def get_stats(db: AsyncSession) -> dict:
    """"""
    total = await db.execute(
        select(func.count(PaymentRequest.id)).where(PaymentRequest.is_marked_for_deletion == False)
    )
    approved = await db.execute(
        select(func.count(PaymentRequest.id)).where(
            PaymentRequest.approval_status == ApprovalStatus.APPROVED,
            PaymentRequest.is_marked_for_deletion == False,
        )
    )
    paid = await db.execute(
        select(func.count(PaymentRequest.id)).where(
            PaymentRequest.payment_status == PaymentStatus.PAID,
            PaymentRequest.is_marked_for_deletion == False,
        )
    )
    return {
        "total_requests": total.scalar() or 0,
        "approved_requests": approved.scalar() or 0,
        "paid_requests": paid.scalar() or 0
    }
