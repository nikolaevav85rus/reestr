from pydantic import BaseModel, ConfigDict
from uuid import UUID
from datetime import date

# --- Weekly Template ---
class WeeklyTemplateBase(BaseModel):
    payment_group_id: UUID
    day_of_week: int
    day_type: str

class WeeklyTemplateCreate(WeeklyTemplateBase):
    pass

class WeeklyTemplateResponse(WeeklyTemplateBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

# --- Payment Calendar ---
class PaymentCalendarBase(BaseModel):
    date: date
    payment_group_id: UUID
    day_type: str

class PaymentCalendarCreate(PaymentCalendarBase):
    pass

class PaymentCalendarResponse(PaymentCalendarBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)

# --- Day Type Rule (Матрица ДДС) ---
class DayTypeRuleBase(BaseModel):
    day_type: str
    allowed_category: str

class DayTypeRuleCreate(DayTypeRuleBase):
    pass

class DayTypeRuleResponse(DayTypeRuleBase):
    id: UUID
    model_config = ConfigDict(from_attributes=True)