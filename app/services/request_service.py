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


# ---------------------------------------------------------------------------
# Единый конечный автомат переходов заявки.
#
# transition() централизует ОБЩУЮ механику любого перехода статуса заявки:
#   1. блокировка строки FOR UPDATE (защита от гонок двойной обработки),
#   2. валидация исходного статуса по декларативной карте ALLOWED_TRANSITIONS,
#   3. guard «помечена на удаление»,
#   4. мутация approval_status,
#   5. ОДНА запись AuditLog (actor + человекочитаемый summary),
#   6. один commit,
#   7. fan-out уведомлений нужным получателям (актор себя не уведомляет).
#
# Бесповедочные (per-action) различия — доп. поля (special_order, gate_*,
# is_budgeted, rejection_reason, payment_date, contract_status), точный текст
# summary/уведомления, тип уведомления и список получателей — задаёт небольшой
# per-action handler в _TRANSITION_HANDLERS, который ВЫЗЫВАЕТСЯ под блокировкой,
# мутирует доп. поля req и возвращает TransitionResult.
# ---------------------------------------------------------------------------

# Декларативная карта: action -> {"from": {допустимые ApprovalStatus}|None, "to": ApprovalStatus|None}.
# from=None  -> исходный статус не проверяется (set_contract / set_special_order).
# to=None    -> целевой статус определяет сам handler (submit -> PENDING|PENDING_GATE;
#               set_budget -> MEMO_REQUIRED|PENDING|без изменения).
ALLOWED_TRANSITIONS: dict = {
    "submit":         {"from": {ApprovalStatus.DRAFT, ApprovalStatus.CLARIFICATION, ApprovalStatus.POSTPONED}, "to": None},
    "approve_gate":   {"from": {ApprovalStatus.PENDING_GATE}, "to": ApprovalStatus.PENDING},
    "reject_gate":    {"from": {ApprovalStatus.PENDING_GATE}, "to": ApprovalStatus.REJECTED},
    "set_contract":   {"from": None, "to": None},
    "approve_memo":   {"from": {ApprovalStatus.PENDING_MEMO}, "to": ApprovalStatus.PENDING},
    "reject_memo":    {"from": {ApprovalStatus.PENDING_MEMO}, "to": ApprovalStatus.REJECTED},
    "memo_reason":    {"from": {ApprovalStatus.MEMO_REQUIRED}, "to": ApprovalStatus.PENDING_MEMO},
    "cancel_memo":    {"from": {ApprovalStatus.MEMO_REQUIRED}, "to": ApprovalStatus.REJECTED},
    "move_to_draft":  {"from": {ApprovalStatus.MEMO_REQUIRED, ApprovalStatus.PENDING_MEMO, ApprovalStatus.POSTPONED}, "to": ApprovalStatus.DRAFT},
    "set_budget":     {"from": None, "to": None},
    "set_special_order": {"from": None, "to": None},
    "suspend":        {"from": {ApprovalStatus.PENDING, ApprovalStatus.APPROVED}, "to": ApprovalStatus.SUSPENDED},
    "unsuspend":      {"from": {ApprovalStatus.SUSPENDED}, "to": ApprovalStatus.PENDING},
    "postpone":       {"from": None, "to": ApprovalStatus.POSTPONED},
}

# Сообщения guard'а исходного статуса — ТОЧНО как в прежнем inline-коде каждого
# эндпоинта (детали 400-ответа должны остаться байт-идентичными).
_SOURCE_GUARD_DETAIL: dict = {
    "submit":        None,  # формируется динамически с текущим статусом
    "approve_gate":  "Заявка не ожидает разрешения шлюза",
    "reject_gate":   "Заявка не ожидает разрешения шлюза",
    "approve_memo":  "Заявка не ожидает согласования по бюджету",
    "reject_memo":   "Заявка не ожидает согласования по бюджету",
    "memo_reason":   "Заявка не ожидает обоснования вне бюджета",
    "cancel_memo":   "Отменить можно только заявку, ожидающую обоснования вне бюджета",
    "move_to_draft": "Перенос доступен только для заявок в статусе 'Вне бюджета' или 'Перенесено'",
    "suspend":       "Отложить можно только заявку на согласовании или согласованную заявку",
    "unsuspend":     "Заявка не отложена",
}


class TransitionResult:
    """Результат per-action handler'а: что писать в аудит и кому слать уведомления.

    audit_action  — строка action для AuditLog (SUBMIT / APPROVE_GATE / ...).
    summary       — человекочитаемый текст (он же текст уведомления и audit.summary).
    audit_extra   — доп. поля в changes (old/new/is_budgeted и т.п.).
    notif_type    — код типа уведомления (SUBMITTED / GATE_APPROVED / ...), либо None.
    notif_recipients — список UUID получателей, либо None если рассылки нет.
    """
    __slots__ = ("audit_action", "summary", "audit_extra", "notif_type", "notif_recipients")

    def __init__(self, audit_action, summary, audit_extra=None, notif_type=None, notif_recipients=None):
        self.audit_action = audit_action
        self.summary = summary
        self.audit_extra = audit_extra or {}
        self.notif_type = notif_type
        self.notif_recipients = notif_recipients


