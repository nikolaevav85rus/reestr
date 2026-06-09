from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from zoneinfo import ZoneInfo
import uuid, os

from app.models.audit import AuditLog
from app.models.notification import Notification

from app.api.deps import get_db, PermissionChecker
from app.core.config import settings as app_settings
from app.schemas.request import GatePreviewRequest, GatePreviewResponse, OcrPrefill, OcrRecognizeResponse, RequestCreate, RequestUpdate, RequestResponse, StatusUpdate
from app.services import request_service
from app.services import ocr_service
from app.services.app_settings import get_storage_path
from app.models.request import ApprovalStatus, PaymentStatus
from app.models.budget import BudgetItem
from app.models.calendar import DayTypeRule, PaymentCalendar
from app.models.organization import Organization
from app.models.user import User
from app.services import notification_service as notif_svc

MOSCOW_TZ = ZoneInfo(app_settings.APP_TIMEZONE)

def has_perm(user: User, perm: str) -> bool:
    """Проверяет наличие права у пользователя (с учётом superadmin на роли)."""
    if user.role and getattr(user.role, 'is_superadmin', False):
        return True
    if not user.role or not user.role.permissions:
        return False
    return any(p.name == perm for p in user.role.permissions)

def request_title(req) -> str:
    return f"Заявка № {req.request_number or str(req.id)[:8].upper()}"

def _ensure_not_marked(req):
    if getattr(req, "is_marked_for_deletion", False):
        raise HTTPException(status_code=400, detail="Заявка помечена на удаление — действие недоступно. Снимите пометку, чтобы продолжить.")

SUBMIT_CUTOFF_HOUR = app_settings.SUBMIT_CUTOFF_HOUR  # До 11:00 МСК — обычный приём

router = APIRouter()


def _write_file_bytes(path: str, contents: bytes) -> None:
    with open(path, "wb") as f:
        f.write(contents)


def _remove_file_if_exists(path: str) -> None:
    if os.path.exists(path):
        os.remove(path)

DAY_TYPE_REASONS = {
    "NON_PAYMENT": "неплатёжный день",
    "HOLIDAY": "выходной день",
    "SALARY_DAY": "день выплаты зарплаты",
}

async def get_gate_preview(
    db: AsyncSession,
    *,
    payment_date,
    organization_id: UUID,
    budget_item_id: UUID,
) -> GatePreviewResponse:
    reasons: list[str] = []
    now_msk = datetime.now(MOSCOW_TZ)

    if payment_date == now_msk.date() and now_msk.hour >= SUBMIT_CUTOFF_HOUR:
        reasons.append(f"Заявка подана после {SUBMIT_CUTOFF_HOUR}:00 МСК ({now_msk.strftime('%H:%M')})")

    require_coverage = app_settings.GATE_REQUIRE_CALENDAR_COVERAGE

    org_res = await db.execute(select(Organization).where(Organization.id == organization_id))
    org = org_res.scalar_one_or_none()
    if not (org and org.payment_group_id):
        # Fail-closed: без платёжной группы матрицу ДДС применить нельзя.
        if require_coverage:
            reasons.append(
                "У организации не настроена платёжная группа — требуется подтверждение шлюза"
            )
    else:
        cal_res = await db.execute(
            select(PaymentCalendar).where(
                PaymentCalendar.date == payment_date,
                PaymentCalendar.payment_group_id == org.payment_group_id,
            )
        )
        cal_day = cal_res.scalar_one_or_none()
        if cal_day is None:
            # Fail-closed: дата не покрыта платёжным календарём.
            if require_coverage:
                reasons.append(
                    f"Дата оплаты {payment_date} не покрыта платёжным календарём — требуется подтверждение шлюза"
                )
        elif cal_day.day_type != "PAYMENT":
            budget_res = await db.execute(select(BudgetItem).where(BudgetItem.id == budget_item_id))
            budget_item = budget_res.scalar_one_or_none()
            allowed = False
            if budget_item and budget_item.category:
                rule_res = await db.execute(
                    select(DayTypeRule).where(
                        DayTypeRule.day_type == cal_day.day_type,
                        DayTypeRule.allowed_category == budget_item.category,
                    )
                )
                allowed = rule_res.scalar_one_or_none() is not None

            if not allowed:
                day_reason = DAY_TYPE_REASONS.get(cal_day.day_type, cal_day.day_type)
                reasons.append(f"Дата оплаты {payment_date} — {day_reason}")

    return GatePreviewResponse(
        allowed=not reasons,
        reason="; ".join(reasons) if reasons else None,
        reasons=reasons,
    )

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

