from pydantic import BaseModel, ConfigDict, computed_field
from typing import Optional
from uuid import UUID

# --- Вложенные схемы для красивого ответа фронтенду ---

class RoleResponse(BaseModel):
    id: UUID
    name: str
    label: str
    is_superadmin: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

class DirectionResponse(BaseModel):
    id: UUID
    name: str
    
    model_config = ConfigDict(from_attributes=True)

# --- Основные схемы пользователя ---

class UserBase(BaseModel):
    ad_login: str
    full_name: str
    is_active: bool = True

class UserCreate(UserBase):
    password: str
    role: str # При создании ждем строку (например, "ADMIN")
    direction_id: Optional[UUID] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    direction_id: Optional[UUID] = None
    is_active: Optional[bool] = None

class UserPasswordUpdate(BaseModel):
    password: str

class UserResponse(UserBase):
    id: UUID
    direction_id: Optional[UUID] = None

    # При ответе отдаем полноценные объекты, чтобы фронтенд мог вытащить label и name
    role: Optional[RoleResponse] = None
    direction: Optional[DirectionResponse] = None

    @computed_field
    @property
    def is_superadmin(self) -> bool:
        return bool(self.role and self.role.is_superadmin is True)

    model_config = ConfigDict(from_attributes=True)