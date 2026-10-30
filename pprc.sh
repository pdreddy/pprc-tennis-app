#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
RUNTIME_DIR="$ROOT/.local/pprc"

need() { command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }; }
wait_for() { local url="$1"; for _ in $(seq 1 60); do curl -fsS "$url" >/dev/null && return 0; sleep 1; done; echo "Timed out waiting for $url" >&2; return 1; }
start_background() {
  local name="$1"; shift
  mkdir -p "$RUNTIME_DIR"
  if [ -f "$RUNTIME_DIR/$name.pid" ] && kill -0 "$(cat "$RUNTIME_DIR/$name.pid")" 2>/dev/null; then return; fi
  "$@" >"$RUNTIME_DIR/$name.log" 2>&1 & echo $! >"$RUNTIME_DIR/$name.pid"
}
stop_background() {
  local name="$1"
  if [ -f "$RUNTIME_DIR/$name.pid" ]; then
    local pid; pid="$(cat "$RUNTIME_DIR/$name.pid")"
    kill "$pid" 2>/dev/null || true
    rm -f "$RUNTIME_DIR/$name.pid"
  fi
}

case "${1:-help}" in
  up)
    need docker; need pnpm; need curl
    pnpm install --frozen-lockfile
    docker compose up -d --build
    wait_for http://localhost:8000/health
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/001_initial.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/002_multiclub_tournament.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/003_tenant_rls.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/004_triace_score_workflow.sql
    start_background firebase pnpm events:emulators
    wait_for http://localhost:4000
    pnpm events:seed
    start_background web pnpm events:dev
    wait_for http://localhost:5173
    echo "PPRC PWA: http://localhost:5173"
    echo "Firebase Emulator UI: http://localhost:4000"
    echo "FastAPI docs: http://localhost:8000/docs"
    echo "Logs: $RUNTIME_DIR/{firebase,web}.log"
    ;;
  down)
    need docker
    stop_background web
    stop_background firebase
    docker compose down
    ;;
  reset-local-data)
    need docker
    docker compose down -v
    ;;
  test-all)
    need pnpm; need python3; need docker
    pnpm frontend:typecheck
    pnpm backend:build
    pnpm shared:test
    python3 -m compileall -q backend/app backend/tests backend/scripts
    docker compose config --quiet
    echo "Static checks and Compose configuration passed. Run './pprc.sh up' for the PostgreSQL/FastAPI smoke test."
    ;;
  test-api)
    need docker; need curl
    docker compose up -d --build
    wait_for http://localhost:8000/health
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/001_initial.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/002_multiclub_tournament.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/003_tenant_rls.sql
    docker compose exec -T postgres psql -U pprc -d pprc < backend/sql/004_triace_score_workflow.sql
    docker compose --profile test run --rm api-tests
    ;;
  verify-local)
    need docker; need pnpm; need python3; need curl
    pnpm install --frozen-lockfile
    # Use Playwright's managed Chromium so this never depends on /usr/bin/chromium.
    pnpm exec playwright install chromium
    pnpm pprc:check
    "$0" test-api
    pnpm events:integration
    PPRC_REUSE_DEV_SERVER=1 pnpm events:e2e
    pnpm events:ui
    echo "All local PPRC checks passed. Start the app with: $0 up"
    ;;
  *)
    cat <<'USAGE'
Usage: ./pprc.sh <command>
  up                Start PostgreSQL and FastAPI, install JS dependencies, and verify API health
  down              Stop the local FastAPI/PostgreSQL stack
  reset-local-data  Stop stack and delete only its local Docker volume
  test-all          Run PWA/shared/backend build checks plus FastAPI syntax checks
  test-api          Apply local API migrations and run FastAPI black-box tests
  verify-local      Install dependencies and run all API, Firebase, browser, and static checks
USAGE
    ;;
esac
