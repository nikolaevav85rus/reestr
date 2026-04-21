import uvicorn
import os
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Импортируем все наши настроенные роутеры
from app.api.endpoints import auth, users, dictionaries, requests, calendar, settings, notifications
from app.scheduler import start_scheduler, stop_scheduler

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация приложения
app = FastAPI(
    title="Treasury API",
    description="Система управления платежным календарем с RBAC авторизацией",
    version="1.0.0"
)

# Настройка CORS (чтобы фронтенд мог делать запросы)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Системный эндпоинт
@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok", "message": "Сервер работает отлично!"}

# Подключение всех бизнес-модулей (Роутеров)
# Обрати внимание: мы задаем префикс /api/v1/ для красоты и версионирования
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(dictionaries.router, prefix="/api/v1/dict", tags=["Dictionaries"])
app.include_router(requests.router, prefix="/api/v1/requests", tags=["Requests"])
app.include_router(calendar.router, prefix="/api/v1/calendar", tags=["Calendar"])
app.include_router(settings.router, prefix="/api/v1/settings", tags=["Settings"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])


@app.on_event("startup")
async def startup():
    start_scheduler()


@app.on_event("shutdown")
async def shutdown():
    stop_scheduler()


if __name__ == "__main__":
    # Запуск сервера
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080)