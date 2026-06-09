from pydantic import BaseModel, ConfigDict
from uuid import UUID
from typing import Optional

# --- ПЛАТЕЖНЫЕ ГРУППЫ ---

class PaymentGroupBase(BaseModel):
    name: str
    description: Optional[str] = None

class PaymentGroupCreate(PaymentGroupBase):
    """Создание группы оплаты. Фронтенд шлёт name + is_active."""
    model_config = ConfigDict(extra="ignore")
    is_active: bool = True

class PaymentGroupUpdate(BaseModel):
    """Редактирование группы оплаты (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class PaymentGroupResponse(PaymentGroupBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)

# --- ОРГАНИЗАЦИИ ---

class OrganizationBase(BaseModel):
    name: str
    inn: Optional[str] = None
    prefix: Optional[str] = None
    payment_group_id: UUID
    cluster_id: Optional[UUID] = None
    director_id: Optional[UUID] = None
    is_active: bool = True

class OrganizationCreate(OrganizationBase):
    """Создание организации (whitelist). Опасные ключи (id и т.п.) игнорируются."""
    model_config = ConfigDict(extra="ignore")

class OrganizationUpdate(BaseModel):
    """Редактирование организации (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    inn: Optional[str] = None
    prefix: Optional[str] = None
    payment_group_id: Optional[UUID] = None
    cluster_id: Optional[UUID] = None
    director_id: Optional[UUID] = None
    is_active: Optional[bool] = None

class OrganizationResponse(OrganizationBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)

# --- КЛАСТЕРЫ ---

class ClusterCreate(BaseModel):
    """Создание кластера (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: str
    head_id: Optional[UUID] = None
    is_active: bool = True

class ClusterUpdate(BaseModel):
    """Редактирование кластера (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    head_id: Optional[UUID] = None
    is_active: Optional[bool] = None