@router.post("/gate_preview", response_model=GatePreviewResponse)
async def preview_gate(
    data: GatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    return await get_gate_preview(
        db,
        payment_date=data.payment_date,
        organization_id=data.organization_id,
        budget_item_id=data.budget_item_id,
    )

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
    _ensure_not_marked(req)
    if req.creator_id != current_user.id and not has_perm(current_user, "req_edit_all"):
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")

    allowed_statuses = {ApprovalStatus.DRAFT, ApprovalStatus.CLARIFICATION, ApprovalStatus.POSTPONED}
    if req.approval_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Нельзя отправить заявку со статусом «{req.approval_status}»")

    if not req.payment_date:
        raise HTTPException(status_code=400, detail="Укажите дату оплаты перед отправкой")

    old_status = req.approval_status.value if isinstance(req.approval_status, ApprovalStatus) else str(req.approval_status)

    # Проверяем временной шлюз (МСК) — только если дата оплаты = сегодня
    gate_preview = await get_gate_preview(
        db,
        payment_date=req.payment_date,
        organization_id=req.organization_id,
        budget_item_id=req.budget_item_id,
    )

    if not gate_preview.allowed:
        req.approval_status = ApprovalStatus.PENDING_GATE
        req.gate_reason = gate_preview.reason
        summary = f"{request_title(req)}: подана на разрешение шлюза (исключение из регламента). {req.counterparty}, {req.amount:,.0f} ₽."
        request_service.write_audit(db, req, "SUBMIT_GATE", current_user, summary, extra={"old": old_status, "new": "PENDING_GATE"})
        recipients = await notif_svc.get_active_users_with_permission(db, "gate_approve")
        await notif_svc.fan_out_notification(db, recipients, summary, "SUBMITTED", request_id=req.id, exclude_user_id=current_user.id)
        await db.commit()
        return await request_service.get_request_by_id(db, request_id)

    req.approval_status = ApprovalStatus.PENDING
    summary = f"{request_title(req)}: подана на согласование ФЭО. {req.counterparty}, {req.amount:,.0f} ₽."
    request_service.write_audit(db, req, "SUBMIT", current_user, summary, extra={"old": old_status, "new": "PENDING"})
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    await notif_svc.fan_out_notification(db, recipients, summary, "SUBMITTED", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/upload", response_model=RequestResponse)
async def upload_file(
    request_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    allowed_extensions = set(app_settings.UPLOAD_ALLOWED_EXTENSIONS)
    allowed_content_types = set(app_settings.UPLOAD_ALLOWED_CONTENT_TYPES)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый формат файла. Разрешены: {', '.join(sorted(allowed_extensions))}",
        )

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый MIME/content-type файла. Разрешены: {', '.join(sorted(allowed_content_types))}",
        )

    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _ensure_not_marked(req)
    if req.creator_id != current_user.id and not getattr(current_user, 'is_superadmin', False):
        raise HTTPException(status_code=403, detail="Нельзя загружать файл к чужой заявке")

    storage = get_storage_path()

    # Читаем содержимое файла асинхронно ДО любых операций с БД
    contents = await file.read()
    max_bytes = app_settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Файл слишком большой. Максимальный размер: {app_settings.UPLOAD_MAX_SIZE_MB} МБ.",
        )

    old_path = os.path.join(storage, req.file_path) if req.file_path else None
    filename = f"{uuid.uuid4()}{ext}"
    new_path = os.path.join(storage, filename)

    try:
        await run_in_threadpool(_write_file_bytes, new_path, contents)
    except OSError:
        raise HTTPException(status_code=500, detail="Не удалось сохранить файл")

    req.file_path = filename
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await run_in_threadpool(_remove_file_if_exists, new_path)
        except OSError:
            pass
        raise

    if old_path:
        try:
            await run_in_threadpool(_remove_file_if_exists, old_path)
        except OSError:
            pass

    # Явно перезагружаем с relationships через selectinload
    return await request_service.get_request_by_id(db, request_id)


