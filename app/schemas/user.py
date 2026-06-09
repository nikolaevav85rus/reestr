from pydantic import BaseModel, ConfigDict, computed_field, AliasChoices, Field
from typing import Optional
from uuid import UUID

# --- Вложенные схемы для красивого ответа фронтенду ---

class RoleResponse(BaseModel):
    id: UUID
    name: str
    label: str
    is_superadmin: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

class DirectionResponse(BaseModel):
    id: UUID
    name: str

    model_config = ConfigDict(from_attributes=True)

# --- Основные схемы пользователя ---

class UserBase(BaseModel):
    ad_login: str
    full_name: str
    is_active: bool = True

class UserCreate(UserBase):
    """Создание пользователя.

    Фронтенд (Users.tsx) и API-тесты присылают `role_id` (UUID роли).
    Лишние/инъецированные ключи (hashed_password, is_superadmin и т.п.)
    игнорируются благодаря extra='ignore' — попасть в ORM они не могут.
    """
    model_config = ConfigDict(extra="ignore")

    password: str
    role_id: UUID
    direction_id: Optional[UUID] = None

class UserUpdate(BaseModel):
    """Обновление пользователя. Все поля опциональны — поддерживаем как
    полное редактирование из модалки, так и частичные патчи (например,
    только `is_active` из auth-security.spec.ts)."""
    model_config = ConfigDict(extra="ignore")

    ad_login: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[UUID] = None
    direction_id: Optional[UUID] = None
    is_active: Optional[bool] = None

class UserActiveUpdate(BaseModel):
    """Тумблер доступа на портал (PATCH /{id}/active)."""
    model_config = ConfigDict(extra="ignore")

    is_active: Optional[bool] = None

class UserPasswordUpdate(BaseModel):
    """Смена пароля.

    Фронтенд (Users.tsx) отправляет поле `new_password`. Принимаем его как
    основной ключ, но дополнительно допускаем `password` ради совместимости
    с существующим user_service.UserPasswordUpdate-контрактом.
    """
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    password: str = Field(validation_alias=AliasChoices("new_password", "password"))

class RoleCreate(BaseModel):
    """Создание роли (whitelist). is_superadmin намеренно НЕ принимается —
    его нельзя выставить через API, защита от создания god-mode роли."""
    model_config = ConfigDict(extra="ignore")
    name: str
    label: str
    color: Optional[str] = "blue"

class RoleBasicUpdate(BaseModel):
    """Редактирование параметров роли (whitelist). is_superadmin недоступен."""
    model_config = ConfigDict(extra="ignore")
    label: Optional[str] = None
    color: Optional[str] = None

class RolePermissionsUpdate(BaseModel):
    """Назначение списка прав роли (whitelist)."""
    model_config = ConfigDict(extra="ignore")
    permissions: list[str] = []

class UserOrganizationsUpdate(BaseModel):
    """Замена набора организаций, назначенных пользователю (whitelist).

    Используется для скоупинга доступа к остаткам на счетах:
    PUT /users/{id}/organizations с телом {"organization_ids": ["<uuid>", ...]}.
    """
    model_config = ConfigDict(extra="ignore")
    organization_ids: list[UUID] = []

class OrganizationBrief(BaseModel):
    """Краткое представление организации для ответа со списком привязок."""
    id: UUID
    name: str

    model_config = ConfigDict(from_attributes=True)

class UserResponse(UserBase):
    id: UUID
    direction_id: Optional[UUID] = None

    # При ответе отдаем полноценные объекты, чтобы фронтенд мог вытащить label и name
    role: Optional[RoleResponse] = None
    direction: Optional[DirectionResponse] = None

    @computed_field
    @property
    def is_superadmin(self) -> bool:
        return bool(self.role and self.role.is_superadmin is True)

    model_config = ConfigDict(from_attributes=True)
