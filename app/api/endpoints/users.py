from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.api.deps import get_db, PermissionChecker
from app.models.user import User, Role
from app.models.organization import Organization, Cluster
from app.models.direction import Direction
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserActiveUpdate,
    UserPasswordUpdate,
)
from app.core.security import get_password_hash # Предполагается, что у вас есть функция хеширования

router = APIRouter()


def _caller_is_superadmin(current_user: User) -> bool:
    return bool(current_user.role and getattr(current_user.role, "is_superadmin", False))


async def _resolve_role_or_403(
    db: AsyncSession,
    role_id: UUID,
    current_user: User,
) -> Role:
    """Проверяет существование роли и блокирует эскалацию привилегий.

    - 400, если роль с таким id отсутствует (вместо падения по FK -> 500).
    - 403, если вызывающий не суперадмин, но пытается назначить роль
      с is_superadmin=True.
    """
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=400, detail="Указанная роль не найдена")
    if getattr(role, "is_superadmin", False) and not _caller_is_superadmin(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для назначения роли суперадминистратора",
        )
    return role


async def _validate_direction_or_404(db: AsyncSession, direction_id: UUID) -> None:
    """ЦФО (direction) должно существовать, иначе 404 вместо FK-ошибки 500."""
    direction = await db.get(Direction, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Указанное ЦФО не найдено")


def _serialize_user_safe(user: User) -> dict:
    role_data = None
    if user.role:
        role_data = {
            "id": str(user.role.id),
            "name": user.role.name,
            "label": user.role.label,
            "color": user.role.color,
            "is_superadmin": user.role.is_superadmin,
            "permissions": [
                {
                    "id": str(perm.id),
                    "name": perm.name,
                    "label": perm.label,
                    "category": perm.category,
                }
                for perm in (user.role.permissions or [])
            ],
        }

    direction_data = None
    if user.direction:
        direction_data = {
            "id": str(user.direction.id),
            "name": user.direction.name,
            "category_id": str(user.direction.category_id) if user.direction.category_id else None,
            "is_active": user.direction.is_active,
        }

    return {
        "id": str(user.id),
        "ad_login": user.ad_login,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "role_id": str(user.role_id) if user.role_id else None,
        "direction_id": str(user.direction_id) if user.direction_id else None,
        "role": role_data,
        "direction": direction_data,
    }


@router.get("/")
async def get_users(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("user_view"))
):
    """Получить список пользователей с подгрузкой ролей и ЦФО."""
    query = select(User).options(selectinload(User.role), selectinload(User.direction)).order_by(User.full_name)
    if search:
        query = query.where(
            (User.full_name.ilike(f"%{search}%")) | 
            (User.ad_login.ilike(f"%{search}%"))
        )
    result = await db.execute(query)
    users = result.scalars().all()
    return [_serialize_user_safe(user) for user in users]

