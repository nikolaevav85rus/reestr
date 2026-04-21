from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from jose import jwt, JWTError

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.user import User, Role

# ВАЖНО: Указываем правильный путь к эндпоинту логина
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def get_current_user(db: AsyncSession = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить личность",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Вытягиваем юзера СРАЗУ с ролью и матрицей прав
    stmt = select(User).options(
        selectinload(User.role).selectinload(Role.permissions)
    ).where(User.ad_login == username)
    
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    return user

# Наш универсальный защитник эндпоинтов
class PermissionChecker:
    def __init__(self, required_permission: str):
        self.required_permission = required_permission

    def __call__(self, current_user: User = Depends(get_current_user)):
        # 1. Режим Бога
        if current_user.role and getattr(current_user.role, 'is_superadmin', False):
            return current_user

        # 2. Проверка наличия роли и прав
        if not current_user.role or not current_user.role.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="Нет доступа (отсутствуют права)"
            )
        
        # 3. Сверка прав
        user_permissions = [perm.name for perm in current_user.role.permissions]
        if self.required_permission not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail=f"Необходимы права: {self.required_permission}"
            )
        
        return current_user