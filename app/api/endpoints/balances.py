from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import PermissionChecker, get_db
from app.models.balance import BankAccount, DailyAccountBalance
from app.models.organization import Organization
from app.models.user import User
from app.schemas.balance import (
    BankAccountCreate,
    BankAccountResponse,
    BankAccountUpdate,
    DailyAccountBalanceResponse,
    DailyAccountBalanceUpdate,
    DailyAccountBalanceUpsert,
)

router = APIRouter()
DAILY_BALANCE_CONFLICT_DETAIL = "Остаток на указанную дату и расчетный счет уже существует"


async def _ensure_organization_exists(db: AsyncSession, organization_id: UUID) -> None:
    organization = await db.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Организация не найдена")


async def _load_daily_balance(db: AsyncSession, balance_id: UUID) -> DailyAccountBalance:
    result = await db.execute(
        select(DailyAccountBalance)
        .options(
            selectinload(DailyAccountBalance.organization),
            selectinload(DailyAccountBalance.bank_account),
            selectinload(DailyAccountBalance.created_by),
            selectinload(DailyAccountBalance.updated_by),
        )
        .where(DailyAccountBalance.id == balance_id)
    )
    balance = result.scalar_one_or_none()
    if not balance:
        raise HTTPException(status_code=404, detail="Остаток не найден")
    return balance


async def _load_bank_account(db: AsyncSession, account_id: UUID) -> BankAccount:
    result = await db.execute(
        select(BankAccount)
        .options(selectinload(BankAccount.organization))
        .where(BankAccount.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Расчетный счет не найден")
    return account


@router.get("/accounts", response_model=List[BankAccountResponse])
async def get_bank_accounts(
    organization_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_view")),
):
    stmt = (
        select(BankAccount)
        .options(selectinload(BankAccount.organization))
        .order_by(BankAccount.is_active.desc(), BankAccount.bank_name, BankAccount.account_number)
    )
    if organization_id:
        stmt = stmt.where(BankAccount.organization_id == organization_id)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/accounts", response_model=BankAccountResponse)
async def create_bank_account(
    data: BankAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_manage")),
):
    await _ensure_organization_exists(db, data.organization_id)

    account = BankAccount(**data.model_dump())
    db.add(account)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Не удалось создать расчетный счет")

    return await _load_bank_account(db, account.id)


@router.put("/accounts/{account_id}", response_model=BankAccountResponse)
async def update_bank_account(
    account_id: UUID,
    data: BankAccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_manage")),
):
    account = await db.get(BankAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Расчетный счет не найден")

    update_data = data.model_dump(exclude_unset=True)
    if "organization_id" in update_data:
        await _ensure_organization_exists(db, update_data["organization_id"])

    for field, value in update_data.items():
        setattr(account, field, value)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Не удалось обновить расчетный счет")

    return await _load_bank_account(db, account.id)


@router.delete("/accounts/{account_id}")
async def delete_bank_account(
    account_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("dict_delete")),
):
    account = await db.get(BankAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Расчетный счет не найден")

    linked_balance = await db.execute(
        select(DailyAccountBalance.id)
        .where(DailyAccountBalance.bank_account_id == account_id)
        .limit(1)
    )
    if linked_balance.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить расчетный счет: по нему есть остатки. Отключите счет.",
        )

    await db.delete(account)
    await db.commit()
    return {"ok": True}


@router.get("/daily", response_model=List[DailyAccountBalanceResponse])
async def get_daily_balances(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    organization_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_view")),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from не может быть больше date_to")

    stmt = (
        select(DailyAccountBalance)
        .options(
            selectinload(DailyAccountBalance.organization),
            selectinload(DailyAccountBalance.bank_account),
            selectinload(DailyAccountBalance.created_by),
            selectinload(DailyAccountBalance.updated_by),
        )
        .order_by(DailyAccountBalance.balance_date.desc(), DailyAccountBalance.created_at.desc())
    )

    if organization_id:
        stmt = stmt.where(DailyAccountBalance.organization_id == organization_id)
    if date_from:
        stmt = stmt.where(DailyAccountBalance.balance_date >= date_from)
    if date_to:
        stmt = stmt.where(DailyAccountBalance.balance_date <= date_to)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/daily", response_model=DailyAccountBalanceResponse)
async def create_or_update_daily_balance(
    data: DailyAccountBalanceUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_manage")),
):
    await _ensure_organization_exists(db, data.organization_id)

    bank_account = await db.get(BankAccount, data.bank_account_id)
    if not bank_account:
        raise HTTPException(status_code=404, detail="Расчетный счет не найден")
    if bank_account.organization_id != data.organization_id:
        raise HTTPException(
            status_code=400,
            detail="Организация остатка не соответствует организации расчетного счета",
        )

    existing = await db.execute(
        select(DailyAccountBalance).where(
            DailyAccountBalance.balance_date == data.balance_date,
            DailyAccountBalance.bank_account_id == data.bank_account_id,
        )
    )
    balance = existing.scalar_one_or_none()

    if balance:
        balance.organization_id = data.organization_id
        balance.amount = data.amount
        balance.updated_by_id = current_user.id
    else:
        balance = DailyAccountBalance(
            balance_date=data.balance_date,
            organization_id=data.organization_id,
            bank_account_id=data.bank_account_id,
            amount=data.amount,
            created_by_id=current_user.id,
            updated_by_id=current_user.id,
        )
        db.add(balance)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Не удалось сохранить остаток")

    return await _load_daily_balance(db, balance.id)


@router.put("/daily/{balance_id}", response_model=DailyAccountBalanceResponse)
async def update_daily_balance(
    balance_id: UUID,
    data: DailyAccountBalanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_manage")),
):
    balance = await db.get(DailyAccountBalance, balance_id)
    if not balance:
        raise HTTPException(status_code=404, detail="Остаток не найден")

    bank_account = await db.get(BankAccount, data.bank_account_id)
    if not bank_account:
        raise HTTPException(status_code=404, detail="Расчетный счет не найден")

    conflict = await db.execute(
        select(DailyAccountBalance.id).where(
            DailyAccountBalance.id != balance_id,
            DailyAccountBalance.balance_date == data.balance_date,
            DailyAccountBalance.bank_account_id == data.bank_account_id,
        )
    )
    if conflict.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=DAILY_BALANCE_CONFLICT_DETAIL)

    balance.balance_date = data.balance_date
    balance.bank_account_id = data.bank_account_id
    balance.organization_id = bank_account.organization_id
    balance.amount = data.amount
    balance.updated_by_id = current_user.id

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail=DAILY_BALANCE_CONFLICT_DETAIL)

    return await _load_daily_balance(db, balance.id)


@router.delete("/daily/{balance_id}")
async def delete_daily_balance(
    balance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("account_balance_manage")),
):
    balance = await db.get(DailyAccountBalance, balance_id)
    if not balance:
        raise HTTPException(status_code=404, detail="Остаток не найден")

    await db.delete(balance)
    await db.commit()
    return {"ok": True}
