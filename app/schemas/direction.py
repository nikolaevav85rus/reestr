from pydantic import BaseModel, ConfigDict
from typing import Optional
from uuid import UUID


class DirectionCategoryResponse(BaseModel):
    id: UUID
    name: str
    model_config = ConfigDict(from_attributes=True)


class DirectionBase(BaseModel):
    name: str
    category_id: Optional[UUID] = None


class DirectionCreate(DirectionBase):
    pass


class DirectionResponse(DirectionBase):
    id: UUID
    category: Optional[DirectionCategoryResponse] = None

    model_config = ConfigDict(from_attributes=True)
