import asyncio
import sys
import os

# Добавляем корневую директорию проекта в sys.path, чтобы импорты из app работали
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.models.user import Role, Permission
from app.models.organization import PaymentGroup

async def seed_rbac():
    async with AsyncSessionLocal() as db:
        print("🚀 Запуск процесса наполнения матрицы прав...")

        # 1. ПОЛНЫЙ РЕЕСТР ПРАВ (PERMISSIONS)
        permissions_data = [
            # Системные
            {"name": "rbac_manage", "label": "Управление доступом", "category": "1. Система"},
            {"name": "subst_manage", "label": "Управление замещениями", "category": "1. Система"},
            
            # Сотрудники
            {"name": "user_view", "label": "Просмотр списка сотрудников", "category": "2. Сотрудники"},
            {"name": "user_edit", "label": "Управление профилями", "category": "2. Сотрудники"},
            {"name": "user_pass", "label": "Сброс паролей", "category": "2. Сотрудники"},
            {"name": "user_delete", "label": "Удаление сотрудников", "category": "2. Сотрудники"},
            
            # Справочники
            {"name": "dict_view", "label": "Просмотр справочников", "category": "3. Справочники"},
            {"name": "dict_edit", "label": "Создание и правка справочников", "category": "3. Справочники"},
            {"name": "dict_delete", "label": "Удаление из справочников", "category": "3. Справочники"},
            
            # Заявки (Workflow)
            {"name": "req_create", "label": "Создание заявок", "category": "4. Заявки (Действия)"},
            {"name": "req_reject", "label": "Отклонение / Уточнение", "category": "4. Заявки (Действия)"},
            {"name": "req_move_date", "label": "Перенос даты оплаты", "category": "4. Заявки (Действия)"},
            {"name": "req_edit_all", "label": "Редактирование любых заявок", "category": "4. Заявки (Действия)"},
            {"name": "req_approve", "label": "Утверждение (Виза ФЭО)", "category": "4. Заявки (Действия)"},
            {"name": "gate_approve", "label": "Разрешение экстренных платежей", "category": "4. Заявки (Действия)"},
            {"name": "req_set_contract", "label": "Простановка статуса договора", "category": "4. Заявки (Действия)"},
            {"name": "memo_approve", "label": "Согласование служебной записки", "category": "4. Заявки (Действия)"},
            {"name": "req_pay", "label": "Проведение оплаты", "category": "4. Заявки (Действия)"},
            {"name": "req_suspend", "label": "Подвешивание и перенос заявки (ФЭО)", "category": "4. Заявки (Действия)"},
            
            # Видимость (Уровни доступа)
            {"name": "req_view_own", "label": "Просмотр только своих заявок", "category": "5. Видимость"},
            {"name": "req_view_dept", "label": "Просмотр заявок своего отдела (ЦФО)", "category": "5. Видимость"},
            {"name": "req_view_org", "label": "Просмотр заявок своей орг. (Директор)", "category": "5. Видимость"},
            {"name": "req_view_cluster", "label": "Просмотр заявок кластера (Рук. кластера)", "category": "5. Видимость"},
            {"name": "req_view_all", "label": "Просмотр всех заявок компании", "category": "5. Видимость"},
            {"name": "cashier_workspace_view", "label": "Рабочее пространство казначея", "category": "5. Видимость"},
            {"name": "req_export_excel", "label": "Выгрузка реестров в Excel", "category": "5. Видимость"},
            
            # Календарь
            {"name": "cal_view", "label": "Просмотр календаря", "category": "6. Календарь"},
            {"name": "cal_manage", "label": "Управление календарем", "category": "6. Календарь"},
        ]

        # Синхронизация прав с БД
        perm_map = {}
        for p_data in permissions_data:
            res = await db.execute(select(Permission).where(Permission.name == p_data["name"]))
            perm = res.scalar_one_or_none()
            if not perm:
                perm = Permission(**p_data)
                db.add(perm)
                await db.flush()
                print(f"  [+] Право создано: {p_data['name']}")
            else:
                perm.label = p_data["label"]
                perm.category = p_data["category"]
                print(f"  [*] Право обновлено: {p_data['name']}")
            perm_map[p_data["name"]] = perm

        # 2. НАСТРОЙКА РОЛЕЙ (СВЯЗИ)
        
        async def assign_permissions(role_name, codes):
            res = await db.execute(select(Role).where(Role.name == role_name))
            role = res.scalar_one_or_none()
            if role:
                # Очищаем старые права и добавляем новые
                role.permissions = [perm_map[c] for c in codes if c in perm_map]
                print(f"✅ Роль '{role.label}' успешно связана с правами ({len(codes)} шт.)")
            else:
                print(f"⚠️ Внимание: Роль '{role_name}' не найдена в БД!")

        # Инициатор
        await assign_permissions("INITIATOR", ["req_create", "req_view_own", "dict_view", "cal_view"])
        
        # Казначей (проведение оплат)
        await assign_permissions("CASHIER", [
            "req_pay", "cashier_workspace_view", "req_export_excel",
            "req_view_all", "req_view_own", "dict_view", "cal_view"
        ])

        # ФЭО (основная мощь)
        await assign_permissions("FEO", [
            "req_view_all", "req_view_own", "req_approve", "req_edit_all",
            "gate_approve", "req_suspend", "cashier_workspace_view", "req_export_excel",
            "dict_view", "dict_edit", "cal_view", "cal_manage"
        ])

        # Директор
        await assign_permissions("DIRECTOR", ["req_view_own", "req_view_org", "memo_approve", "dict_view", "cal_view"])

        # Бухгалтерия
        await assign_permissions("ACCOUNTING", ["req_view_own", "req_view_all", "req_set_contract", "dict_view", "cal_view"])

        # Проверка и создание дефолтной группы (если нужно)
        res_pg = await db.execute(select(PaymentGroup))
        if not res_pg.scalars().first():
            db.add(PaymentGroup(name="Основная группа"))
            print("📦 Создана дефолтная Группа оплаты")

        await db.commit()
        print("\n✨ Матрица прав успешно развернута в базе данных!")

if __name__ == "__main__":
    asyncio.run(seed_rbac())