@router.post("/ocr_recognize", response_model=OcrRecognizeResponse)
async def ocr_recognize(
    file: UploadFile = File(...),
    current_user: User = Depends(PermissionChecker("req_create"))
):
    """Распознаёт загруженный счёт на оплату через evo-ai и возвращает поля
    для предзаполнения формы заявки. Файл нигде не сохраняется."""
    # Та же валидация загрузки, что и в upload_file.
    allowed_extensions = set(app_settings.UPLOAD_ALLOWED_EXTENSIONS)
    allowed_content_types = set(app_settings.UPLOAD_ALLOWED_CONTENT_TYPES)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый формат файла. Разрешены: {', '.join(sorted(allowed_extensions))}",
        )

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail=f"Неподдерживаемый MIME/content-type файла. Разрешены: {', '.join(sorted(allowed_content_types))}",
        )

    contents = await file.read()
    max_bytes = app_settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Файл слишком большой. Максимальный размер: {app_settings.UPLOAD_MAX_SIZE_MB} МБ.",
        )

    try:
        recognition = await ocr_service.recognize_invoice(
            contents, file.filename or f"invoice{ext}", content_type
        )
    except ocr_service.OcrError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    # Защитный разбор распознанного JSON (структура может быть неполной).
    def _section(name: str) -> dict:
        value = recognition.get(name)
        return value if isinstance(value, dict) else {}

    rec = _section("recognition")
    invoice = _section("invoice")
    supplier = _section("supplier")
    totals = _section("totals")
    validation = _section("validation")

    raw_amount = totals.get("total")
    try:
        amount = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        amount = None

    is_invoice = rec.get("is_invoice")
    raw_confidence = rec.get("confidence")
    try:
        confidence = float(raw_confidence) if raw_confidence is not None else None
    except (TypeError, ValueError):
        confidence = None

    prefill = OcrPrefill(
        amount=amount,
        counterparty=supplier.get("name"),
        description=invoice.get("payment_purpose") or invoice.get("basis"),  # Назначение платежа
        note=invoice.get("summary") or invoice.get("basis"),                 # Описание
        supplier_inn=supplier.get("inn"),
        payment_purpose_requirement=invoice.get("payment_purpose_requirement"),
        is_invoice=is_invoice if isinstance(is_invoice, bool) else None,
        confidence=confidence,
    )

    warnings: list[str] = []
    if is_invoice is False:
        warnings.append("Документ не распознан как счёт на оплату")
    if amount is None:
        warnings.append("Не удалось извлечь сумму")
    if validation.get("totals_match") is False:
        warnings.append("Контрольные суммы не сошлись")

    return OcrRecognizeResponse(prefill=prefill, warnings=warnings, raw=recognition)


