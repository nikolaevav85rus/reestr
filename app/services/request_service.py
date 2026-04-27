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
from sqlalchemy.orm import selectinload

def get_gmt3_time():
    """Возвращает текущее время по МСК (UTC+3)."""
    tz_moscow = timezone(timedelta(hours=3))
    return datetime.now(tz_moscow).replace(tzinfo=None)

def request_title(req: PaymentRequest) -> str:
    return f"Заявка № {req.request_number or str(req.id)[:8].upper()}"

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

async def update_request(db: AsyncSession, request_id: UUID, data: RequestUpdate, user_id: UUID, bypass_owner: bool = False) -> PaymentRequest:
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
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
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    old_status = req.approval_status
    req.approval_status = status
    if reason:
        req.rejection_reason = reason
    db.add(AuditLog(
        entity_name="PaymentRequest",
        entity_id=req.id,
        action="UPDATE_APPROVAL",
        changes={"old": old_status, "new": status}
    ))

    # Уведомления инициатору при изменении статуса
    title = request_title(req)
    notif_map = {
        ApprovalStatus.APPROVED:      ("APPROVED",      f"{title}: согласована ФЭО. {req.counterparty}, {req.amount:,.0f} ₽."),
        ApprovalStatus.REJECTED:      ("REJECTED",      f"{title}: отклонена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {reason or '—'}"),
        ApprovalStatus.CLARIFICATION: ("CLARIFICATION", f"{title}: требуется уточнение. {req.counterparty}, {req.amount:,.0f} ₽. Комментарий: {reason or '—'}"),
    }
    if status in notif_map:
        notif_type, text = notif_map[status]
        if current_user and status == ApprovalStatus.APPROVED:
            text = f"{title}: согласована ФЭО ({current_user.full_name}). {req.counterparty}, {req.amount:,.0f} ₽."
        db.add(Notification(user_id=req.creator_id, request_id=req.id, text=text, type=notif_type))

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
    req = await get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.payment_status == PaymentStatus.PAID:
        raise HTTPException(status_code=400, detail="Заявка уже оплачена")
    if req.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Оплатить можно только утверждённую заявку")
    old_status = req.payment_status
    req.payment_status = status
    db.add(AuditLog(
        entity_name="PaymentRequest",
        entity_id=req.id,
        action="UPDATE_PAYMENT",
        changes={"old": old_status, "new": status}
    ))
    if status == PaymentStatus.PAID:
        actor = f" ({current_user.full_name})" if current_user else ""
        db.add(Notification(
            user_id=req.creator_id,
            request_id=req.id,
            text=f"{request_title(req)}: оплачена казначеем{actor}. {req.counterparty}, {req.amount:,.0f} ₽.",
            type="PAID",
        ))
    await db.commit()
    await db.refresh(req)
    return req

async def get_stats(db: AsyncSession) -> dict:
    """"""
    total = await db.execute(select(func.count(PaymentRequest.id)))
    approved = await db.execute(select(func.count(PaymentRequest.id)).where(PaymentRequest.approval_status == ApprovalStatus.APPROVED))
    paid = await db.execute(select(func.count(PaymentRequest.id)).where(PaymentRequest.payment_status == PaymentStatus.PAID))
    return {
        "total_requests": total.scalar() or 0,
        "approved_requests": approved.scalar() or 0,
        "paid_requests": paid.scalar() or 0
    }
