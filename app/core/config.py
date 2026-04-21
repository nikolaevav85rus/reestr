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

    class Config:
        env_file = ".env"

# Создаем объект настроек, который будем импортировать в другие файлы
settings = Settings()