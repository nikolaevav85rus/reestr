from pydantic import BaseModel, ConfigDict, Field, field_serializer
from uuid import UUID
from datetime import datetime, date
from decimal import Decimal
from typing import Optional


# --- Вложенные схемы для ответа ---

class OrganizationBrief(BaseModel):
    id: UUID
    name: str
    model_config = ConfigDict(from_attributes=True)

class DirectionCategoryBrief(BaseModel):
    id: UUID
    name: str
    model_config = ConfigDict(from_attributes=True)

class DirectionBrief(BaseModel):
    id: UUID
    name: str
    category: Optional[DirectionCategoryBrief] = None
    model_config = ConfigDict(from_attributes=True)

class BudgetItemBrief(BaseModel):
    id: UUID
    name: str
    category: str
    model_config = ConfigDict(from_attributes=True)

class UserBrief(BaseModel):
    id: UUID
    full_name: str
    ad_login: str
    model_config = ConfigDict(from_attributes=True)


# --- Входные схемы ---

class RequestCreate(BaseModel):
    amount: Decimal = Field(ge=0)
    description: str
    note: Optional[str] = None
    payment_date: date
    organization_id: UUID
    direction_id: UUID
    budget_item_id: UUID
    counterparty: str
    contract_status: Optional[bool] = None
    feo_note: Optional[str] = None
    special_order: bool = False
    priority: Optional[str] = None

class RequestUpdate(BaseModel):
    amount: Optional[Decimal] = Field(default=None, ge=0)
    description: Optional[str] = None
    note: Optional[str] = None
    payment_date: Optional[date] = None
    organization_id: Optional[UUID] = None
    direction_id: Optional[UUID] = None
    budget_item_id: Optional[UUID] = None
    counterparty: Optional[str] = None
    contract_status: Optional[bool] = None
    priority: Optional[str] = None

class StatusUpdate(BaseModel):
    reason: Optional[str] = None
    payment_date: Optional[str] = None

class GatePreviewRequest(BaseModel):
    payment_date: date
    organization_id: UUID
    budget_item_id: UUID

class GatePreviewResponse(BaseModel):
    allowed: bool
    reason: Optional[str] = None
    reasons: list[str] = Field(default_factory=list)


# --- OCR (распознавание счёта) ---

class OcrPrefill(BaseModel):
    """Поля для предзаполнения формы заявки из распознанного счёта.

    Сумма умышленно передаётся как float — это подсказка для формы, она не
    сохраняется (хранимая сумма заявки — Decimal в RequestCreate).
    """
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    description: Optional[str] = None  # Назначение платежа
    note: Optional[str] = None         # Описание
    supplier_inn: Optional[str] = None
    buyer_inn: Optional[str] = None      # ИНН покупателя — для подбора организации-плательщика
    payment_purpose_requirement: Optional[str] = None
    is_invoice: Optional[bool] = None
    confidence: Optional[float] = None

class OcrRecognizeResponse(BaseModel):
    prefill: OcrPrefill
    warnings: list[str] = Field(default_factory=list)
    raw: dict = Field(default_factory=dict)


# --- Ответная схема ---

class RequestResponse(BaseModel):
    id: UUID
    request_number: Optional[str] = None
    amount: Decimal
    description: str
    note: Optional[str] = None
    payment_date: Optional[date] = None
    counterparty: str
    contract_status: Optional[bool]
    is_budgeted: Optional[bool] = None
    feo_note: Optional[str] = None
    special_order: bool
    priority: Optional[str] = None
    approval_status: str
    payment_status: str
    created_at: datetime
    rejection_reason: Optional[str] = None
    file_path: Optional[str] = None
    gate_approved_by: Optional[UUID] = None
    gate_reason: Optional[str] = None
    is_marked_for_deletion: bool = False

    # FK-поля (на случай если relationship не загружен)
    organization_id: UUID
    direction_id: UUID
    budget_item_id: UUID
    creator_id: UUID

    # Вложенные объекты
    organization: Optional[OrganizationBrief] = None
    direction: Optional[DirectionBrief] = None
    budget_item: Optional[BudgetItemBrief] = None
    creator: Optional[UserBrief] = None
    gate_approver: Optional[UserBrief] = None

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> float:
        # Frontend performs arithmetic on amount, so keep it a numeric JSON
        # value instead of Pydantic v2's default quoted-string Decimal output.
        return float(value)

    model_config = ConfigDict(from_attributes=True)
