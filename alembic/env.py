import asyncio
from logging.config import fileConfig
import sys
import os

# Добавляем путь к приложению в sys.path для корректных импортов
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

# Импортируем настройки и базу
from app.core.config import settings
from app.db.database import Base

# ВАЖНО: Импортируем ВСЕ модели, чтобы Alembic увидел их через Base.metadata
# Если модель не импортирована здесь, autogenerate её проигнорирует.
from app.models.user import User, Role
from app.models.organization import PaymentGroup, Organization
from app.models.direction import Direction
from app.models.budget import BudgetItem
from app.models.calendar import PaymentCalendar, DayTypeRule
from app.models.audit import AuditLog
from app.models.request import PaymentRequest

# Настройка конфигурации Alembic
config = context.config

# Интерпретация файла конфигурации для логирования
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Метаданные моделей для автоматической генерации миграций
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """
    Запуск миграций в 'offline' режиме.
    Конфигурирует контекст только по URL, не создавая движок.
    """
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection):
    """Вспомогательная функция для запуска миграций в синхронном контексте."""
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()

async def run_migrations_online() -> None:
    """
    Запуск миграций в 'online' режиме.
    Создает асинхронный движок и выполняет миграции в транзакции.
   
    """
    configuration = config.get_section(config.config_ini_section)
    # Используем URL из настроек приложения вместо alembic.ini
    configuration["sqlalchemy.url"] = settings.DATABASE_URL
    
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        # Alembic работает синхронно, поэтому используем run_sync
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())