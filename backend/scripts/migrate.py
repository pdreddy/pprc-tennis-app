"""Apply backend/sql/*.sql in order and remember which files ran.

    python scripts/migrate.py            # apply every file not yet recorded
    python scripts/migrate.py --baseline # existing database: record all files as applied without running them
    python scripts/migrate.py --baseline --through 014  # ...only files up to 014, then a normal run applies the rest
    python scripts/migrate.py --status   # list applied and pending files

Each file runs in its own transaction together with its bookkeeping row, so a failure leaves the database at the
previous file. Uses DATABASE_URL (the SQLAlchemy +asyncpg suffix is accepted).
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
TABLE = "schema_migrations"


def pending_files(files: list[str], applied: set[str]) -> list[str]:
    """Unapplied files in name order. Refuses a gap: an applied file must never sort after a pending one."""
    ordered = sorted(files)
    todo = [f for f in ordered if f not in applied]
    if todo and applied:
        newest_applied = max((f for f in ordered if f in applied), default=None)
        if newest_applied and todo[0] < newest_applied:
            raise SystemExit(f"{todo[0]} is pending but {newest_applied} is already applied; fix the history before migrating")
    unknown = applied - set(files)
    if unknown:
        raise SystemExit(f"Applied migrations missing from {SQL_DIR}: {', '.join(sorted(unknown))}")
    return todo


def dsn(url: str | None = None) -> str:
    """libpq-style DSN for asyncpg.connect from whatever DATABASE_URL spelling the host provides."""
    url = url or os.environ.get("DATABASE_URL", "postgresql+asyncpg://pprc:pprc@localhost:5432/pprc")
    parts = urlsplit(url.strip())
    query = [("sslmode" if key == "ssl" else key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "channel_binding"]
    return urlunsplit(("postgresql", parts.netloc, parts.path, urlencode(query), parts.fragment))


async def main(mode: str, through: str | None = None) -> None:
    import asyncpg

    connection = await asyncpg.connect(dsn())
    try:
        await connection.execute(f"create table if not exists {TABLE} (filename text primary key, applied_at timestamptz not null default now())")
        applied = {row["filename"] for row in await connection.fetch(f"select filename from {TABLE}")}
        todo = pending_files([p.name for p in SQL_DIR.glob("*.sql")], applied)
        if mode == "baseline" and through:
            todo = [name for name in todo if name.split("_")[0] <= through]
        if mode == "status":
            print("applied:", *sorted(applied), sep="\n  ")
            print("pending:", *todo, sep="\n  ")
            return
        for name in todo:
            async with connection.transaction():
                if mode == "apply":
                    await connection.execute((SQL_DIR / name).read_text())
                await connection.execute(f"insert into {TABLE} (filename) values ($1)", name)
            print(("recorded " if mode == "baseline" else "applied ") + name)
        if not todo:
            print("nothing to do")
    finally:
        await connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--baseline", action="store_true")
    group.add_argument("--status", action="store_true")
    parser.add_argument("--through", help="with --baseline: only record files up to this number, e.g. 014")
    args = parser.parse_args()
    asyncio.run(main("baseline" if args.baseline else "status" if args.status else "apply", args.through))
    sys.exit(0)
