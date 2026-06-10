import uvicorn
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Импортируем все наши настроенные роутеры
from app.api.endpoints import auth, users, dictionaries, requests, calendar, settings as settings_endpoint, notifications, balances
from app.core.config import settings as app_settings
from app.core.logging_config import configure_logging
from app.scheduler import start_scheduler, stop_scheduler

# Настройка логирования
configure_logging()
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
    allow_origins=app_settings.CORS_ORIGINS,
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
app.include_router(settings_endpoint.router, prefix="/api/v1/settings", tags=["Settings"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(balances.router, prefix="/api/v1/balances", tags=["Balances"])


# Флаг, был ли планировщик запущен внутри процесса API.
# В проде RUN_SCHEDULER_IN_APP=false — планировщик запускается отдельно
# (`python -m app.scheduler`), а приложение его не трогает.
_scheduler_started = False


@app.on_event("startup")
async def startup():
    global _scheduler_started
    if app_settings.RUN_SCHEDULER_IN_APP:
        start_scheduler()
        _scheduler_started = True
        logger.info("APScheduler запущен внутри процесса API (RUN_SCHEDULER_IN_APP=true).")
    else:
        logger.info(
            "APScheduler НЕ запущен в приложении (RUN_SCHEDULER_IN_APP=false); "
            "ожидается отдельный процесс: python -m app.scheduler."
        )


@app.on_event("shutdown")
async def shutdown():
    global _scheduler_started
    if _scheduler_started:
        stop_scheduler()
        _scheduler_started = False


if __name__ == "__main__":
    # Запуск сервера
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080)
