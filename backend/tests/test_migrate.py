"""DB-free tests for the migration ordering rules."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("migrate", Path(__file__).resolve().parent.parent / "scripts" / "migrate.py")
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)

FILES = ["002_b.sql", "001_a.sql", "003_c.sql"]


def test_all_pending_on_empty_database_in_order():
    assert migrate.pending_files(FILES, set()) == ["001_a.sql", "002_b.sql", "003_c.sql"]


def test_only_unapplied_files_remain():
    assert migrate.pending_files(FILES, {"001_a.sql", "002_b.sql"}) == ["003_c.sql"]


def test_gap_in_history_is_refused():
    with pytest.raises(SystemExit):
        migrate.pending_files(FILES, {"001_a.sql", "003_c.sql"})


def test_applied_file_missing_from_disk_is_refused():
    with pytest.raises(SystemExit):
        migrate.pending_files(FILES, {"009_gone.sql"})


def test_real_sql_directory_has_unique_ordered_names():
    names = sorted(p.name for p in migrate.SQL_DIR.glob("*.sql"))
    assert names and len({n.split("_")[0] for n in names}) == len(names)


@pytest.mark.parametrize("raw,expected", [
    ("postgres://u:p@h/db", "postgresql://u:p@h/db"),
    ("postgresql+asyncpg://u:p@h/db?ssl=require", "postgresql://u:p@h/db?sslmode=require"),
    ("postgresql://u:p@h/db?sslmode=require&channel_binding=require", "postgresql://u:p@h/db?sslmode=require"),
])
def test_migration_dsn_accepts_every_host_spelling(raw, expected):
    assert migrate.dsn(raw) == expected
