from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timezone, timedelta
import uuid, os

from app.models.audit import AuditLog
from app.models.notification import Notification

from app.api.deps import get_db, PermissionChecker
from app.schemas.request import RequestCreate, RequestUpdate, RequestResponse, StatusUpdate
from app.services import request_service
from app.services.app_settings import get_storage_path
from app.models.request import ApprovalStatus, PaymentStatus
from app.models.calendar import PaymentCalendar
from app.models.organization import Organization
from app.models.user import User
from app.services import notification_service as notif_svc

MOSCOW_TZ = timezone(timedelta(hours=3))

def has_perm(user: User, perm: str) -> bool:
    """Проверяет наличие права у пользователя (с учётом superadmin на роли)."""
    if user.role and getattr(user.role, 'is_superadmin', False):
        return True
    if not user.role or not user.role.permissions:
        return False
    return any(p.name == perm for p in user.role.permissions)
SUBMIT_CUTOFF_HOUR = 11  # До 11:00 МСК — обычный приём

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}

router = APIRouter()

@router.post("/", response_model=RequestResponse)
async def create_request(
    request_in: RequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    return await request_service.create_payment_request(db=db, request_data=request_in, user_id=current_user.id)

@router.get("/my", response_model=List[RequestResponse])
async def read_my_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    return await request_service.get_my_requests(db, user_id=current_user.id)

@router.get("/all", response_model=List[RequestResponse])
async def read_all_requests(
    approval_status: Optional[ApprovalStatus] = None,
    payment_status: Optional[PaymentStatus] = None,
    organization_id: Optional[UUID] = None,
    direction_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))  # минимальное право — RLS внутри
):
    return await request_service.get_all_requests(
        db,
        current_user=current_user,
        approval_status=approval_status,
        payment_status=payment_status,
        organization_id=organization_id,
        direction_id=direction_id,
    )

@router.get("/marked_for_deletion", response_model=List[RequestResponse])
async def get_marked_for_deletion(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("rbac_manage"))
):
    """Список заявок, помеченных на удаление (только для настроек, rbac_manage)."""
    from app.models.request import PaymentRequest
    result = await db.execute(
        select(PaymentRequest)
        .options(*request_service._with_relations())
        .where(PaymentRequest.is_marked_for_deletion == True)
        .order_by(PaymentRequest.created_at.desc())
    )
    return result.scalars().all()

@router.delete("/marked_for_deletion")
async def purge_marked_for_deletion(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("rbac_manage"))
):
    """Физически удалить все помеченные заявки вместе со связанными записями."""
    from app.models.request import PaymentRequest

    result = await db.execute(
        select(PaymentRequest).where(PaymentRequest.is_marked_for_deletion == True)
    )
    marked = result.scalars().all()
    if not marked:
        return {"deleted": 0, "message": "Нет заявок для удаления"}

    ids = [r.id for r in marked]

    await db.execute(delete(Notification).where(Notification.request_id.in_(ids)))
    await db.execute(delete(AuditLog).where(
        AuditLog.entity_name == "PaymentRequest",
        AuditLog.entity_id.in_(ids)
    ))

    for req in marked:
        if req.file_path and os.path.exists(req.file_path):
            try:
                os.remove(req.file_path)
            except OSError:
                pass

    await db.execute(delete(PaymentRequest).where(PaymentRequest.id.in_(ids)))

    db.add(AuditLog(
        user_id=current_user.id,
        entity_name="PaymentRequest",
        entity_id=current_user.id,
        action="PURGE_MARKED",
        changes={"deleted_count": len(ids), "ids": [str(i) for i in ids]}
    ))
    await db.commit()
    return {"deleted": len(ids), "message": f"Удалено заявок: {len(ids)}"}

