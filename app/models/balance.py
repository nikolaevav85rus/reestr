import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, String, Boolean, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


def get_gmt3_time():
    return datetime.now(timezone(timedelta(hours=3))).replace(tzinfo=None)


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    bank_name = Column(String, nullable=False)
    account_number = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)

    organization = relationship("Organization")
    balances = relationship("DailyAccountBalance", back_populates="bank_account")


class DailyAccountBalance(Base):
    __tablename__ = "daily_account_balances"
    __table_args__ = (
        UniqueConstraint("balance_date", "bank_account_id", name="uq_daily_account_balances_date_account"),
        Index("ix_daily_account_balances_date", "balance_date"),
        Index("ix_daily_account_balances_org", "organization_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    balance_date = Column(Date, nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    bank_account_id = Column(UUID(as_uuid=True), ForeignKey("bank_accounts.id"), nullable=False)
    amount = Column(Float, nullable=False)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_gmt3_time)
    updated_at = Column(DateTime, nullable=False, default=get_gmt3_time, onupdate=get_gmt3_time)

    organization = relationship("Organization")
    bank_account = relationship("BankAccount", back_populates="balances")
    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
