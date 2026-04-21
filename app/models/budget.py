import uuid
import enum
from sqlalchemy import Column, String, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.db.database import Base

class BudgetItemCategory(str, enum.Enum):
    TAXES = "TAXES"
    SALARY = "SALARY"
    BANK = "BANK"
    TRANSPORT = "TRANSPORT"
    SUPPLIERS = "SUPPLIERS"
    OTHER = "OTHER"

class BudgetItem(Base):
    __tablename__ = "budget_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, unique=True, nullable=False)
    category = Column(String, nullable=False) # Значение из BudgetItemCategory
    is_active = Column(Boolean, default=True)

class DirectionBudgetItem(Base):
    __tablename__ = "direction_budget_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    direction_id = Column(UUID(as_uuid=True), ForeignKey("directions.id"), nullable=False)
    budget_item_id = Column(UUID(as_uuid=True), ForeignKey("budget_items.id"), nullable=False)

    __table_args__ = (UniqueConstraint('direction_id', 'budget_item_id', name='_dir_budget_uc'),)