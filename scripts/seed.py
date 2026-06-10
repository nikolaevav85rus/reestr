"""Канонический идемпотентный сидер базы реестра платёжных заявок.

Запуск ПОСЛЕ `alembic upgrade head` на чистой (или уже наполненной) БД:

    python -m scripts.seed
    # или
    python scripts/seed.py

Что делает (всё идемпотентно — upsert по натуральному ключу, повторный
запуск не плодит дубликатов):

  1. RBAC: роли + права + связи ролей с правами
     (переиспользует логику scripts/seed_roles.py и scripts/seed_rbac_matrix.py).
  2. Суперадмин: роль ADMIN помечается is_superadmin=True (God Mode), без этого
     admin1 не получает доступ ко всем организациям и не проходит balance-тесты.
  3. Тестовые пользователи — ВСЕ с паролем "1234":
       admin1       -> ADMIN (суперадмин)
       feo1         -> FEO
       cashier1     -> CASHIER
       initiator1   -> INITIATOR
       accountant1  -> ACCOUNTING
       director1    -> DIRECTOR
  4. НСИ: несколько организаций (С ИНН) в платёжной группе, направления (ЦФО)
     с категориями, статьи ДДС, маппинг направление<->статья, недельный
     шаблон и базовая матрица ДДС.
  5. user_organizations: cashier1 и feo1 назначаются на ВСЕ организации,
     чтобы проходили тесты остатков (balances) — не-суперадмин видит/правит
     остатки только по назначенным ему организациям.

ВНИМАНИЕ: не запускайте против live-БД без необходимости. Скрипт безопасен
для повторного запуска, но это всё же запись в базу.
"""
import asyncio
import os
import sys
from datetime import date, timedelta

# Добавляем корень проекта в sys.path, чтобы импорты из app/scripts работали
# и при запуске как `python scripts/seed.py`, и как `python -m scripts.seed`.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.append(_ROOT)

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.user import User, Role, user_organizations
from app.models.organization import PaymentGroup, Organization
from app.models.direction import Direction, DirectionCategory
from app.models.budget import BudgetItem, DirectionBudgetItem, BudgetItemCategory
from app.models.calendar import WeeklyTemplate, DayTypeRule

# Переиспользуем существующую логику наполнения RBAC, чтобы не дублировать её.
from scripts.seed_roles import seed_roles
from scripts.seed_rbac_matrix import seed_rbac

# ─── ЕДИНЫЙ ПАРОЛЬ ДЛЯ ВСЕХ ТЕСТОВЫХ ПОЛЬЗОВАТЕЛЕЙ ───────────────────────────
# Должен совпадать с frontend/tests/helpers/api.ts (TEST_PASSWORD ?? '1234').
TEST_PASSWORD = "1234"

# ad_login -> (full_name, role_name). admin1 — суперадмин (роль ADMIN, см. ниже).
TEST_USERS = [
    ("admin1",      "Администратор",   "ADMIN"),
    ("feo1",        "Петров П.П.",     "FEO"),
    ("cashier1",    "Сидоров С.С.",    "CASHIER"),
    ("initiator1",  "Иванов И.И.",     "INITIATOR"),
    ("accountant1", "Козлова К.К.",    "ACCOUNTING"),
    ("director1",   "Директоров Д.Д.", "DIRECTOR"),
]

# Организации НСИ: (name, inn). ИНН обязателен для авто-выбора организации по
# покупателю (OCR) и для card-тестов справочников.
SEED_ORGANIZATIONS = [
    ("ООО Метком",      "7701234567"),
    ("ООО МеткомТрейд", "7702345678"),
    ("АО МеткомСталь",  "7703456789"),
]

# Направления (ЦФО): (name, category_name).
SEED_DIRECTIONS = [
    ("Отдел продаж",      "Коммерция"),
    ("Производство",      "Операции"),
    ("Административный",   "Бэк-офис"),
]

# Статьи ДДС: (name, category enum).
SEED_BUDGET_ITEMS = [
    ("Налог на прибыль",  BudgetItemCategory.TAXES),
    ("Оплата за металл",  BudgetItemCategory.SUPPLIERS),
    ("Заработная плата",  BudgetItemCategory.SALARY),
    ("Банковская комиссия", BudgetItemCategory.BANK),
    ("Транспортные услуги", BudgetItemCategory.TRANSPORT),
]


async def _ensure_superadmin_role(db: AsyncSession) -> None:
    """Помечает роль ADMIN как суперадминскую (God Mode).

    seed_rbac_matrix создаёт права, но НЕ выдаёт ADMIN полный доступ через
    permissions — у суперадмина доступ ко всему через is_superadmin=True.
    Без этого admin1 не видит все организации (balance-тесты падают) и
    user.is_superadmin в ответе логина будет ложным.
    """
    res = await db.execute(select(Role).where(Role.name == "ADMIN"))
    admin_role = res.scalar_one_or_none()
    if admin_role is None:
        # На случай, если seed_roles почему-то не создал роль.
        admin_role = Role(name="ADMIN", label="Администратор")
        db.add(admin_role)
        await db.flush()
    if not admin_role.is_superadmin:
        admin_role.is_superadmin = True
        print("  [*] Роль ADMIN помечена как суперадмин (is_superadmin=True)")
    await db.commit()


