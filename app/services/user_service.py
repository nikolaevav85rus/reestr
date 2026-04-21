from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status
from uuid import UUID
from typing import Optional

from app.models.user import User, Role
from app.schemas.user import UserCreate, UserUpdate, UserPasswordUpdate
from app.core.security import get_password_hash

async def create_user(db: AsyncSession, user_in: UserCreate):
    """Создает нового пользователя."""
    hashed_pw = get_password_hash(user_in.password)
    
    result_role = await db.execute(select(Role).where(Role.name == user_in.role))
    role_obj = result_role.scalar_one_or_none()
    
    if not role_obj:
        raise HTTPException(status_code=400, detail=f"Роль '{user_in.role}' не найдена.")
    
    db_user = User(
        ad_login=user_in.ad_login.lower(),
        full_name=user_in.full_name,
        role_id=role_obj.id,
        direction_id=user_in.direction_id,
        hashed_password=hashed_pw,
        is_active=user_in.is_active
    )
    
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    
    return await get_user_by_login(db, db_user.ad_login)

async def get_all_users(
    db: AsyncSession, 
    search_query: Optional[str] = None,
    role_name: Optional[str] = None,
    direction_id: Optional[UUID] = None
):
    """Возвращает список пользователей с возможностью гибкой фильтрации."""
    query = select(User).options(selectinload(User.role), selectinload(User.direction))

    if search_query:
        search_pattern = f"%{search_query}%"
        query = query.where(
            or_(
                User.ad_login.ilike(search_pattern),
                User.full_name.ilike(search_pattern)
            )
        )
    
    if role_name:
        query = query.join(User.role).where(Role.name == role_name)
        
    if direction_id:
        query = query.where(User.direction_id == direction_id)

    query = query.order_by(User.full_name)

    result = await db.execute(query)
    return result.scalars().all()

async def get_user_by_login(db: AsyncSession, login: str):
    """Ищет пользователя по логину."""
    if not login:
        return None
    result = await db.execute(
        select(User)
        .where(func.lower(User.ad_login) == login.lower())
        .options(selectinload(User.role), selectinload(User.direction))
    )
    return result.scalar_one_or_none()

async def update_user(db: AsyncSession, user_id: UUID, user_in: UserUpdate):
    """Обновление профиля пользователя."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # ИСПРАВЛЕНО: Гарантированный захват всех полей
    update_data = user_in.model_dump(exclude_unset=True)
    
    if "full_name" in update_data:
        user.full_name = update_data["full_name"]
    if "is_active" in update_data:
        user.is_active = update_data["is_active"]
    if "direction_id" in update_data:
        user.direction_id = update_data["direction_id"]
        
    if "role" in update_data and update_data["role"]:
        res_role = await db.execute(select(Role).where(Role.name == update_data["role"]))
        r_obj = res_role.scalar_one_or_none()
        if r_obj:
            user.role_id = r_obj.id

    await db.commit()
    await db.refresh(user)
    return await get_user_by_login(db, user.ad_login)

async def update_user_password(db: AsyncSession, user_id: UUID, password_in: UserPasswordUpdate):
    """Смена пароля пользователя."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.hashed_password = get_password_hash(password_in.password)
    await db.commit()
    return {"message": "Пароль успешно изменен"}

async def delete_user(db: AsyncSession, user_id: UUID):
    """Удаление пользователя."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
        
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    return {"message": "Пользователь удален"}