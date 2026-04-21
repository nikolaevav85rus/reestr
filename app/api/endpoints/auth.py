from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.core import security
from app.models.user import User, Role
from app.schemas.token import LoginResponse

router = APIRouter()

@router.post("/login", response_model=LoginResponse)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(), 
    db: AsyncSession = Depends(get_db)
):
    stmt = select(User).options(
        selectinload(User.role).selectinload(Role.permissions)
    ).where(User.ad_login == form_data.username)
    
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=400, detail="Аккаунт заблокирован")

    # Собираем список прав для фронтенда
    permissions_list = []
    if user.role:
        permissions_list = [perm.name for perm in user.role.permissions]
        if getattr(user.role, "is_superadmin", False):
            permissions_list.append("superadmin")

    access_token = security.create_access_token(data={"sub": user.ad_login})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
        "permissions": permissions_list
    }