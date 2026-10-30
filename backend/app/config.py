from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://pprc:pprc@localhost:5432/pprc"
    pprc_cors_origins: str = "http://localhost:5173"
    pprc_bootstrap_schema: bool = True
    pprc_environment: str = "development"
    firebase_project_id: str | None = None

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.pprc_cors_origins.split(",") if origin.strip()]

    @property
    def allow_development_header(self) -> bool:
        return self.pprc_environment == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