def _old_status_str(req: PaymentRequest) -> str:
    s = req.approval_status
    return s.value if isinstance(s, ApprovalStatus) else str(s)


# --- per-action handlers ----------------------------------------------------
# Каждый handler ВЫЗЫВАЕТСЯ под блокировкой, ПОСЛЕ guard'ов, но ДО мутации
# approval_status единым автоматом. Handler сам:
#   * выставляет approval_status (т.к. целевой статус бывает динамическим),
#   * мутирует бесповедочные поля,
#   * пишет/чистит rejection_reason,
#   * возвращает TransitionResult (или None — тогда ни аудита, ни рассылки,
#     ни смены статуса автоматом: используется для no-op-ветки set_budget).

async def _h_submit(db, req, actor, kwargs) -> TransitionResult:
    old_status = _old_status_str(req)
    # Бесповедочный pre-flight: проверки даты и шлюза выполняет ЭНДПОИНТ и
    # передаёт результат сюда (gate_allowed / gate_reason), т.к. get_gate_preview
    # живёт в слое эндпоинта. Поведение и тексты сохранены 1:1.
    gate_allowed = kwargs["gate_allowed"]
    gate_reason = kwargs.get("gate_reason")
    if not gate_allowed:
        req.approval_status = ApprovalStatus.PENDING_GATE
        req.gate_reason = gate_reason
        summary = f"{request_title(req)}: подана на разрешение шлюза (исключение из регламента). {req.counterparty}, {req.amount:,.0f} ₽."
        recipients = await notif_svc.get_active_users_with_permission(db, "gate_approve")
        return TransitionResult("SUBMIT_GATE", summary,
                                {"old": old_status, "new": "PENDING_GATE"},
                                "SUBMITTED", recipients)
    req.approval_status = ApprovalStatus.PENDING
    summary = f"{request_title(req)}: подана на согласование ФЭО. {req.counterparty}, {req.amount:,.0f} ₽."
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    return TransitionResult("SUBMIT", summary,
                            {"old": old_status, "new": "PENDING"},
                            "SUBMITTED", recipients)


async def _h_approve_gate(db, req, actor, kwargs) -> TransitionResult:
    req.approval_status = ApprovalStatus.PENDING
    req.special_order = True
    req.gate_approved_by = actor.id
    req.gate_reason = kwargs.get("reason") or req.gate_reason
    summary = f"{request_title(req)}: разрешён экстренный платёж (шлюз). {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    return TransitionResult("APPROVE_GATE", summary,
                            {"old": "PENDING_GATE", "new": "PENDING"},
                            "GATE_APPROVED", recipients)


async def _h_reject_gate(db, req, actor, kwargs) -> TransitionResult:
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = kwargs.get("reason")
    summary = f"{request_title(req)}: запрос на экстренный платёж отклонён ФЭО. Причина: {kwargs.get('reason') or '—'}"
    return TransitionResult("REJECT_GATE", summary,
                            {"old": "PENDING_GATE", "new": "REJECTED"},
                            "GATE_REJECTED", [req.creator_id])


async def _h_set_contract(db, req, actor, kwargs) -> TransitionResult:
    old_contract = req.contract_status
    req.contract_status = kwargs.get("contract_status", req.contract_status)
    contract_label = {True: "Да", False: "Нет", None: "—"}.get(req.contract_status, str(req.contract_status))
    summary = f"{request_title(req)}: статус договора изменён на «{contract_label}»."
    return TransitionResult("SET_CONTRACT", summary,
                            {"old": str(old_contract), "new": str(req.contract_status)},
                            None, None)


async def _h_approve_memo(db, req, actor, kwargs) -> TransitionResult:
    req.approval_status = ApprovalStatus.PENDING
    summary = f"{request_title(req)}: внебюджетный платёж утверждён директором. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    return TransitionResult("APPROVE_MEMO", summary,
                            {"old": "PENDING_MEMO", "new": "PENDING"},
                            "MEMO_APPROVED", recipients)


async def _h_reject_memo(db, req, actor, kwargs) -> TransitionResult:
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = kwargs.get("reason")
    summary = f"{request_title(req)}: внебюджетный платёж не утверждён. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {kwargs.get('reason') or '—'}"
    return TransitionResult("REJECT_MEMO", summary,
                            {"old": "PENDING_MEMO", "new": "REJECTED"},
                            "REJECTED", [req.creator_id])