async def _seed_users(db: AsyncSession) -> None:
    """Создаёт/обновляет тестовых пользователей. Пароль у всех — TEST_PASSWORD."""
    print("--- Тестовые пользователи (пароль у всех: %s) ---" % TEST_PASSWORD)
    # Карта ролей по имени.
    res = await db.execute(select(Role))
    roles = {r.name: r for r in res.scalars().all()}

    for ad_login, full_name, role_name in TEST_USERS:
        role = roles.get(role_name)
        if role is None:
            print(f"  [!] Роль не найдена: {role_name} — пропускаю {ad_login}")
            continue

        res_u = await db.execute(select(User).where(User.ad_login == ad_login))
        user = res_u.scalar_one_or_none()

        if user is None:
            user = User(
                ad_login=ad_login,
                full_name=full_name,
                hashed_password=get_password_hash(TEST_PASSWORD),
                role_id=role.id,
                is_active=True,
            )
            db.add(user)
            print(f"  [+] Создан: {ad_login} ({role_name})")
        else:
            # Идемпотентно подтягиваем профиль/пароль/роль к каноническому виду.
            user.full_name = full_name
            user.role_id = role.id
            user.is_active = True
            user.hashed_password = get_password_hash(TEST_PASSWORD)
            print(f"  [~] Обновлён: {ad_login} ({role_name})")

    await db.commit()


async def _seed_nsi(db: AsyncSession) -> dict:
    """Идемпотентно создаёт НСИ: группа, организации (с ИНН), ЦФО, статьи ДДС.

    Возвращает dict со ссылками на ключевые объекты для печати ID.
    """
    print("--- НСИ (организации, ЦФО, статьи ДДС) ---")

    # 1. Платёжная группа (натуральный ключ — name).
    group_name = "Метком Групп"
    res = await db.execute(select(PaymentGroup).where(PaymentGroup.name == group_name))
    group = res.scalar_one_or_none()
    if group is None:
        group = PaymentGroup(name=group_name)
        db.add(group)
        await db.flush()
        print(f"  [+] Платёжная группа: {group_name}")

    # 2. Организации (натуральный ключ — name). Доливаем ИНН при необходимости.
    organizations = []
    for name, inn in SEED_ORGANIZATIONS:
        res = await db.execute(select(Organization).where(Organization.name == name))
        org = res.scalar_one_or_none()
        if org is None:
            org = Organization(name=name, inn=inn, payment_group_id=group.id)
            db.add(org)
            await db.flush()
            print(f"  [+] Организация: {name} (ИНН {inn})")
        else:
            if not org.inn:
                org.inn = inn
            if org.payment_group_id is None:
                org.payment_group_id = group.id
        organizations.append(org)

    # 3. Категории направлений + направления (натуральный ключ — name).
    directions = []
    for dir_name, cat_name in SEED_DIRECTIONS:
        res = await db.execute(
            select(DirectionCategory).where(DirectionCategory.name == cat_name)
        )
        cat = res.scalar_one_or_none()
        if cat is None:
            cat = DirectionCategory(name=cat_name)
            db.add(cat)
            await db.flush()

        res = await db.execute(select(Direction).where(Direction.name == dir_name))
        direction = res.scalar_one_or_none()
        if direction is None:
            direction = Direction(name=dir_name, category_id=cat.id)
            db.add(direction)
            await db.flush()
            print(f"  [+] Направление (ЦФО): {dir_name}")
        elif direction.category_id is None:
            direction.category_id = cat.id
        directions.append(direction)

    # 4. Статьи ДДС (натуральный ключ — name; в модели name unique).
    budget_items = []
    for name, category in SEED_BUDGET_ITEMS:
        res = await db.execute(select(BudgetItem).where(BudgetItem.name == name))
        item = res.scalar_one_or_none()
        if item is None:
            item = BudgetItem(name=name, category=category.value)
            db.add(item)
            await db.flush()
            print(f"  [+] Статья ДДС: {name} ({category.value})")
        budget_items.append(item)

    # 5. Маппинг направление <-> статья (каждое ЦФО имеет доступ ко всем статьям).
    for direction in directions:
        for item in budget_items:
            res = await db.execute(
                select(DirectionBudgetItem).where(
                    DirectionBudgetItem.direction_id == direction.id,
                    DirectionBudgetItem.budget_item_id == item.id,
                )
            )
            if res.scalar_one_or_none() is None:
                db.add(
                    DirectionBudgetItem(
                        direction_id=direction.id, budget_item_id=item.id
                    )
                )

    # 6. Недельный шаблон для платёжной группы (натуральный ключ — group+day).
    week_template = {
        1: "NON_PAYMENT",
        2: "PAYMENT",
        3: "NON_PAYMENT",
        4: "PAYMENT",
        5: "SALARY_DAY",
        6: "HOLIDAY",
        7: "HOLIDAY",
    }
    for day_of_week, day_type in week_template.items():
        res = await db.execute(
            select(WeeklyTemplate).where(
                WeeklyTemplate.payment_group_id == group.id,
                WeeklyTemplate.day_of_week == day_of_week,
            )
        )
        if res.scalar_one_or_none() is None:
            db.add(
                WeeklyTemplate(
                    payment_group_id=group.id,
                    day_of_week=day_of_week,
                    day_type=day_type,
                )
            )

    # 7. Базовая матрица ДДС (натуральный ключ — day_type+allowed_category).
    rules = [
        ("PAYMENT", BudgetItemCategory.SUPPLIERS),
        ("PAYMENT", BudgetItemCategory.TAXES),
        ("PAYMENT", BudgetItemCategory.TRANSPORT),
        ("PAYMENT", BudgetItemCategory.BANK),
        ("SALARY_DAY", BudgetItemCategory.SALARY),
        ("SALARY_DAY", BudgetItemCategory.TAXES),
    ]
    for day_type, allowed_category in rules:
        res = await db.execute(
            select(DayTypeRule).where(
                DayTypeRule.day_type == day_type,
                DayTypeRule.allowed_category == allowed_category.value,
            )
        )
        if res.scalar_one_or_none() is None:
            db.add(
                DayTypeRule(day_type=day_type, allowed_category=allowed_category.value)
            )

    await db.commit()

    return {
        "group": group,
        "organizations": organizations,
        "directions": directions,
        "budget_items": budget_items,
    }


