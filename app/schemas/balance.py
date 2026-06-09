from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_serializer


class OrganizationBrief(BaseModel):
    id: UUID
    name: str

    model_config = ConfigDict(from_attributes=True)


class UserBrief(BaseModel):
    id: UUID
    full_name: str
    ad_login: str

    model_config = ConfigDict(from_attributes=True)


class BankAccountBase(BaseModel):
    organization_id: UUID
    bank_name: str = Field(min_length=1, max_length=255)
    account_number: str = Field(min_length=1, max_length=255)
    is_active: bool = True


class BankAccountCreate(BankAccountBase):
    pass


class BankAccountUpdate(BaseModel):
    organization_id: Optional[UUID] = None
    bank_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    account_number: Optional[str] = Field(default=None, min_length=1, max_length=255)
    is_active: Optional[bool] = None


class BankAccountResponse(BankAccountBase):
    id: UUID
    organization: Optional[OrganizationBrief] = None

    model_config = ConfigDict(from_attributes=True)


class DailyAccountBalanceUpsert(BaseModel):
    balance_date: date
    organization_id: UUID
    bank_account_id: UUID
    amount: Decimal = Field(ge=0)


class DailyAccountBalanceUpdate(BaseModel):
    balance_date: date
    bank_account_id: UUID
    amount: Decimal = Field(ge=0)


class BankAccountBrief(BaseModel):
    id: UUID
    bank_name: str
    account_number: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class DailyAccountBalanceResponse(BaseModel):
    id: UUID
    balance_date: date
    organization_id: UUID
    bank_account_id: UUID
    amount: Decimal
    created_by_id: UUID
    updated_by_id: UUID
    created_at: datetime
    updated_at: datetime

    organization: Optional[OrganizationBrief] = None
    bank_account: Optional[BankAccountBrief] = None
    created_by: Optional[UserBrief] = None
    updated_by: Optional[UserBrief] = None

    @computed_field
    @property
    def opening_balance(self) -> float:
        # Frontend reads opening_balance/amount as numbers, so expose a float
        # to keep the JSON contract numeric (not a quoted Decimal string).
        return float(self.amount)

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> float:
        # Frontend performs arithmetic on amount, so keep it a numeric JSON
        # value instead of Pydantic v2's default quoted-string Decimal output.
        return float(value)

    model_config = ConfigDict(from_attributes=True)
