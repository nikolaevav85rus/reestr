import uuid
from sqlalchemy import Column, String, ForeignKey, Table, Boolean, DateTime, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.database import Base

# Связующая таблица Матрицы Прав (Many-to-Many)
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)

# Явная привязка пользователя к организациям (Many-to-Many).
# Управляет видимостью/правкой остатков на счетах: не-суперадмин видит и
# редактирует остатки только по назначенным ему организациям.
user_organizations = Table(
    "user_organizations",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("organization_id", UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
)

class Permission(Base):
    __tablename__ = "permissions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, unique=True, nullable=False)   # Технический код (req_approve)
    label = Column(String, nullable=False)              # Имя для людей (Утверждение заявки)
    category = Column(String, nullable=False)           # Группировка (Заявки, Справочники)

    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")

class Role(Base):
    __tablename__ = "roles"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, unique=True, nullable=False)
    label = Column(String, nullable=False)
    color = Column(String, nullable=True, default="blue")
    is_superadmin = Column(Boolean, default=False)      # Тот самый "God Mode"

    users = relationship("User", back_populates="role")
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles", lazy="selectin")

class Substitution(Base):
    """Таблица замещений сотрудников"""
    __tablename__ = "substitutions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    absent_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    substitute_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    absent_user = relationship("User", foreign_keys=[absent_user_id])
    substitute_user = relationship("User", foreign_keys=[substitute_user_id])

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ad_login = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    # Версия токена: при инкременте все ранее выданные JWT этого пользователя
    # становятся недействительными (серверная ревокация сессий).
    token_version = Column(Integer, nullable=False, default=0, server_default="0")

    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id"))
    direction_id = Column(UUID(as_uuid=True), ForeignKey("directions.id"), nullable=True)

    role = relationship("Role", back_populates="users", lazy="selectin")
    direction = relationship("Direction", lazy="selectin")
    # Организации, к остаткам которых пользователь имеет доступ (явная привязка).
    organizations = relationship(
        "Organization",
        secondary=user_organizations,
        lazy="selectin",
    )