@router.post("/")
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Создать нового пользователя.

    Тело валидируется схемой UserCreate (whitelist: ad_login, full_name,
    password, role_id, direction_id, is_active). Любые иные ключи
    (hashed_password, is_superadmin и пр.) игнорируются и в ORM не попадают.
    """
    # Проверка на уникальность логина
    existing = await db.execute(select(User).where(User.ad_login == data.ad_login))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь с таким логином (AD) уже существует")

    # Защита от эскалации привилегий + проверка существования FK.
    await _resolve_role_or_403(db, data.role_id, current_user)
    if data.direction_id is not None:
        await _validate_direction_or_404(db, data.direction_id)

    new_user = User(
        ad_login=data.ad_login,
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role_id=data.role_id,
        direction_id=data.direction_id,  # Может быть None
        is_active=data.is_active,
    )
    db.add(new_user)
    await db.commit()

    # Перечитываем пользователя с явной подгрузкой роли и ЦФО,
    # чтобы безопасно сериализовать без раскрытия hashed_password.
    result = await db.execute(
        select(User)
        .options(selectinload(User.role), selectinload(User.direction))
        .where(User.id == new_user.id)
    )
    created_user = result.scalar_one()
    return _serialize_user_safe(created_user)

@router.put("/{user_id}")
async def update_user(
    user_id: UUID,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Обновить данные пользователя.

    Тело валидируется схемой UserUpdate (whitelist: ad_login, full_name,
    role_id, direction_id, is_active — все опциональны). Поддерживаются как
    полное редактирование, так и частичные патчи (например, только is_active).
    Произвольные/инъецированные ключи игнорируются и в ORM не попадают.
    """
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Берём только реально переданные клиентом поля.
    update_data = data.model_dump(exclude_unset=True)

    # Если логин меняется, проверяем уникальность
    if 'ad_login' in update_data and update_data['ad_login'] and update_data['ad_login'] != user.ad_login:
        existing = await db.execute(select(User).where(User.ad_login == update_data['ad_login']))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Логин уже занят другим сотрудником")
        user.ad_login = update_data['ad_login']

    if 'full_name' in update_data and update_data['full_name'] is not None:
        user.full_name = update_data['full_name']

    # Смена роли: проверка существования + защита от эскалации привилегий.
    if 'role_id' in update_data and update_data['role_id'] is not None:
        await _resolve_role_or_403(db, update_data['role_id'], current_user)
        user.role_id = update_data['role_id']

    # ЦФО: None допустимо (открепление), иначе проверяем существование.
    if 'direction_id' in update_data:
        if update_data['direction_id'] is not None:
            await _validate_direction_or_404(db, update_data['direction_id'])
        user.direction_id = update_data['direction_id']

    if 'is_active' in update_data and update_data['is_active'] is not None:
        if user.ad_login == 'admin':
            raise HTTPException(status_code=400, detail="Нельзя заблокировать системного администратора")
        if update_data['is_active'] is False and str(user_id) == str(current_user.id):
            raise HTTPException(status_code=400, detail="Нельзя заблокировать собственный аккаунт")
        user.is_active = update_data['is_active']

    await db.commit()

    # Перечитываем пользователя с явной подгрузкой роли и ЦФО,
    # чтобы безопасно сериализовать без раскрытия hashed_password.
    result = await db.execute(
        select(User)
        .options(selectinload(User.role), selectinload(User.direction))
        .where(User.id == user_id)
    )
    updated_user = result.scalar_one()
    return _serialize_user_safe(updated_user)

@router.patch("/{user_id}/active")
async def toggle_user_active(
    user_id: UUID,
    data: UserActiveUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Включить / отключить доступ пользователя на портал."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать собственный аккаунт")
    if user.ad_login == 'admin':
        raise HTTPException(status_code=400, detail="Нельзя заблокировать системного администратора")
    # Если is_active не передан — инвертируем текущее значение (поведение тумблера).
    user.is_active = data.is_active if data.is_active is not None else (not user.is_active)
    await db.commit()
    return {"id": str(user.id), "is_active": user.is_active}

@router.put("/{user_id}/password")
async def update_password(
    user_id: UUID,
    data: UserPasswordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Сменить пароль пользователя.

    Тело валидируется схемой UserPasswordUpdate. Фронтенд (Users.tsx)
    присылает поле `new_password`; схема принимает его как алиас к `password`.
    """
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.hashed_password = get_password_hash(data.password)
    await db.commit()
    return {"status": "success"}

@router.delete("/{user_id}")
async def delete_user(
    user_id: UUID, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(PermissionChecker("user_delete"))
):
    """Удалить пользователя с проверкой зависимостей."""
    # 1. Защита от самоудаления
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный профиль")

    # 2. Зависимость: Директор организации
    org_check = await db.execute(select(Organization).where(Organization.director_id == user_id).limit(1))
    if org_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Нельзя удалить: сотрудник назначен директором юр. лица")

    # 3. Зависимость: Руководитель кластера
    cluster_check = await db.execute(select(Cluster).where(Cluster.head_id == user_id).limit(1))
    if cluster_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Нельзя удалить: сотрудник является руководителем кластера")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
        
    # 4. Защита системного администратора
    if getattr(user, 'is_superadmin', False) or user.ad_login == 'admin':
        raise HTTPException(status_code=400, detail="Нельзя удалить базового системного администратора")

    await db.delete(user)
    await db.commit()
    return {"status": "deleted"}
