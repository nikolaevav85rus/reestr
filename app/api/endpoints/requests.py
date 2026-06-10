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

# Организационно-правовые формы (для нормализации имени контрагента)
_LEGAL_FORMS = ("ООО", "ПАО", "ЗАО", "ОАО", "НАО", "АО", "ФГУП", "ГУП", "МУП", "АНО", "НКО", "ПК", "ИП")

# Полные написания ОПФ -> аббревиатура (проверяем как префикс, длинные раньше коротких)
_FULL_FORMS = (
    ("ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО", "ПАО"),
    ("НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО", "НАО"),
    ("ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО", "ЗАО"),
    ("ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО", "ОАО"),
    ("ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ", "ООО"),
    ("АКЦИОНЕРНОЕ ОБЩЕСТВО", "АО"),
    ("ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ", "ИП"),
)

def _strip_quotes(text: str) -> str:
    return text.strip().strip('«»""“”\'').strip()

def _normalize_counterparty(name):
    """Приводит контрагента к виду «Наименование ОПФ» (форма юрлица в конце),
    убирает кавычки. Напр. 'ООО "Облачные технологии"' -> 'Облачные технологии ООО'.
    Регистр и состав наименования сохраняются как в документе."""
    if not name:
        return name
    s = " ".join(str(name).split()).strip()
    up = s.upper()
    # Полная форма в начале: 'Общество с ограниченной ответственностью «X»' -> 'X ООО'
    for full, abbr in _FULL_FORMS:
        if up.startswith(full):
            rest = s[len(full):]
            if rest[:1] in (" ", "«", '"', "“", "'", ""):
                core = _strip_quotes(rest)
                return f"{core} {abbr}".strip() if core else s
    # ОПФ в начале: '<ОПФ> ...' либо '<ОПФ>«...»'
    for form in _LEGAL_FORMS:
        if up.startswith(form):
            rest = s[len(form):]
            if rest[:1] in (" ", "«", '"', "“", "'"):
                core = _strip_quotes(rest)
                return f"{core} {form}".strip() if core else s
    # ОПФ уже в конце: '... <ОПФ>'
    for form in _LEGAL_FORMS:
        if up.endswith(" " + form):
            core = _strip_quotes(s[: -len(form)])
            return f"{core} {form}".strip() if core else s
    return _strip_quotes(s)

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

    # Проверяем временной шлюз (МСК) — только если дата оплаты = сегодня.
    # get_gate_preview живёт в слое эндпоинта; результат передаём в transition().
    gate_preview = await get_gate_preview(
        db,
        payment_date=req.payment_date,
        organization_id=req.organization_id,
        budget_item_id=req.budget_item_id,
    )

    return await request_service.transition(
        db, request_id, "submit", current_user,
        gate_allowed=gate_preview.allowed, gate_reason=gate_preview.reason,
    )


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
    buyer = _section("buyer")
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
        counterparty=_normalize_counterparty(supplier.get("name")),
        description=invoice.get("payment_purpose") or invoice.get("basis"),  # Назначение платежа
        note=invoice.get("summary") or invoice.get("basis"),                 # Описание
        supplier_inn=supplier.get("inn"),
        buyer_inn=buyer.get("inn"),
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
    return await request_service.transition(
        db, request_id, "approve_gate", current_user, reason=body.reason,
    )


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
    return await request_service.transition(
        db, request_id, "reject_gate", current_user, reason=body.reason,
    )


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
    # Передаём contract_status только если ключ присутствует в теле — иначе
    # handler сохранит текущее значение (как прежний data.get(..., req.contract_status)).
    kw = {"contract_status": data["contract_status"]} if "contract_status" in data else {}
    return await request_service.transition(db, request_id, "set_contract", current_user, **kw)


@router.post("/{request_id}/approve_memo", response_model=RequestResponse)
async def approve_memo(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("memo_approve"))
):
    # NB: object-level RLS НЕ применяется здесь намеренно. Роль DIRECTOR держит
    # memo_approve, но из областей видимости — только req_view_org (не req_view_all).
    # Жёсткое требование «директор = director_id организации заявки» сломало бы
    # зелёный workflow-набор (memo-сценарии между орг). Оставлено permission-only.
    return await request_service.transition(db, request_id, "approve_memo", current_user)


@router.post("/{request_id}/reject_memo", response_model=RequestResponse)
async def reject_memo(
    request_id: UUID,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("memo_approve"))
):
    # NB: object-level RLS НЕ применяется здесь намеренно (см. approve_memo).
    # DIRECTOR держит memo_approve, но без req_view_all → permission-only.
    return await request_service.transition(
        db, request_id, "reject_memo", current_user, reason=body.reason,
    )


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
    return await request_service.transition(
        db, request_id, "memo_reason", current_user, reason=body.reason,
    )


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
    return await request_service.transition(
        db, request_id, "cancel_memo", current_user, reason=body.reason,
    )


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
    return await request_service.transition(
        db, request_id, "move_to_draft", current_user, payment_date=data.get("payment_date"),
    )

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
    # Передаём is_budgeted только если ключ присутствует — иначе handler
    # сохранит текущее значение (как прежний data.get(..., req.is_budgeted)).
    kw = {"is_budgeted": data["is_budgeted"]} if "is_budgeted" in data else {}
    return await request_service.transition(db, request_id, "set_budget", current_user, **kw)

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
    # Передаём special_order только если ключ присутствует — иначе handler
    # сохранит текущее значение (как прежний data.get(..., req.special_order)).
    kw = {"special_order": data["special_order"]} if "special_order" in data else {}
    return await request_service.transition(db, request_id, "set_special_order", current_user, **kw)

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
    return await request_service.transition(
        db, request_id, "suspend", current_user, reason=body.reason,
    )


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
    return await request_service.transition(
        db, request_id, "unsuspend", current_user, payment_date=data.get("payment_date"),
    )


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
    req = await request_service.get_request_by_id(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    await request_service.assert_can_view_request(db, current_user, req)
    return await request_service.transition(
        db, request_id, "postpone", current_user,
        reason=body.reason, payment_date=body.payment_date,
    )

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
