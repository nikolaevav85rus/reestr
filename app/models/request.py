import uuid
import enum
from sqlalchemy import Column, String, Float, DateTime, Date, ForeignKey, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, timedelta

from app.db.database import Base

# Разделенные статусы
class ApprovalStatus(str, enum.Enum):
    DRAFT = "DRAFT"                 # Черновик
    PENDING_GATE = "PENDING_GATE"   # Ожидает разрешения шлюза (ФЭО)
    PENDING = "PENDING"             # На согласовании
    MEMO_REQUIRED = "MEMO_REQUIRED" # Вне бюджета, требуется обоснование инициатора
    PENDING_MEMO = "PENDING_MEMO"   # Вне бюджета, ожидает утверждения Директора
    CLARIFICATION = "CLARIFICATION" # Уточнение
    APPROVED = "APPROVED"           # Утверждено
    REJECTED = "REJECTED"           # Отклонено
    POSTPONED = "POSTPONED"         # Перенос
    SUSPENDED = "SUSPENDED"         # Отложена (недостаточно средств)

class PaymentStatus(str, enum.Enum):
    UNPAID = "UNPAID" # Не оплачено
    PAID = "PAID"     # Оплачено

def get_gmt3_time():
    tz_moscow = timezone(timedelta(hours=3))
    return datetime.now(tz_moscow).replace(tzinfo=None)

class PaymentRequest(Base):
    __tablename__ = "payment_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_number = Column(String(30), nullable=True, unique=True)
    amount = Column(Float, nullable=False)
    description = Column(String, nullable=False)
    created_at = Column(DateTime, default=get_gmt3_time)
    payment_date = Column(Date, nullable=True) 
    
    # НОВОЕ: Ссылки на справочники
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    direction_id = Column(UUID(as_uuid=True), ForeignKey("directions.id"), nullable=False)
    budget_item_id = Column(UUID(as_uuid=True), ForeignKey("budget_items.id"), nullable=False)
    
    # НОВОЕ: Дополнительные реквизиты
    counterparty = Column(String, nullable=False)                  # Контрагент
    note = Column(String, nullable=True)                           # Описание (смысловое, для внутреннего использования)
    contract_status = Column(Boolean, nullable=True, default=None)  # Наличие договора: None=Необработано, True=Есть, False=Нет
    is_budgeted = Column(Boolean, nullable=True, default=None)     # Бюджет: None=Не указано, True=Да, False=Нет
    feo_note = Column(String, nullable=True)                       # Примечание ФЭО
    special_order = Column(Boolean, default=False)                 # Спец. распоряжение
    priority = Column(String, nullable=True)                       # Приоритет
    
    # НОВОЕ: Разделенные статусы вместо одного
    approval_status = Column(String, default=ApprovalStatus.DRAFT)
    payment_status = Column(String, default=PaymentStatus.UNPAID)
    
    file_path = Column(String, nullable=True)
    rejection_reason = Column(String, nullable=True)               # Причина (для Отклонено/Уточнение)
    gate_approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    gate_reason = Column(Text, nullable=True)                      # Комментарий ФЭО при разрешении шлюза
    
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    is_marked_for_deletion = Column(Boolean, default=False, nullable=False, server_default="false")

    # Relationships
    organization = relationship("Organization")
    direction = relationship("Direction")
    budget_item = relationship("BudgetItem")
    creator = relationship("User", foreign_keys=[creator_id])
    gate_approver = relationship("User", foreign_keys=[gate_approved_by])
