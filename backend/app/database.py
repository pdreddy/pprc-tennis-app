from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import Settings, get_settings


def engine_options(settings: Settings) -> dict:
    """Engine settings per backend: pooled Postgres (optionally behind a transaction pooler) or a plain SQLite preview."""
    if settings.database_url.startswith("sqlite"):
        return {}
    options: dict = {"pool_pre_ping": True, "pool_size": settings.pprc_db_pool_size, "max_overflow": settings.pprc_db_pool_size}
    if settings.pprc_db_pooler:
        options["connect_args"] = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    return options


engine = create_async_engine(get_settings().database_url, **engine_options(get_settings()))
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
