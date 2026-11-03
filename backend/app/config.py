from functools import lru_cache
from typing import Literal

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Accept what hosts hand out (postgres://, postgresql://, ?sslmode=require) and return the asyncpg form SQLAlchemy needs."""
    parts = urlsplit(url.strip())
    if not parts.scheme.startswith(("postgres", "postgresql")):
        return url  # sqlite+aiosqlite for local previews
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == "sslmode":  # libpq spelling; asyncpg calls it `ssl`
            key = "ssl"
        if key in {"channel_binding"}:  # libpq-only option some hosts append
            continue
        query.append((key, value))
    return urlunsplit(("postgresql+asyncpg", parts.netloc, parts.path, urlencode(query), parts.fragment))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://pprc:pprc@localhost:5432/pprc"
    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, value: str) -> str:
        return normalize_database_url(value)

    # PgBouncer/Supabase transaction pooler (port 6543): asyncpg's prepared-statement cache must be off.
    pprc_db_pooler: bool = False
    pprc_db_pool_size: int = 5
    pprc_cors_origins: str = "http://localhost:5173"
    # None = create tables automatically in development only; deployed schemas are managed with sql/*.sql.
    pprc_bootstrap_schema: bool | None = None
    # Deployed by default: the X-PPRC-User impersonation header must be opted into with PPRC_ENVIRONMENT=development.
    pprc_environment: str = "production"
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


def app_origin() -> str:
    """Public web origin used in email links, without a trailing slash."""
    return get_settings().pprc_app_origin.rstrip("/")
