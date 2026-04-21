from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID
from datetime import date

from app.api.deps import get_db, PermissionChecker
from app.schemas.calendar import (
    DayTypeRuleCreate, DayTypeRuleResponse,
    WeeklyTemplateCreate, WeeklyTemplateResponse,
    PaymentCalendarResponse,
)
from app.services import dict_service
from app.models.calendar import DayTypeRule, WeeklyTemplate, PaymentCalendar
from app.models.user import User

router = APIRouter()

# --- Матрица ДДС (DayTypeRules) ---

@router.get("/rules", response_model=List[DayTypeRuleResponse])
async def get_rules(db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_view"))):
    return await dict_service.get_day_type_rules(db)

@router.post("/rules", response_model=DayTypeRuleResponse)
async def create_rule(rule: DayTypeRuleCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    try:
        return await dict_service.create_day_type_rule(db, rule)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Такое правило уже существует")

@router.delete("/rules/{id}")
async def delete_rule(id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    await db.execute(delete(DayTypeRule).where(DayTypeRule.id == id))
    await db.commit()
    return {"ok": True}

# --- Шаблоны недели (WeeklyTemplate) ---

@router.get("/templates", response_model=List[WeeklyTemplateResponse])
async def get_templates(group_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_view"))):
    result = await db.execute(
        select(WeeklyTemplate)
        .where(WeeklyTemplate.payment_group_id == group_id)
        .order_by(WeeklyTemplate.day_of_week)
    )
    return result.scalars().all()

@router.put("/templates", response_model=WeeklyTemplateResponse)
async def upsert_template(template: WeeklyTemplateCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    result = await db.execute(
        select(WeeklyTemplate).where(
            WeeklyTemplate.payment_group_id == template.payment_group_id,
            WeeklyTemplate.day_of_week == template.day_of_week,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.day_type = template.day_type
        await db.commit()
        await db.refresh(existing)
        return existing
    new_tmpl = WeeklyTemplate(**template.model_dump())
    db.add(new_tmpl)
    await db.commit()
    await db.refresh(new_tmpl)
    return new_tmpl

@router.delete("/templates/{id}")
async def delete_template(id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    await db.execute(delete(WeeklyTemplate).where(WeeklyTemplate.id == id))
    await db.commit()
    return {"ok": True}

# --- Платёжный календарь (PaymentCalendar) ---

@router.get("/calendar", response_model=List[PaymentCalendarResponse])
async def get_calendar(group_id: UUID, year: int, month: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_view"))):
    start = date(year, month, 1)
    import calendar as cal_mod
    end = date(year, month, cal_mod.monthrange(year, month)[1])
    result = await db.execute(
        select(PaymentCalendar)
        .where(
            PaymentCalendar.payment_group_id == group_id,
            PaymentCalendar.date >= start,
            PaymentCalendar.date <= end,
        )
        .order_by(PaymentCalendar.date)
    )
    return result.scalars().all()

@router.put("/calendar/{id}", response_model=PaymentCalendarResponse)
async def update_calendar_day(id: UUID, data: dict, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    day = await db.get(PaymentCalendar, id)
    if not day:
        raise HTTPException(status_code=404, detail="День не найден в календаре")
    day.day_type = data['day_type']
    await db.commit()
    await db.refresh(day)
    return day

@router.post("/generate")
async def generate_calendar(group_id: UUID, year: int, month: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(PermissionChecker("cal_manage"))):
    return await dict_service.generate_calendar_month(db, group_id, year, month)
