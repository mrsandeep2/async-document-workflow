from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://docuser:docpass@localhost:5432/docprocessor"
    SYNC_DATABASE_URL: str = "postgresql://docuser:docpass@localhost:5432/docprocessor"
    REDIS_URL: str = "redis://localhost:6379/0"
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50
    USE_CELERY: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
