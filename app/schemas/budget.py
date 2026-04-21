from pydantic import BaseModel, ConfigDict
from typing import Optional
from uuid import UUID
from app.models.budget import BudgetItemCategory # Импортируем Enum из наших моделей

class BudgetItemBase(BaseModel):
    name: str
    category: BudgetItemCategory
    is_active: bool = True

class BudgetItemCreate(BudgetItemBase):
    pass

class BudgetItemResponse(BudgetItemBase):
    id: UUID
    
    model_config = ConfigDict(from_attributes=True)

# Схема для Маппинга (какие статьи доступны направлению)
class DirectionBudgetItemResponse(BaseModel):
    id: UUID
    direction_id: UUID
    budget_item_id: UUID
    
    model_config = ConfigDict(from_attributes=True)