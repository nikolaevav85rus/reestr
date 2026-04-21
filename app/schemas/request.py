from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import datetime, date
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
    amount: float
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
    amount: Optional[float] = None
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


# --- Ответная схема ---

class RequestResponse(BaseModel):
    id: UUID
    request_number: Optional[str] = None
    amount: float
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

    model_config = ConfigDict(from_attributes=True)
