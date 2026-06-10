from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Класс для подгрузки секретных настроек из файла .env.
    Pydantic сам найдет этот файл и достанет оттуда переменные.
    """
    PROJECT_NAME: str
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://192.168.150.14:5173",
        ]
    )
    SQL_ECHO: bool = False
    LOG_LEVEL: str = "INFO"
    APP_TIMEZONE: str = "Europe/Moscow"
    # APScheduler placement.
    # True  — запускать планировщик внутри процесса API (по умолчанию,
    #         удобно для dev/local; поведение не меняется).
    # False — НЕ стартовать планировщик в приложении; в проде его надо
    #         запускать отдельным процессом: `python -m app.scheduler`.
    RUN_SCHEDULER_IN_APP: bool = True
    SUBMIT_CUTOFF_HOUR: int = 11
    # Регуляторный шлюз приёма заявок (fail-closed).
    # True  — при отсутствии данных календаря (нет платёжной группы у
    #         организации или нет строки PaymentCalendar на дату оплаты)
    #         заявка направляется на ручное подтверждение шлюза (PENDING_GATE).
    # False — старое поведение fail-open: при отсутствии данных заявка
    #         проходит шлюз без замечаний (обратимый безопасный откат).
    GATE_REQUIRE_CALENDAR_COVERAGE: bool = True
    UPLOAD_MAX_SIZE_MB: int = 10
    UPLOAD_ALLOWED_EXTENSIONS: list[str] = Field(
        default_factory=lambda: [".pdf", ".jpg", ".jpeg", ".png"]
    )
    UPLOAD_ALLOWED_CONTENT_TYPES: list[str] = Field(
        default_factory=lambda: [
            "application/pdf",
            "application/x-pdf",
            "image/jpeg",
            "image/pjpeg",
            "image/png",
        ]
    )

    # Распознавание счетов через платформу evo-ai (Dify-совместимый API).
    # Пустой EVOAI_API_KEY отключает OCR (эндпоинт вернёт 503).
    EVOAI_API_KEY: str = ""
    EVOAI_BASE_URL: str = "https://api.evo-ai.ru/v1"
    EVOAI_USER: str = "reestr"
    EVOAI_TIMEOUT_SEC: int = 180

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if value is None:
            return [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://192.168.150.14:5173",
            ]
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        if isinstance(value, list):
            return value
        raise ValueError("CORS_ORIGINS must be a comma-separated string or a list")

    @field_validator("UPLOAD_ALLOWED_EXTENSIONS", mode="before")
    @classmethod
    def parse_upload_allowed_extensions(cls, value):
        if value is None:
            return [".pdf", ".jpg", ".jpeg", ".png"]
        if isinstance(value, str):
            value = [item.strip() for item in value.split(",") if item.strip()]
        if not isinstance(value, list):
            raise ValueError("UPLOAD_ALLOWED_EXTENSIONS must be a comma-separated string or a list")
        normalized = []
        for ext in value:
            ext_str = str(ext).strip().lower()
            if not ext_str:
                continue
            if not ext_str.startswith("."):
                ext_str = f".{ext_str}"
            normalized.append(ext_str)
        return normalized

    @field_validator("UPLOAD_ALLOWED_CONTENT_TYPES", mode="before")
    @classmethod
    def parse_upload_allowed_content_types(cls, value):
        if value is None:
            return [
                "application/pdf",
                "application/x-pdf",
                "image/jpeg",
                "image/pjpeg",
                "image/png",
            ]
        if isinstance(value, str):
            value = [item.strip() for item in value.split(",") if item.strip()]
        if not isinstance(value, list):
            raise ValueError("UPLOAD_ALLOWED_CONTENT_TYPES must be a comma-separated string or a list")
        return [str(item).strip().lower() for item in value if str(item).strip()]

    @field_validator("SUBMIT_CUTOFF_HOUR")
    @classmethod
    def validate_submit_cutoff_hour(cls, value: int):
        if not (0 <= value <= 23):
            raise ValueError("SUBMIT_CUTOFF_HOUR must be in range 0..23")
        return value

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, value: str):
        if not value:
            raise ValueError("SECRET_KEY must not be empty")
        if len(value) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long")
        placeholders = (
            "change-me",
            "change-me-in-production",
            "changeme",
            "super_secret_key_for_pilot_change_later",
            "secret",
            "your-secret-key",
        )
        lowered = value.lower()
        for placeholder in placeholders:
            if placeholder in lowered:
                raise ValueError(
                    "SECRET_KEY contains a known placeholder value; "
                    "set a strong, unique key (e.g. python -c "
                    "\"import secrets; print(secrets.token_urlsafe(64))\")"
                )
        return value

    class Config:
        env_file = ".env"

# Создаем объект настроек, который будем импортировать в другие файлы
settings = Settings()
