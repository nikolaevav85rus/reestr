from pydantic import BaseModel, ConfigDict
from typing import Optional
from uuid import UUID


class DirectionCategoryResponse(BaseModel):
    id: UUID
    name: str
    model_config = ConfigDict(from_attributes=True)


class DirectionCategoryCreate(BaseModel):
    """Создание/редактирование категории ЦФО (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: str


class DirectionCategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None


class DirectionBase(BaseModel):
    name: str
    category_id: Optional[UUID] = None


class DirectionCreate(DirectionBase):
    """Создание ЦФО (whitelist). Фронтенд шлёт name, category_id, is_active."""
    model_config = ConfigDict(extra="ignore")
    is_active: bool = True


class DirectionUpdate(BaseModel):
    """Редактирование ЦФО (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    category_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class DirectionResponse(DirectionBase):
    id: UUID
    category: Optional[DirectionCategoryResponse] = None

    model_config = ConfigDict(from_attributes=True)
