"""Создание тестовых пользователей для тестирования."""
import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.models.user import User, Role
from app.core.security import get_password_hash

TEST_USERS = [
    {"ad_login": "admin",       "full_name": "Администратор",       "role_name": "ADMIN",       "password": "Test1234!"},
    {"ad_login": "initiator1",  "full_name": "Иванов И.И.",         "role_name": "INITIATOR",   "password": "Test1234!"},
    {"ad_login": "feo1",        "full_name": "Петров П.П.",         "role_name": "FEO",         "password": "Test1234!"},
    {"ad_login": "cashier1",    "full_name": "Сидоров С.С.",        "role_name": "CASHIER",     "password": "Test1234!"},
    {"ad_login": "accountant1", "full_name": "Козлова К.К.",        "role_name": "ACCOUNTING",  "password": "Test1234!"},
    {"ad_login": "director1",   "full_name": "Директоров Д.Д.",     "role_name": "DIRECTOR",    "password": "Test1234!"},
]

async def seed_users():
    async with AsyncSessionLocal() as db:
        for u in TEST_USERS:
            res = await db.execute(select(User).where(User.ad_login == u["ad_login"]))
            if res.scalar_one_or_none():
                print(f"  [~] Пользователь уже существует: {u['ad_login']}")
                continue

            res_role = await db.execute(select(Role).where(Role.name == u["role_name"]))
            role = res_role.scalar_one_or_none()
            if not role:
                print(f"  [!] Роль не найдена: {u['role_name']} — пропускаю")
                continue

            user = User(
                ad_login=u["ad_login"],
                full_name=u["full_name"],
                hashed_password=get_password_hash(u["password"]),
                role_id=role.id,
                is_active=True,
            )
            db.add(user)
            print(f"  [+] Создан: {u['ad_login']} / {u['password']} ({u['role_name']})")

        await db.commit()
        print("\nГотово. Пароль для всех: Test1234!")

if __name__ == "__main__":
    asyncio.run(seed_users())
