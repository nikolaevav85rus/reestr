from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete
from uuid import UUID
from typing import Optional
from fastapi import HTTPException, status
from datetime import date
import calendar as cal_module

from app.models.user import Role
from app.models.organization import PaymentGroup, Organization
from app.models.direction import Direction
from app.models.budget import BudgetItem
from app.models.calendar import DayTypeRule, PaymentCalendar, WeeklyTemplate

from app.schemas.organization import (
    PaymentGroupCreate, PaymentGroupUpdate, 
    OrganizationCreate, OrganizationUpdate
)
from app.schemas.direction import DirectionCreate
from app.schemas.budget import BudgetItemCreate
from app.schemas.calendar import DayTypeRuleCreate

async def get_roles(db: AsyncSession):
    result = await db.execute(select(Role))
    return result.scalars().all()

async def get_payment_groups(db: AsyncSession, search: Optional[str] = None):
    query = select(PaymentGroup)
    if search:
        query = query.where(PaymentGroup.name.ilike(f"%{search}%"))
    query = query.order_by(PaymentGroup.name)
    result = await db.execute(query)
    return result.scalars().all()

async def create_payment_group(db: AsyncSession, group_in: PaymentGroupCreate):
    db_group = PaymentGroup(**group_in.model_dump())
    db.add(db_group)
    await db.commit()
    await db.refresh(db_group)
    return db_group

async def update_payment_group(db: AsyncSession, group_id: UUID, group_in: PaymentGroupUpdate):
    result = await db.execute(select(PaymentGroup).where(PaymentGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    
    update_data = group_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(group, key, value)
        
    await db.commit()
    await db.refresh(group)
    return group

async def delete_payment_group(db: AsyncSession, group_id: UUID):
    result = await db.execute(select(PaymentGroup).where(PaymentGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
        
    # Проверка 1: Наличие привязанных организаций
    orgs_result = await db.execute(select(Organization).where(Organization.payment_group_id == group_id))
    if orgs_result.scalars().first():
        raise HTTPException(status_code=400, detail="Нельзя удалить: к группе привязаны организации")

    # Проверка 2: Наличие записей в платежном календаре
    calendar_result = await db.execute(select(PaymentCalendar).where(PaymentCalendar.payment_group_id == group_id))
    if calendar_result.scalars().first():
        raise HTTPException(status_code=400, detail="Нельзя удалить: для группы уже сгенерирован платежный календарь")

    # Удаляем, если проверок пройдено
    await db.execute(delete(PaymentGroup).where(PaymentGroup.id == group_id))
    await db.commit()
    return {"message": "Группа удалена"}

async def get_organizations(db: AsyncSession, search: Optional[str] = None):
    query = select(Organization)
    if search:
        query = query.where(
            or_(
                Organization.name.ilike(f"%{search}%"),
                Organization.inn.ilike(f"%{search}%")
            )
        )
    query = query.order_by(Organization.name)
    result = await db.execute(query)
    return result.scalars().all()

async def create_organization(db: AsyncSession, org_in: OrganizationCreate):
    db_org = Organization(**org_in.model_dump())
    db.add(db_org)
    await db.commit()
    await db.refresh(db_org)
    return db_org

async def update_organization(db: AsyncSession, org_id: UUID, org_in: OrganizationUpdate):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Организация не найдена")
        
    update_data = org_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(org, key, value)
        
    await db.commit()
    await db.refresh(org)
    return org

async def delete_organization(db: AsyncSession, org_id: UUID):
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Организация не найдена")
        
    # Здесь тоже в будущем можно добавить проверку на наличие заявок (Request) 
    # от этой организации перед удалением.
    
    await db.execute(delete(Organization).where(Organization.id == org_id))
    await db.commit()
    return {"message": "Организация удалена"}

async def get_directions(db: AsyncSession):
    result = await db.execute(select(Direction).order_by(Direction.name))
    return result.scalars().all()

async def create_direction(db: AsyncSession, dir_in: DirectionCreate):
    db_dir = Direction(**dir_in.model_dump())
    db.add(db_dir)
    await db.commit()
    await db.refresh(db_dir)
    return db_dir

async def get_budget_items(db: AsyncSession):
    result = await db.execute(select(BudgetItem).order_by(BudgetItem.name))
    return result.scalars().all()

async def create_budget_item(db: AsyncSession, item_in: BudgetItemCreate):
    db_item = BudgetItem(**item_in.model_dump())
    db.add(db_item)
    await db.commit()
    await db.refresh(db_item)
    return db_item

async def get_day_type_rules(db: AsyncSession):
    result = await db.execute(select(DayTypeRule))
    return result.scalars().all()

async def create_day_type_rule(db: AsyncSession, rule_in: DayTypeRuleCreate):
    db_rule = DayTypeRule(**rule_in.model_dump())
    db.add(db_rule)
    await db.commit()
    await db.refresh(db_rule)
    return db_rule

async def generate_calendar_month(db: AsyncSession, group_id: UUID, year: int, month: int):
    # Загружаем шаблон недели для группы
    templates_result = await db.execute(
        select(WeeklyTemplate).where(WeeklyTemplate.payment_group_id == group_id)
    )
    template_map = {t.day_of_week: t.day_type for t in templates_result.scalars().all()}

    last_day = cal_module.monthrange(year, month)[1]

    for day_num in range(1, last_day + 1):
        current_date = date(year, month, day_num)
        dow = current_date.isoweekday()  # 1=Пн … 7=Вс
        day_type = template_map.get(dow, "NON_PAYMENT")

        existing_result = await db.execute(
            select(PaymentCalendar).where(
                PaymentCalendar.date == current_date,
                PaymentCalendar.payment_group_id == group_id,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            existing.day_type = day_type
        else:
            db.add(PaymentCalendar(date=current_date, payment_group_id=group_id, day_type=day_type))

    await db.commit()
    return {"message": f"Сгенерировано {last_day} дней для {month}.{year}", "count": last_day}