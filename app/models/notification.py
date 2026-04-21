import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, timedelta

from app.db.database import Base


def get_gmt3_time():
    return datetime.now(timezone(timedelta(hours=3))).replace(tzinfo=None)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    request_id = Column(UUID(as_uuid=True), ForeignKey("payment_requests.id", ondelete="CASCADE"), nullable=True)
    text = Column(Text, nullable=False)
    type = Column(String(50), nullable=False)  # REJECTED, CLARIFICATION, POSTPONED, SUSPENDED, GATE_REJECTED, OFF_BUDGET, EOD_UNPAID
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=get_gmt3_time)

    user = relationship("User", foreign_keys=[user_id])
