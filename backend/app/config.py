from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://pprc:pprc@localhost:5432/pprc"
    pprc_cors_origins: str = "http://localhost:5173"
    # None = create tables automatically in development only; deployed schemas are managed with sql/*.sql.
    pprc_bootstrap_schema: bool | None = None
    pprc_environment: str = "development"
    firebase_project_id: str | None = None
    clerk_secret_key: str | None = None
    # "auto" keeps the legacy behaviour (Clerk when its secret is set, otherwise Firebase). Pin "clerk" or
    # "firebase" in deployed environments so a stray variable can never switch the token verifier.
    pprc_auth_provider: Literal["auto", "clerk", "firebase"] = "auto"
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    pprc_app_origin: str = "http://localhost:5173"
    # Per-client limits; 0 disables the write rate limit.
    pprc_rate_limit_writes_per_minute: int = 120
    pprc_max_body_bytes: int = 1_000_000
    # Believe X-Forwarded-For only when a trusted reverse proxy sets it.
    pprc_trust_proxy: bool = False

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.pprc_cors_origins.split(",") if origin.strip()]

    @property
    def auth_provider(self) -> Literal["clerk", "firebase"] | None:
        """The one verifier used for bearer tokens, or None when nothing is configured."""
        if self.pprc_auth_provider != "auto":
            return self.pprc_auth_provider
        if self.clerk_secret_key:
            return "clerk"
        return "firebase" if self.firebase_project_id else None

    def auth_config_error(self) -> str | None:
        """Why bearer-token auth cannot work with the current settings, if it cannot."""
        if self.auth_provider == "clerk" and not self.clerk_secret_key:
            return "PPRC_AUTH_PROVIDER=clerk requires CLERK_SECRET_KEY"
        if self.auth_provider == "firebase" and not self.firebase_project_id:
            return "PPRC_AUTH_PROVIDER=firebase requires FIREBASE_PROJECT_ID"
        return None

    @property
    def bootstrap_schema(self) -> bool:
        if self.pprc_bootstrap_schema is not None:
            return self.pprc_bootstrap_schema
        return self.pprc_environment == "development"

    @property
    def allow_development_header(self) -> bool:
        return self.pprc_environment == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
