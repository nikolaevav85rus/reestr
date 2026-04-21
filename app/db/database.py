from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings

# 1. Создаем "движок" (Engine). Это главный узел связи с БД.
# echo=True значит, что Python будет печатать в терминал все SQL-запросы (очень полезно для новичков)
engine = create_async_engine(settings.DATABASE_URL, echo=True)

# 2. Создаем "фабрику сессий". Сессия — это как отдельный диалог с базой данных на каждый запрос пользователя.
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# 3. Базовый класс. От него мы будем наследовать все наши будущие таблицы (Организации, Заявки, Пользователи)
Base = declarative_base()