async def _h_memo_reason(db, req, actor, kwargs) -> TransitionResult:
    # Проверка непустоты — ПОСЛЕ guard'а исходного статуса (как в прежнем
    # inline-коде: сначала «не ожидает обоснования», затем «укажите обоснование»).
    reason = kwargs.get("reason")
    if not reason or not reason.strip():
        raise HTTPException(status_code=400, detail="Укажите обоснование вне бюджета")
    req.rejection_reason = reason.strip()
    req.approval_status = ApprovalStatus.PENDING_MEMO
    summary = f"{request_title(req)}: добавлено обоснование вне бюджета. {req.counterparty}, {req.amount:,.0f} ₽."
    recipients = await notif_svc.get_active_users_with_permission(db, "memo_approve")
    return TransitionResult("MEMO_REASON", summary,
                            {"old": "MEMO_REQUIRED", "new": "PENDING_MEMO"},
                            "OFF_BUDGET", recipients)


async def _h_cancel_memo(db, req, actor, kwargs) -> TransitionResult:
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = kwargs.get("reason") or "Отменена инициатором"
    summary = f"{request_title(req)}: отменена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {req.rejection_reason}"
    return TransitionResult("CANCEL_MEMO", summary,
                            {"old": "MEMO_REQUIRED", "new": "REJECTED"},
                            "REJECTED", [req.creator_id])


async def _h_move_to_draft(db, req, actor, kwargs) -> TransitionResult:
    from datetime import date as date_type
    old_status = _old_status_str(req)
    old_date = req.payment_date
    new_date = kwargs.get("payment_date")
    if new_date:
        req.payment_date = date_type.fromisoformat(new_date)
    if req.approval_status in {ApprovalStatus.MEMO_REQUIRED, ApprovalStatus.PENDING_MEMO}:
        req.is_budgeted = None
        req.rejection_reason = None
    req.approval_status = ApprovalStatus.DRAFT
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    summary = f"{request_title(req)}: инициатор перенёс дату с {old_str} на {new_str}. {req.counterparty}, {req.amount:,.0f} ₽"
    return TransitionResult("MOVE_TO_DRAFT", summary,
                            {"old": old_status, "new": "DRAFT"},
                            "RESCHEDULED", [req.creator_id])


async def _h_set_budget(db, req, actor, kwargs):
    new_value = kwargs.get("is_budgeted", req.is_budgeted)
    req.is_budgeted = new_value
    if new_value is False and req.approval_status == ApprovalStatus.PENDING:
        req.approval_status = ApprovalStatus.MEMO_REQUIRED
        req.rejection_reason = None
        summary = f"{request_title(req)}: требуется обоснование вне бюджета. {req.counterparty}, {req.amount:,.0f} ₽."
        return TransitionResult("SET_BUDGET", summary,
                                {"old": "PENDING", "new": "MEMO_REQUIRED", "is_budgeted": False},
                                "OFF_BUDGET", [req.creator_id])
    elif new_value is True and req.approval_status == ApprovalStatus.MEMO_REQUIRED:
        req.approval_status = ApprovalStatus.PENDING
        req.rejection_reason = None
        summary = f"{request_title(req)}: подтверждено наличие в бюджете. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
        recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
        return TransitionResult("SET_BUDGET", summary,
                                {"old": "MEMO_REQUIRED", "new": "PENDING", "is_budgeted": True},
                                "SUBMITTED", recipients)
    # No-op ветка: is_budgeted выставлен, но статус не меняется — ни аудита, ни
    # уведомления (как в прежнем inline-коде: просто commit).
    return None


async def _h_set_special_order(db, req, actor, kwargs) -> TransitionResult:
    old_special = req.special_order
    req.special_order = kwargs.get("special_order", req.special_order)
    summary = f"{request_title(req)}: спецраспоряжение {'установлено' if req.special_order else 'снято'}."
    return TransitionResult("SET_SPECIAL_ORDER", summary,
                            {"old": str(old_special), "new": str(req.special_order)},
                            None, None)


async def _h_suspend(db, req, actor, kwargs) -> TransitionResult:
    old_status = _old_status_str(req)
    req.approval_status = ApprovalStatus.SUSPENDED
    req.rejection_reason = kwargs.get("reason")
    summary = f"{request_title(req)}: отложена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {kwargs.get('reason') or '—'}"
    return TransitionResult("SUSPEND", summary,
                            {"old": old_status, "new": "SUSPENDED"},
                            "SUSPENDED", [req.creator_id])


