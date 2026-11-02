#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
RUNTIME_DIR="$ROOT/.local/pprc"
PPRC_CLUB_ID="bbe8f388-df0b-5f70-820a-e36720a5f3ff"

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

apply_api_schema() {
  # Migrations are written to be idempotent, so this is safe for a repeat run.
  local migration
  for migration in backend/sql/*.sql; do
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U pprc -d pprc < "$migration"
  done
}

start_firebase_emulators() {
  start_background firebase pnpm events:emulators
  wait_for http://localhost:4000
  pnpm events:seed
}

seed_api_demo_club() {
  docker compose exec -T api python scripts/seed_fresh_club.py \
    --owner-id admin --owner-name "Club Administrator" --with-demo-players
}

case "${1:-help}" in
  up)
    need docker; need pnpm; need curl
    pnpm install --frozen-lockfile
    docker compose up -d --build
    wait_for http://localhost:8000/health
    apply_api_schema
    start_firebase_emulators
    start_background web pnpm events:dev
    wait_for http://localhost:5173
    echo "PPRC PWA: http://localhost:5173"
    echo "Firebase Emulator UI: http://localhost:4000"
    echo "FastAPI docs: http://localhost:8000/docs"
    echo "Logs: $RUNTIME_DIR/{firebase,web}.log"
    ;;
  up-api)
    need docker; need pnpm; need curl
    pnpm install --frozen-lockfile
    docker compose up -d --build
    wait_for http://localhost:8000/health
    apply_api_schema
    start_firebase_emulators
    seed_api_demo_club
    stop_background web
    start_background web env \
      VITE_DATA_PROVIDER=api \
      VITE_API_BASE_URL=http://localhost:8000 \
      VITE_PPRC_CLUB_ID="$PPRC_CLUB_ID" \
      VITE_PPRC_CLUB_SLUG=pprc \
      pnpm events:dev
    wait_for http://localhost:5173
    echo "PPRC API-mode PWA: http://localhost:5173"
    echo "Sign in as admin@pprc.test / PprcDemo2026! to create TRIACE or Ladder events."
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
    apply_api_schema
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
  up-api            Start the complete FastAPI PWA, Firebase Auth emulator, and seeded fresh club
  down              Stop the local FastAPI/PostgreSQL stack
  reset-local-data  Stop stack and delete only its local Docker volume
  test-all          Run PWA/shared/backend build checks plus FastAPI syntax checks
  test-api          Apply local API migrations and run FastAPI black-box tests
  verify-local      Install dependencies and run all API, Firebase, browser, and static checks
USAGE
    ;;
esac
