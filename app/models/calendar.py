import uuid
from sqlalchemy import Column, String, ForeignKey, Date, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base

class WeeklyTemplate(Base):
    """Шаблон недели: задает стандартный ритм для Платежной группы."""
    __tablename__ = "weekly_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_group_id = Column(UUID(as_uuid=True), ForeignKey("payment_groups.id"), nullable=False)
    
    # День недели: 1 - Понедельник, ..., 7 - Воскресенье
    day_of_week = Column(Integer, nullable=False) 
    
    # Тип дня (PAYMENT, SALARY_DAY, NON_PAYMENT, HOLIDAY)
    day_type = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint('payment_group_id', 'day_of_week', name='_group_day_uc'),)


class PaymentCalendar(Base):
    """Рабочий календарь: сгенерированные дни на конкретные даты."""
    __tablename__ = "payment_calendar"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date = Column(Date, nullable=False, index=True)
    payment_group_id = Column(UUID(as_uuid=True), ForeignKey("payment_groups.id"), nullable=False)
    
    day_type = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint('date', 'payment_group_id', name='_date_group_uc'),)


class DayTypeRule(Base):
    """Матрица ДДС: какие категории статей разрешены в какой тип дня."""
    __tablename__ = "day_type_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    day_type = Column(String, nullable=False, index=True) 
    allowed_category = Column(String, nullable=False)     

    __table_args__ = (UniqueConstraint('day_type', 'allowed_category', name='_type_category_uc'),)