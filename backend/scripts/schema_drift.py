"""Report differences between the ORM models and a migrated database (tables, columns, nullability).

    DATABASE_URL=postgresql+asyncpg://... python scripts/schema_drift.py

Exits 1 when the database is missing something the models need, so CI can keep backend/sql and app/models.py in step.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import normalize_database_url  # noqa: E402
from app.models import Base  # noqa: E402


def drift(connection) -> list[str]:
    inspector, problems = inspect(connection), []
    existing = set(inspector.get_table_names())
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            problems.append(f"missing table {table.name}")
            continue
        columns = {c["name"]: c for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name not in columns:
                problems.append(f"missing column {table.name}.{column.name} ({column.type})")
            elif not column.nullable and columns[column.name]["nullable"] and not column.primary_key:
                problems.append(f"nullable in database but required by the model: {table.name}.{column.name}")
    return problems


async def main() -> int:
    engine = create_async_engine(normalize_database_url(os.environ["DATABASE_URL"]))
    async with engine.connect() as connection:
        problems = await connection.run_sync(drift)
    await engine.dispose()
    print("\n".join(problems) if problems else "models and database agree")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
