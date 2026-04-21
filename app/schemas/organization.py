from pydantic import BaseModel, ConfigDict
from uuid import UUID
from typing import Optional

# --- ПЛАТЕЖНЫЕ ГРУППЫ ---

class PaymentGroupBase(BaseModel):
    name: str
    description: Optional[str] = None 

class PaymentGroupCreate(PaymentGroupBase):
    pass

class PaymentGroupUpdate(BaseModel):
    """Схема для редактирования группы."""
    name: Optional[str] = None
    description: Optional[str] = None

class PaymentGroupResponse(PaymentGroupBase):
    id: UUID
    
    model_config = ConfigDict(from_attributes=True)

# --- ОРГАНИЗАЦИИ ---

class OrganizationBase(BaseModel):
    name: str
    inn: Optional[str] = None
    prefix: Optional[str] = None
    payment_group_id: UUID

class OrganizationCreate(OrganizationBase):
    pass

class OrganizationUpdate(BaseModel):
    """Схема для редактирования организации."""
    name: Optional[str] = None
    inn: Optional[str] = None
    prefix: Optional[str] = None
    payment_group_id: Optional[UUID] = None

class OrganizationResponse(OrganizationBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)