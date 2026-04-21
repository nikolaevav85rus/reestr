import asyncio
from datetime import date, timedelta
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.models.organization import PaymentGroup, Organization
from app.models.direction import Direction
from app.models.budget import BudgetItem, DirectionBudgetItem, BudgetItemCategory
from app.models.calendar import WeeklyTemplate, PaymentCalendar, DayTypeRule

async def clear_database(db: AsyncSession):
    """Очистка таблиц перед заливкой (опционально, для чистоты эксперимента)."""
    # Удаляем в правильном порядке, чтобы не нарушить внешние ключи
    tables = [
        PaymentCalendar, DayTypeRule, WeeklyTemplate, 
        DirectionBudgetItem, BudgetItem, Direction, Organization, PaymentGroup
    ]
    for table in tables:
        await db.execute(table.__table__.delete())
    await db.commit()

async def seed_data():
    async with AsyncSessionLocal() as db:
        print("Начинаем заливку данных...")
        
        # Раскомментируй строку ниже, если хочешь, чтобы скрипт каждый раз затирал старые тестовые данные
        # await clear_database(db)

        # 1. Группа и Организация
        group = PaymentGroup(name="Метком Групп", description="Тестовая группа")
        db.add(group)
        await db.flush() # Получаем ID группы

        org = Organization(name="ООО Метком", payment_group_id=group.id)
        db.add(org)

        # 2. Направление (ЦФО)
        direction = Direction(name="Отдел продаж")
        db.add(direction)
        await db.flush()

        # 3. Статьи ДДС
        taxes_item = BudgetItem(name="Налог на прибыль", category=BudgetItemCategory.TAXES)
        suppliers_item = BudgetItem(name="Оплата за металл", category=BudgetItemCategory.SUPPLIERS)
        db.add_all([taxes_item, suppliers_item])
        await db.flush()

        # Маппинг (ЦФО имеет доступ к этим статьям)
        db.add(DirectionBudgetItem(direction_id=direction.id, budget_item_id=taxes_item.id))
        db.add(DirectionBudgetItem(direction_id=direction.id, budget_item_id=suppliers_item.id))

        # 4. Шаблон недели для Метком
        # 1-ПН(NON_PAYMENT), 2-ВТ(PAYMENT), 3-СР(NON_PAYMENT), 4-ЧТ(PAYMENT), 5-ПТ(SALARY_DAY), 6,7-ВЫХОДНЫЕ(HOLIDAY)
        templates = [
            WeeklyTemplate(payment_group_id=group.id, day_of_week=1, day_type="NON_PAYMENT"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=2, day_type="PAYMENT"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=3, day_type="NON_PAYMENT"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=4, day_type="PAYMENT"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=5, day_type="SALARY_DAY"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=6, day_type="HOLIDAY"),
            WeeklyTemplate(payment_group_id=group.id, day_of_week=7, day_type="HOLIDAY"),
        ]
        db.add_all(templates)

        # 5. Матрица ДДС (Правила)
        rules = [
            # В платежный день можно платить поставщикам и налоги
            DayTypeRule(day_type="PAYMENT", allowed_category=BudgetItemCategory.SUPPLIERS),
            DayTypeRule(day_type="PAYMENT", allowed_category=BudgetItemCategory.TAXES),
            # В день ЗП можно платить только ЗП (для примера опустим) и Налоги
            DayTypeRule(day_type="SALARY_DAY", allowed_category=BudgetItemCategory.TAXES),
        ]
        db.add_all(rules)

        # 6. Генерация календаря на Апрель 2026 (текущий месяц)
        start_date = date(2026, 4, 1)
        for i in range(30):
            current_date = start_date + timedelta(days=i)
            # isoweekday() возвращает: 1 - ПН, 7 - ВС
            day_of_week = current_date.isoweekday()
            
            # Ищем тип дня в шаблоне
            template = next((t for t in templates if t.day_of_week == day_of_week), None)
            day_type = template.day_type if template else "NON_PAYMENT"
            
            db.add(PaymentCalendar(
                date=current_date,
                payment_group_id=group.id,
                day_type=day_type
            ))

        await db.commit()
        print("Данные успешно залиты!")
        
        # Выводим ID для тестирования в Swagger
        print("\n--- СОХРАНИТЕ ЭТИ ID ДЛЯ ТЕСТА В SWAGGER ---")
        print(f"organization_id: {org.id}")
        print(f"direction_id:    {direction.id}")
        print(f"budget_item_id (Налоги):     {taxes_item.id}  (Разрешено во ВТ, ЧТ, ПТ)")
        print(f"budget_item_id (Поставщики): {suppliers_item.id} (Разрешено во ВТ, ЧТ, запрещено в ПТ)")

if __name__ == "__main__":
    asyncio.run(seed_data())