@router.put("/{request_id}", response_model=RequestResponse)
async def update_request(
    request_id: UUID,
    data: RequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    # req_edit_all позволяет ФЭО редактировать любую заявку (не только свою)
    return await request_service.update_request(db, request_id, data, current_user.id, bypass_owner=has_perm(current_user, "req_edit_all"))

@router.delete("/{request_id}")
async def delete_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    await request_service.delete_request(db, request_id, current_user.id)
    return {"ok": True}

@router.post("/{request_id}/submit", response_model=RequestResponse)
async def submit_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.creator_id != current_user.id and not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")

    allowed_statuses = {ApprovalStatus.DRAFT, ApprovalStatus.CLARIFICATION, ApprovalStatus.POSTPONED}
    if req.approval_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Нельзя отправить заявку со статусом «{req.approval_status}»")

    if not req.payment_date:
        raise HTTPException(status_code=400, detail="Укажите дату оплаты перед отправкой")

    # Проверяем временной шлюз (МСК) — только если дата оплаты = сегодня
    now_msk = datetime.now(MOSCOW_TZ)
    gate_violation: Optional[str] = None

    if req.payment_date == now_msk.date() and now_msk.hour >= SUBMIT_CUTOFF_HOUR:
        gate_violation = f"Заявка подана после {SUBMIT_CUTOFF_HOUR}:00 МСК ({now_msk.strftime('%H:%M')})"

    # Проверяем тип дня по платёжному календарю организации
    if not gate_violation:
        org_res = await db.execute(select(Organization).where(Organization.id == req.organization_id))
        org = org_res.scalar_one_or_none()
        if org and org.payment_group_id:
            cal_res = await db.execute(
                select(PaymentCalendar).where(
                    PaymentCalendar.date == req.payment_date,
                    PaymentCalendar.payment_group_id == org.payment_group_id,
                )
            )
            cal_day = cal_res.scalar_one_or_none()
            if cal_day and cal_day.day_type != "PAYMENT":
                day_type_reasons = {
                    "NON_PAYMENT": "неплатёжный день",
                    "HOLIDAY": "выходной день",
                    "SALARY_DAY": "день выплаты зарплаты",
                }
                reason = day_type_reasons.get(cal_day.day_type, cal_day.day_type)
                gate_violation = f"Дата оплаты {req.payment_date} — {reason}"

    if gate_violation:
        req.approval_status = ApprovalStatus.PENDING_GATE
        req.gate_reason = gate_violation
        await db.commit()
        return await request_service.get_request_by_id(db, request_id)

    req.approval_status = ApprovalStatus.PENDING
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/upload", response_model=RequestResponse)
async def upload_file(
    request_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Допустимые форматы: {', '.join(ALLOWED_EXTENSIONS)}")

    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.creator_id != current_user.id and not getattr(current_user, 'is_superadmin', False):
        raise HTTPException(status_code=403, detail="Нельзя загружать файл к чужой заявке")

    storage = get_storage_path()

    # Читаем содержимое файла асинхронно ДО любых операций с БД
    contents = await file.read()

    # Удаляем старый файл если был
    if req.file_path:
        old_path = os.path.join(storage, req.file_path)
        if os.path.exists(old_path):
            os.remove(old_path)

    filename = f"{uuid.uuid4()}{ext}"
    with open(os.path.join(storage, filename), "wb") as f:
        f.write(contents)

    req.file_path = filename
    await db.commit()
    # Явно перезагружаем с relationships через selectinload
    return await request_service.get_request_by_id(db, request_id)


@router.get("/{request_id}/file")
async def download_file(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req or not req.file_path:
        raise HTTPException(status_code=404, detail="Файл не найден")
    # Доступ: владелец или пользователь с правом просматривать чужие заявки
    can_view_others = has_perm(current_user, "req_view_all") or has_perm(current_user, "req_view_org") or has_perm(current_user, "req_view_cluster") or has_perm(current_user, "req_view_dept")
    if req.creator_id != current_user.id and not can_view_others:
        raise HTTPException(status_code=403, detail="Нет доступа к файлу")
    file_path = os.path.join(get_storage_path(), req.file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Файл не найден на диске")
    return FileResponse(path=file_path, filename=req.file_path)

@router.post("/{request_id}/approve_gate", response_model=RequestResponse)
async def approve_gate(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("gate_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.PENDING_GATE:
        raise HTTPException(status_code=400, detail="Заявка не ожидает разрешения шлюза")
    req.approval_status = ApprovalStatus.PENDING
    req.special_order = True
    req.gate_approved_by = current_user.id
    req.gate_reason = body.reason or req.gate_reason
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/reject_gate", response_model=RequestResponse)
async def reject_gate(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("gate_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.PENDING_GATE:
        raise HTTPException(status_code=400, detail="Заявка не ожидает разрешения шлюза")
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = body.reason
    await db.commit()
    await notif_svc.create_notification(
        db, user_id=req.creator_id, request_id=req.id,
        notif_type="GATE_REJECTED",
        text=f"Запрос на экстренный платёж отклонён ФЭО: {body.reason or '—'}",
    )
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.patch("/{request_id}/contract", response_model=RequestResponse)
async def set_contract_status(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_set_contract"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    req.contract_status = data.get("contract_status", req.contract_status)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/approve_memo", response_model=RequestResponse)
async def approve_memo(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("memo_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.PENDING_MEMO:
        raise HTTPException(status_code=400, detail="Заявка не ожидает согласования по бюджету")
    req.approval_status = ApprovalStatus.PENDING
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/reject_memo", response_model=RequestResponse)
async def reject_memo(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("memo_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.PENDING_MEMO:
        raise HTTPException(status_code=400, detail="Заявка не ожидает согласования по бюджету")
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = body.reason
    await db.commit()
    await notif_svc.create_notification(
        db, user_id=req.creator_id, request_id=req.id,
        notif_type="REJECTED",
        text=f"Внебюджетный платёж не утверждён: {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}",
    )
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/move_to_draft", response_model=RequestResponse)
async def move_to_draft(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    """Инициатор переносит заявку из PENDING_MEMO обратно в DRAFT с новой датой."""
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.creator_id != current_user.id and not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")
    allowed = {ApprovalStatus.PENDING_MEMO, ApprovalStatus.POSTPONED}
    if req.approval_status not in allowed:
        raise HTTPException(status_code=400, detail="Перенос доступен только для заявок в статусе 'Вне бюджета' или 'Перенесено'")
    from datetime import date as date_type
    old_date = req.payment_date
    new_date = data.get("payment_date")
    if new_date:
        req.payment_date = date_type.fromisoformat(new_date)
    if req.approval_status == ApprovalStatus.PENDING_MEMO:
        req.is_budgeted = None
    req.approval_status = ApprovalStatus.DRAFT
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    db.add(Notification(user_id=req.creator_id, request_id=req.id,
        text=f"Инициатор перенёс дату с {old_str} на {new_str}: {req.counterparty}, {req.amount:,.0f} ₽",
        type="RESCHEDULED"))
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)

@router.patch("/{request_id}/budget", response_model=RequestResponse)
async def set_budget_status(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    new_value = data.get("is_budgeted", req.is_budgeted)
    req.is_budgeted = new_value
    # Если ФЭО явно выставляет «Нет» и заявка на согласовании — переводим в PENDING_MEMO
    if new_value is False and req.approval_status == ApprovalStatus.PENDING:
        req.approval_status = ApprovalStatus.PENDING_MEMO
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)

@router.patch("/{request_id}/special_order", response_model=RequestResponse)
async def set_special_order(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    req.special_order = data.get("special_order", req.special_order)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)

@router.post("/{request_id}/suspend", response_model=RequestResponse)
async def suspend_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_suspend"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Отложить можно только согласованную заявку")
    req.approval_status = ApprovalStatus.SUSPENDED
    req.rejection_reason = body.reason
    await db.commit()
    await notif_svc.create_notification(
        db, user_id=req.creator_id, request_id=req.id,
        notif_type="SUSPENDED",
        text=f"Заявка отложена: {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}",
    )
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/unsuspend", response_model=RequestResponse)
async def unsuspend_request(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_suspend"))
):
    """Перенести отложенную заявку на новую дату. Спецраспоряжение сбрасывается, заявка идёт на согласование."""
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.approval_status != ApprovalStatus.SUSPENDED:
        raise HTTPException(status_code=400, detail="Заявка не отложена")
    from datetime import date as date_type
    old_date = req.payment_date
    new_date_str = data.get("payment_date")
    if new_date_str:
        req.payment_date = date_type.fromisoformat(new_date_str)
    req.special_order = False
    req.approval_status = ApprovalStatus.PENDING
    req.rejection_reason = None
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    await notif_svc.create_notification(
        db, user_id=req.creator_id, request_id=req.id,
        notif_type="RESCHEDULED",
        text=f"Заявка перенесена с {old_str} на {new_str}: {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование.",
    )
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.get("/{request_id}/history")
async def get_request_history(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    """История событий по заявке (все уведомления, привязанные к ней)."""
    res = await db.execute(
        select(Notification)
        .where(Notification.request_id == request_id)
        .order_by(Notification.created_at.asc())
    )
    notifications = res.scalars().all()
    return [
        {
            "id": str(n.id),
            "type": n.type,
            "text": n.text,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notifications
    ]


@router.post("/{request_id}/approve", response_model=RequestResponse)
async def approve_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.APPROVED)

@router.post("/{request_id}/reject", response_model=RequestResponse)
async def reject_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.REJECTED, reason=body.reason)

@router.post("/{request_id}/clarify", response_model=RequestResponse)
async def clarify_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.CLARIFICATION, reason=body.reason)

@router.post("/{request_id}/postpone", response_model=RequestResponse)
async def postpone_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    from datetime import date as date_type
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    old_date = req.payment_date
    if body.payment_date:
        req.payment_date = date_type.fromisoformat(body.payment_date)
    req.approval_status = ApprovalStatus.POSTPONED
    req.rejection_reason = body.reason
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    date_info = f"с {old_str} на {new_str}" if body.payment_date else f"(дата оплаты: {old_str})"
    text = f"Заявка перенесена {date_info}: {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}"
    db.add(Notification(user_id=req.creator_id, request_id=req.id, text=text, type="POSTPONED"))
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)

@router.post("/{request_id}/pay", response_model=RequestResponse)
async def pay_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_pay"))
):
    return await request_service.update_payment_status(db, request_id, PaymentStatus.PAID)


@router.patch("/{request_id}/mark_deletion", response_model=RequestResponse)
async def mark_for_deletion(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    """Пометить/снять пометку на удаление.
    - Инициатор: только свои, только если не PAID
    - req_edit_all (ФЭО): любая заявка, любой статус
    - superadmin: любая заявка, любой статус
    """
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    is_super = has_perm(current_user, "req_edit_all")

    if not is_super:
        if req.creator_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя помечать чужую заявку")
        if req.payment_status == PaymentStatus.PAID:
            raise HTTPException(status_code=400, detail="Нельзя пометить оплаченную заявку")

    req.is_marked_for_deletion = not req.is_marked_for_deletion
    db.add(AuditLog(
        user_id=current_user.id,
        entity_name="PaymentRequest",
        entity_id=req.id,
        action="MARK_DELETION" if req.is_marked_for_deletion else "UNMARK_DELETION",
        changes={"is_marked_for_deletion": req.is_marked_for_deletion}
    ))
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)
