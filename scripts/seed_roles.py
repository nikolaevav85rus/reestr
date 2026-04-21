import asyncio
import uuid
from sqlalchemy import insert, select
from app.db.database import AsyncSessionLocal
from app.models.user import Role

async def seed_roles():
    """
    Первичное наполнение таблицы ролей. 
    Без этих данных создание пользователей через API будет невозможно.
    """
    roles_data = [
        {"id": uuid.uuid4(), "name": "ADMIN", "label": "Администратор"},
        {"id": uuid.uuid4(), "name": "FEO", "label": "ФЭО (Финансист)"},
        {"id": uuid.uuid4(), "name": "CASHIER", "label": "Казначей"},
        {"id": uuid.uuid4(), "name": "ACCOUNTING", "label": "Бухгалтер"},
        {"id": uuid.uuid4(), "name": "DIRECTOR", "label": "Директор"},
        {"id": uuid.uuid4(), "name": "INITIATOR", "label": "Инициатор"},
    ]

    print("--- Наполнение справочника ролей ---")
    async with AsyncSessionLocal() as session:
        try:
            for role_info in roles_data:
                # Проверяем, существует ли роль, чтобы не дублировать
                check_stmt = select(Role).where(Role.name == role_info["name"])
                existing = await session.execute(check_stmt)
                
                if not existing.scalar_one_or_none():
                    stmt = insert(Role).values(**role_info)
                    await session.execute(stmt)
                    print(f"✅ Добавлена роль: {role_info['name']}")
                else:
                    print(f"⚠️ Роль {role_info['name']} уже есть в базе")
            
            await session.commit()
            print("--- Готово ---")
        except Exception as e:
            await session.rollback()
            print(f"❌ Ошибка: {e}")

if __name__ == "__main__":
    asyncio.run(seed_roles())