async def _seed_user_organizations(db: AsyncSession, organizations) -> None:
    """Назначает cashier1 и feo1 на ВСЕ организации (для balance-тестов).

    Не-суперадмин видит/правит остатки только по назначенным организациям
    (см. allowed_balance_org_ids). admin1 — суперадмин, ему назначения не нужны.
    """
    print("--- Привязка пользователей к организациям (остатки) ---")
    target_logins = ["cashier1", "feo1"]

    for ad_login in target_logins:
        res = await db.execute(select(User).where(User.ad_login == ad_login))
        user = res.scalar_one_or_none()
        if user is None:
            print(f"  [!] Пользователь {ad_login} не найден — пропускаю привязку")
            continue

        for org in organizations:
            res = await db.execute(
                select(user_organizations).where(
                    user_organizations.c.user_id == user.id,
                    user_organizations.c.organization_id == org.id,
                )
            )
            if res.first() is None:
                await db.execute(
                    user_organizations.insert().values(
                        user_id=user.id, organization_id=org.id
                    )
                )
        print(f"  [+] {ad_login} -> {len(organizations)} орг.")

    await db.commit()


async def seed_all() -> None:
    print("=" * 60)
    print("КАНОНИЧЕСКИЙ СИДЕР РЕЕСТРА")
    print("=" * 60)

    # 1. Роли (идемпотентно, без дублей).
    await seed_roles()

    # 2. Права + связи ролей с правами (идемпотентно).
    await seed_rbac()

    async with AsyncSessionLocal() as db:
        # 3. Суперадмин (роль ADMIN -> is_superadmin=True).
        await _ensure_superadmin_role(db)

        # 4. Тестовые пользователи (пароль у всех — TEST_PASSWORD).
        await _seed_users(db)

        # 5. НСИ.
        nsi = await _seed_nsi(db)

        # 6. Привязка пользователей к организациям (остатки).
        await _seed_user_organizations(db, nsi["organizations"])

    print()
    print("=" * 60)
    print("ГОТОВО. Сид завершён.")
    print(f"Пользователи (пароль у всех: {TEST_PASSWORD}):")
    for ad_login, _full_name, role_name in TEST_USERS:
        tag = " [суперадмин]" if role_name == "ADMIN" else ""
        print(f"  {ad_login:<12} -> {role_name}{tag}")
    print("=" * 60)
    print("\n--- ID НСИ (для ручных проверок в Swagger) ---")
    for org in nsi["organizations"]:
        print(f"organization_id: {org.id}  ({org.name}, ИНН {org.inn})")
    for d in nsi["directions"]:
        print(f"direction_id:    {d.id}  ({d.name})")
    for bi in nsi["budget_items"]:
        print(f"budget_item_id:  {bi.id}  ({bi.name})")


if __name__ == "__main__":
    asyncio.run(seed_all())