@router.get("/{request_id}/file")
async def download_file(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req or not req.file_path:
        raise HTTPException(status_code=404, detail="Файл не найден")
    # Доступ: владелец всегда; иначе — по object-level RLS (область видимости
    # должна покрывать ИМЕННО эту заявку, а не просто наличие любого scope-права).
    if req.creator_id != current_user.id:
        await request_service.assert_can_view_request(db, current_user, req)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    if req.approval_status != ApprovalStatus.PENDING_GATE:
        raise HTTPException(status_code=400, detail="Заявка не ожидает разрешения шлюза")
    req.approval_status = ApprovalStatus.PENDING
    req.special_order = True
    req.gate_approved_by = current_user.id
    req.gate_reason = body.reason or req.gate_reason
    summary = f"{request_title(req)}: разрешён экстренный платёж (шлюз). {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
    request_service.write_audit(db, req, "APPROVE_GATE", current_user, summary, extra={"old": "PENDING_GATE", "new": "PENDING"})
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    await notif_svc.fan_out_notification(db, recipients, summary, "GATE_APPROVED", request_id=req.id, exclude_user_id=current_user.id)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    if req.approval_status != ApprovalStatus.PENDING_GATE:
        raise HTTPException(status_code=400, detail="Заявка не ожидает разрешения шлюза")
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = body.reason
    summary = f"{request_title(req)}: запрос на экстренный платёж отклонён ФЭО. Причина: {body.reason or '—'}"
    request_service.write_audit(db, req, "REJECT_GATE", current_user, summary, extra={"old": "PENDING_GATE", "new": "REJECTED"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "GATE_REJECTED", request_id=req.id, exclude_user_id=current_user.id)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    old_contract = req.contract_status
    req.contract_status = data.get("contract_status", req.contract_status)
    contract_label = {True: "Да", False: "Нет", None: "—"}.get(req.contract_status, str(req.contract_status))
    summary = f"{request_title(req)}: статус договора изменён на «{contract_label}»."
    request_service.write_audit(db, req, "SET_CONTRACT", current_user, summary, extra={"old": str(old_contract), "new": str(req.contract_status)})
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
    # NB: object-level RLS НЕ применяется здесь намеренно. Роль DIRECTOR держит
    # memo_approve, но из областей видимости — только req_view_org (не req_view_all).
    # Жёсткое требование «директор = director_id организации заявки» сломало бы
    # зелёный workflow-набор (memo-сценарии между орг). Оставлено permission-only.
    _ensure_not_marked(req)
    if req.approval_status != ApprovalStatus.PENDING_MEMO:
        raise HTTPException(status_code=400, detail="Заявка не ожидает согласования по бюджету")
    req.approval_status = ApprovalStatus.PENDING
    summary = f"{request_title(req)}: внебюджетный платёж утверждён директором. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
    request_service.write_audit(db, req, "APPROVE_MEMO", current_user, summary, extra={"old": "PENDING_MEMO", "new": "PENDING"})
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    await notif_svc.fan_out_notification(db, recipients, summary, "MEMO_APPROVED", request_id=req.id, exclude_user_id=current_user.id)
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
    # NB: object-level RLS НЕ применяется здесь намеренно (см. approve_memo).
    # DIRECTOR держит memo_approve, но без req_view_all → permission-only.
    _ensure_not_marked(req)
    if req.approval_status != ApprovalStatus.PENDING_MEMO:
        raise HTTPException(status_code=400, detail="Заявка не ожидает согласования по бюджету")
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = body.reason
    summary = f"{request_title(req)}: внебюджетный платёж не утверждён. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}"
    request_service.write_audit(db, req, "REJECT_MEMO", current_user, summary, extra={"old": "PENDING_MEMO", "new": "REJECTED"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "REJECTED", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/memo_reason", response_model=RequestResponse)
async def memo_reason(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _ensure_not_marked(req)
    if req.creator_id != current_user.id and not has_perm(current_user, "req_edit_all"):
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")
    if req.approval_status != ApprovalStatus.MEMO_REQUIRED:
        raise HTTPException(status_code=400, detail="Заявка не ожидает обоснования вне бюджета")
    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="Укажите обоснование вне бюджета")
    req.rejection_reason = body.reason.strip()
    req.approval_status = ApprovalStatus.PENDING_MEMO
    summary = f"{request_title(req)}: добавлено обоснование вне бюджета. {req.counterparty}, {req.amount:,.0f} ₽."
    request_service.write_audit(db, req, "MEMO_REASON", current_user, summary, extra={"old": "MEMO_REQUIRED", "new": "PENDING_MEMO"})
    recipients = await notif_svc.get_active_users_with_permission(db, "memo_approve")
    await notif_svc.fan_out_notification(db, recipients, summary, "OFF_BUDGET", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/cancel_memo", response_model=RequestResponse)
async def cancel_memo(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _ensure_not_marked(req)
    if req.creator_id != current_user.id and not has_perm(current_user, "req_edit_all"):
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")
    if req.approval_status != ApprovalStatus.MEMO_REQUIRED:
        raise HTTPException(status_code=400, detail="Отменить можно только заявку, ожидающую обоснования вне бюджета")
    req.approval_status = ApprovalStatus.REJECTED
    req.rejection_reason = body.reason or "Отменена инициатором"
    summary = f"{request_title(req)}: отменена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {req.rejection_reason}"
    request_service.write_audit(db, req, "CANCEL_MEMO", current_user, summary, extra={"old": "MEMO_REQUIRED", "new": "REJECTED"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "REJECTED", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


@router.post("/{request_id}/move_to_draft", response_model=RequestResponse)
async def move_to_draft(
    request_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own"))
):
    """Инициатор переносит заявку из PENDING_MEMO обратно в DRAFT с новой датой."""
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    _ensure_not_marked(req)
    if req.creator_id != current_user.id and not has_perm(current_user, "req_edit_all"):
        raise HTTPException(status_code=403, detail="Нет доступа к этой заявке")
    allowed = {ApprovalStatus.MEMO_REQUIRED, ApprovalStatus.PENDING_MEMO, ApprovalStatus.POSTPONED}
    if req.approval_status not in allowed:
        raise HTTPException(status_code=400, detail="Перенос доступен только для заявок в статусе 'Вне бюджета' или 'Перенесено'")
    from datetime import date as date_type
    old_status = req.approval_status.value if isinstance(req.approval_status, ApprovalStatus) else str(req.approval_status)
    old_date = req.payment_date
    new_date = data.get("payment_date")
    if new_date:
        req.payment_date = date_type.fromisoformat(new_date)
    if req.approval_status in {ApprovalStatus.MEMO_REQUIRED, ApprovalStatus.PENDING_MEMO}:
        req.is_budgeted = None
        req.rejection_reason = None
    req.approval_status = ApprovalStatus.DRAFT
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    summary = f"{request_title(req)}: инициатор перенёс дату с {old_str} на {new_str}. {req.counterparty}, {req.amount:,.0f} ₽"
    request_service.write_audit(db, req, "MOVE_TO_DRAFT", current_user, summary, extra={"old": old_status, "new": "DRAFT"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "RESCHEDULED", request_id=req.id, exclude_user_id=current_user.id)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    new_value = data.get("is_budgeted", req.is_budgeted)
    req.is_budgeted = new_value
    # Если ФЭО явно выставляет «Нет» и заявка на согласовании — сначала запрашиваем обоснование у инициатора
    if new_value is False and req.approval_status == ApprovalStatus.PENDING:
        req.approval_status = ApprovalStatus.MEMO_REQUIRED
        req.rejection_reason = None
        summary = f"{request_title(req)}: требуется обоснование вне бюджета. {req.counterparty}, {req.amount:,.0f} ₽."
        request_service.write_audit(db, req, "SET_BUDGET", current_user, summary, extra={"old": "PENDING", "new": "MEMO_REQUIRED", "is_budgeted": False})
        await notif_svc.fan_out_notification(db, [req.creator_id], summary, "OFF_BUDGET", request_id=req.id, exclude_user_id=current_user.id)
    elif new_value is True and req.approval_status == ApprovalStatus.MEMO_REQUIRED:
        req.approval_status = ApprovalStatus.PENDING
        req.rejection_reason = None
        summary = f"{request_title(req)}: подтверждено наличие в бюджете. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование ФЭО."
        request_service.write_audit(db, req, "SET_BUDGET", current_user, summary, extra={"old": "MEMO_REQUIRED", "new": "PENDING", "is_budgeted": True})
        recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
        await notif_svc.fan_out_notification(db, recipients, summary, "SUBMITTED", request_id=req.id, exclude_user_id=current_user.id)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    old_special = req.special_order
    req.special_order = data.get("special_order", req.special_order)
    summary = f"{request_title(req)}: спецраспоряжение {'установлено' if req.special_order else 'снято'}."
    request_service.write_audit(db, req, "SET_SPECIAL_ORDER", current_user, summary, extra={"old": str(old_special), "new": str(req.special_order)})
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    if req.approval_status not in {ApprovalStatus.PENDING, ApprovalStatus.APPROVED}:
        raise HTTPException(status_code=400, detail="Отложить можно только заявку на согласовании или согласованную заявку")
    old_status = req.approval_status.value if isinstance(req.approval_status, ApprovalStatus) else str(req.approval_status)
    req.approval_status = ApprovalStatus.SUSPENDED
    req.rejection_reason = body.reason
    summary = f"{request_title(req)}: отложена. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}"
    request_service.write_audit(db, req, "SUSPEND", current_user, summary, extra={"old": old_status, "new": "SUSPENDED"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "SUSPENDED", request_id=req.id, exclude_user_id=current_user.id)
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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
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
    summary = f"{request_title(req)}: перенесена с {old_str} на {new_str}. {req.counterparty}, {req.amount:,.0f} ₽. Передана на согласование."
    request_service.write_audit(db, req, "UNSUSPEND", current_user, summary, extra={"old": "SUSPENDED", "new": "PENDING"})
    recipients = await notif_svc.get_active_users_with_permission(db, "req_approve")
    await notif_svc.fan_out_notification(db, recipients, summary, "RESCHEDULED", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)


# Резервные русские подписи для действий аудита, у которых нет summary в changes.
_AUDIT_ACTION_FALLBACK = {
    "CREATE": "Создание заявки",
    "UPDATE": "Изменение заявки",
    "UPDATE_APPROVAL": "Смена статуса согласования",
    "UPDATE_PAYMENT": "Смена статуса оплаты",
    "DELETE": "Удаление заявки",
    "SUBMIT": "Подана на согласование",
    "SUBMIT_GATE": "Подана на разрешение шлюза",
    "APPROVE_GATE": "Разрешён экстренный платёж",
    "REJECT_GATE": "Отклонён экстренный платёж",
    "APPROVE_MEMO": "Внебюджетный платёж утверждён",
    "REJECT_MEMO": "Внебюджетный платёж не утверждён",
    "MEMO_REASON": "Добавлено обоснование вне бюджета",
    "CANCEL_MEMO": "Заявка отменена инициатором",
    "MOVE_TO_DRAFT": "Перенесена в черновик",
    "SET_BUDGET": "Изменён бюджетный статус",
    "SET_SPECIAL_ORDER": "Изменено спецраспоряжение",
    "SET_CONTRACT": "Изменён статус договора",
    "SUSPEND": "Заявка отложена",
    "UNSUSPEND": "Заявка возобновлена",
    "POSTPONE": "Заявка перенесена",
    "MARK_DELETION": "Помечена на удаление",
    "UNMARK_DELETION": "Снята пометка на удаление",
}


@router.get("/{request_id}/history")
async def get_request_history(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    """История событий по заявке (журнал аудита AuditLog).

    Формат ответа сохранён для совместимости с фронтендом (вкладка «История»):
    список объектов {id, type, text, created_at}.
    """
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    await request_service.assert_can_view_request(db, current_user, req)
    res = await db.execute(
        select(AuditLog)
        .where(AuditLog.entity_name == "PaymentRequest")
        .where(AuditLog.entity_id == request_id)
        .order_by(AuditLog.timestamp.asc())
    )
    logs = res.scalars().all()
    result = []
    for log in logs:
        summary = None
        new_status = None
        if isinstance(log.changes, dict):
            summary = log.changes.get("summary")
            new_status = log.changes.get("new")
        # Для смены статуса согласования/оплаты используем результирующий статус
        # как тип события — так вкладка «История» красит approve/reject/clarify/pay
        # разными цветами (UPDATE_APPROVAL сам по себе их не различает).
        if log.action in ("UPDATE_APPROVAL", "UPDATE_PAYMENT") and new_status:
            ev_type = str(new_status)
        else:
            ev_type = log.action
        text = summary or _AUDIT_ACTION_FALLBACK.get(log.action, log.action)
        result.append({
            "id": str(log.id),
            "type": ev_type,
            "text": text,
            "created_at": log.timestamp.isoformat() if log.timestamp else None,
        })
    return result


@router.get("/{request_id}/audit")
async def get_request_audit(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    """Журнал аудита по заявке (записи AuditLog с резолвом ФИО автора)."""
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    await request_service.assert_can_view_request(db, current_user, req)
    res = await db.execute(
        select(AuditLog)
        .where(AuditLog.entity_name == "PaymentRequest")
        .where(AuditLog.entity_id == request_id)
        .order_by(AuditLog.timestamp.asc())
    )
    logs = res.scalars().all()

    # Резолвим ФИО автора одним запросом по уникальным user_id (без N+1)
    user_ids = {log.user_id for log in logs if log.user_id is not None}
    names_by_id: dict = {}
    if user_ids:
        users_res = await db.execute(
            select(User.id, User.full_name).where(User.id.in_(user_ids))
        )
        names_by_id = {uid: full_name for uid, full_name in users_res.all()}

    return [
        {
            "id": str(log.id),
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "action": log.action,
            "actor": names_by_id.get(log.user_id) if log.user_id else None,
            "changes": log.changes,
        }
        for log in logs
    ]


@router.post("/{request_id}/approve", response_model=RequestResponse)
async def approve_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.APPROVED, current_user=current_user)

@router.post("/{request_id}/reject", response_model=RequestResponse)
async def reject_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.REJECTED, reason=body.reason, current_user=current_user)

@router.post("/{request_id}/clarify", response_model=RequestResponse)
async def clarify_request(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_approve"))
):
    return await request_service.update_request_status(db, request_id, ApprovalStatus.CLARIFICATION, reason=body.reason, current_user=current_user)

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
    await request_service.assert_can_view_request(db, current_user, req)
    _ensure_not_marked(req)
    old_status = req.approval_status.value if isinstance(req.approval_status, ApprovalStatus) else str(req.approval_status)
    old_date = req.payment_date
    if body.payment_date:
        req.payment_date = date_type.fromisoformat(body.payment_date)
    req.approval_status = ApprovalStatus.POSTPONED
    req.rejection_reason = body.reason
    old_str = old_date.strftime('%d.%m.%Y') if old_date else '—'
    new_str = req.payment_date.strftime('%d.%m.%Y') if req.payment_date else '—'
    date_info = f"с {old_str} на {new_str}" if body.payment_date else f"(дата оплаты: {old_str})"
    summary = f"{request_title(req)}: перенесена {date_info}. {req.counterparty}, {req.amount:,.0f} ₽. Причина: {body.reason or '—'}"
    request_service.write_audit(db, req, "POSTPONE", current_user, summary, extra={"old": old_status, "new": "POSTPONED"})
    await notif_svc.fan_out_notification(db, [req.creator_id], summary, "POSTPONED", request_id=req.id, exclude_user_id=current_user.id)
    await db.commit()
    return await request_service.get_request_by_id(db, request_id)

@router.post("/{request_id}/pay", response_model=RequestResponse)
async def pay_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_pay"))
):
    return await request_service.update_payment_status(db, request_id, PaymentStatus.PAID, current_user=current_user)


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
