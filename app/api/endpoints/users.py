from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.api.deps import get_db, PermissionChecker
from app.models.user import User, Role
from app.models.organization import Organization, Cluster
from app.core.security import get_password_hash # Предполагается, что у вас есть функция хеширования

router = APIRouter()

@router.get("/")
async def get_users(search: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Получить список пользователей с подгрузкой ролей и ЦФО."""
    query = select(User).options(selectinload(User.role), selectinload(User.direction)).order_by(User.full_name)
    if search:
        query = query.where(
            (User.full_name.ilike(f"%{search}%")) | 
            (User.ad_login.ilike(f"%{search}%"))
        )
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/")
async def create_user(
    data: dict, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Создать нового пользователя."""
    # Проверка на уникальность логина
    existing = await db.execute(select(User).where(User.ad_login == data['ad_login']))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Пользователь с таким логином (AD) уже существует")

    new_user = User(
        ad_login=data['ad_login'],
        full_name=data['full_name'],
        hashed_password=get_password_hash(data['password']),
        role_id=data['role_id'],
        direction_id=data.get('direction_id') # Может быть None
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user

@router.put("/{user_id}")
async def update_user(
    user_id: UUID, 
    data: dict, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Обновить данные пользователя."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Если логин меняется, проверяем уникальность
    if 'ad_login' in data and data['ad_login'] != user.ad_login:
        existing = await db.execute(select(User).where(User.ad_login == data['ad_login']))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Логин уже занят другим сотрудником")
            
    user.ad_login = data.get('ad_login', user.ad_login)
    user.full_name = data.get('full_name', user.full_name)
    user.role_id = data.get('role_id', user.role_id)
    user.direction_id = data.get('direction_id', user.direction_id)
    if 'is_active' in data:
        if user.ad_login == 'admin':
            raise HTTPException(status_code=400, detail="Нельзя заблокировать системного администратора")
        if data['is_active'] is False and str(user_id) == str(current_user.id):
            raise HTTPException(status_code=400, detail="Нельзя заблокировать собственный аккаунт")
        user.is_active = data['is_active']
    
    await db.commit()
    return user

@router.patch("/{user_id}/active")
async def toggle_user_active(
    user_id: UUID,
    data: dict,
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
    user.is_active = data.get('is_active', not user.is_active)
    await db.commit()
    return {"id": str(user.id), "is_active": user.is_active}

@router.put("/{user_id}/password")
async def update_password(
    user_id: UUID, 
    data: dict, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(PermissionChecker("user_edit"))
):
    """Сменить пароль пользователя."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
        
    user.hashed_password = get_password_hash(data['new_password'])
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