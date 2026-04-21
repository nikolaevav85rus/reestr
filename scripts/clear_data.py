"""
Очистка всех данных, кроме пользователя admin и справочных таблиц.
Сохраняет: пользователя admin, все роли, права, группы, кластеры, организации, ЦФО, статьи ДДС.
Удаляет: заявки, аудит, уведомления, все пользователи кроме admin, календарь.
"""
import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, select
from app.db.database import AsyncSessionLocal
from app.models.user import User

CONFIRM_PHRASE = "да удалить"

async def clear():
    print("=" * 60)
    print("ОЧИСТКА ДАННЫХ РЕЕСТРА")
    print("=" * 60)
    print()
    print("Будет УДАЛЕНО:")
    print("  - Все платёжные заявки (payment_requests)")
    print("  - Журнал аудита (audit_logs)")
    print("  - Уведомления (notifications)")
    print("  - Платёжный календарь (payment_calendar)")
    print("  - Все пользователи КРОМЕ admin")
    print()
    print("Будет СОХРАНЕНО:")
    print("  - Пользователь admin")
    print("  - Роли и права (roles, permissions, role_permissions)")
    print("  - НСИ: организации, ЦФО, кластеры, группы, статьи ДДС")
    print()

    phrase = input(f'Для подтверждения введите: {CONFIRM_PHRASE}\n> ').strip().lower()
    if phrase != CONFIRM_PHRASE:
        print("Отменено.")
        return

    async with AsyncSessionLocal() as db:
        # Проверяем admin
        admin = (await db.execute(select(User).where(User.ad_login == "admin"))).scalar_one_or_none()
        if not admin:
            print("[!] Пользователь admin не найден — прерываем")
            return

        admin_id = admin.id
        print(f"\nadmin id: {admin_id}")

        # Порядок важен из-за FK
        steps = [
            ("notifications",    "DELETE FROM notifications"),
            ("audit_logs",       "DELETE FROM audit_logs"),
            ("payment_requests", "DELETE FROM payment_requests"),
            ("payment_calendar", "DELETE FROM payment_calendar"),
            ("users (not admin)",f"DELETE FROM users WHERE ad_login != 'admin'"),
        ]

        for label, sql in steps:
            result = await db.execute(text(sql))
            print(f"  [OK] {label}: удалено {result.rowcount} строк")

        await db.commit()
        print()
        print("Готово. База очищена, admin сохранён.")
        print("Запустите seed-скрипты для наполнения НСИ:")
        print("  python scripts/seed_rbac_matrix.py")
        print("  python scripts/seed_test_users.py")

if __name__ == "__main__":
    asyncio.run(clear())
