#!/bin/sh
# Optionally apply backend/sql migrations, then serve. Hosts that inject $PORT (Render, Railway, Cloud Run) are honoured.
set -e
if [ "${PPRC_RUN_MIGRATIONS:-false}" = "true" ]; then
  python scripts/migrate.py
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