async def _h_unsuspend(db, req, actor, kwargs) -> TransitionResult:
    from datetime import date as date_type
    old_date = req.payment_date
    new_date_str = kwargs.get("payment_date")
    if new_date_str:
        req.payment_date = date_type.fromisoformat(new_date_str)
    req.special_order = False
    req.approval_status = ApprovalStatus.PENDING
    req.rejection_reason = None
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    summary = f"{request_title(req)}: перенесена с {old_str} на {new_str}. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование."
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    return TransitionResult("UNSUSPEND", summary,
                            {"old": "SUSPENDED", "new": "PENDING"},
                            "RESCHEDULED", recipients)


async def _h_postpone(db, req, actor, kwargs) -> TransitionResult:
    from datetime import date as date_type
    old_status = _old_status_str(req)
    old_date = req.payment_date
    payment_date = kwargs.get("payment_date")
    if payment_date:
        req.payment_date = date_type.fromisoformat(payment_date)
    req.approval_status = ApprovalStatus.POSTPONED
    req.rejection_reason = kwargs.get("reason")
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    date_info = f"с {old_str} на {new_str}" if payment_date else f"(дата оплаты: {old_str})"
    summary = f"{request_title(req)}: перенесена {date_info}. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {kwargs.get('reason') or '—'}"
    return TransitionResult("POSTPONE", summary,
                            {"old": old_status, "new": "POSTPONED"},
                            "POSTPONED", [req.creator_id])


_TRANSITION_HANDLERS = {
    "submit":            _h_submit,
    "approve_gate":      _h_approve_gate,
    "reject_gate":       _h_reject_gate,
    "set_contract":      _h_set_contract,
    "approve_memo":      _h_approve_memo,
    "reject_memo":       _h_reject_memo,
    "memo_reason":       _h_memo_reason,
    "cancel_memo":       _h_cancel_memo,
    "move_to_draft":     _h_move_to_draft,
    "set_budget":        _h_set_budget,
    "set_special_order": _h_set_special_order,
    "suspend":           _h_suspend,
    "unsuspend":         _h_unsuspend,
    "postpone":          _h_postpone,
}


async def transition(
    db: AsyncSession,
    request_id: UUID,
    action: str,
    actor: User,
    **kwargs,
) -> PaymentRequest:
    """Единая точка выполнения перехода статуса заявки.

    Централизует: блокировку строки, проверку исходного статуса по
    ALLOWED_TRANSITIONS, guard «помечена на удаление», единый AuditLog, commit
    и рассылку уведомлений. Бесповедочные поля и тексты задаёт per-action handler.

    Scope-проверки (assert_can_view_request / creator-or-edit_all) остаются на
    эндпоинте — у разных действий разные правила видимости, специально не
    унифицируются (см. NB в approve_memo/reject_memo).
    """
    spec = ALLOWED_TRANSITIONS[action]
    handler = _TRANSITION_HANDLERS[action]

    # 1. Блокировка строки на время транзакции (защита от гонок).
    await _lock_request_for_update(db, request_id)
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    # 2. Guard «помечена на удаление» (после загрузки/блокировки).
    # ВАЖНО: текст 1:1 совпадает с эндпоинтным _ensure_not_marked (с суффиксом
    # «Снимите пометку…»), т.к. ВСЕ inline-переходы раньше использовали именно его.
    # (update_request_status/update_payment_status сохраняют свой короткий текст.)
    if req.is_marked_for_deletion:
        raise HTTPException(status_code=400, detail="Заявка помечена на удаление — действие недоступно. Снимите пометку, чтобы продолжить.")

    # 3. Валидация исходного статуса по декларативной карте.
    allowed_from = spec["from"]
    if allowed_from is not None and req.approval_status not in allowed_from:
        if action == "submit":
            detail = f"Нельзя отправить заявку со статусом «{req.approval_status}»"
        else:
            detail = _SOURCE_GUARD_DETAIL[action]
        raise HTTPException(status_code=400, detail=detail)

    # 4. Per-action handler: мутирует доп. поля + approval_status, возвращает
    #    что писать в аудит и кому слать уведомления (или None — no-op).
    result = await handler(db, req, actor, kwargs)
    if result is None:
        # No-op ветка (set_budget без смены статуса): только commit.
        await db.commit()
        return await get_request_by_id(db, request_id)

    # 5. Единый AuditLog (actor + summary).
    write_audit(db, req, result.audit_action, actor, result.summary, extra=result.audit_extra)

    # 6. Fan-out уведомлений (актор себя не уведомляет).
    if result.notif_type and result.notif_recipients is not None:
        await notif_svc.fan_out_notification(
            db, result.notif_recipients, result.summary, result.notif_type,
            request_id=req.id, exclude_user_id=actor.id if actor else None,
        )

    # 7. Один commit.
    await db.commit()
    return await get_request_by_id(db, request_id)


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
