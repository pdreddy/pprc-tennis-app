# PPRC Fresh-Club Release Readiness

## Scope

This release starts a new PPRC club. It does not import legacy Firebase, UTR, payment, or player data. PostgreSQL/Supabase is the system of record for the FastAPI path; Firebase remains the authentication provider during the transition.

## Implemented in this branch

- Public event catalogue, event details, and division catalogue through FastAPI.
- Firebase-authenticated event registration, automatic player membership, waitlist handling, withdrawal, and in-app notification read state.
- Multi-club database schema, tenant RLS migration, TRIACE team/fixture/standings/playoff APIs, audit logs, and developer checkout support.
- Fresh-club seed script, Supabase-compatible migrations, and one-command local runner.

## Required before enabling `VITE_DATA_PROVIDER=api`

1. Apply every numbered file in `backend/sql/` to the target database, in numeric order. `./pprc.sh up-api` does this for the local stack.
2. Seed the first PPRC owner and events using `backend/scripts/seed_fresh_club.py`.
3. Configure Firebase Auth, the FastAPI CORS origin, `VITE_API_BASE_URL`, and `VITE_PPRC_CLUB_SLUG=pprc`.
4. Run `./pprc.sh test-api`, `./pprc.sh test-all`, `pnpm events:integration`, `pnpm events:e2e`, and `pnpm events:ui` on a Node 22 developer machine.
5. Complete manual checks for sign-in, browse, registration, withdrawal, waitlist promotion, notifications, and admin event publishing.

## Local FastAPI acceptance flow

Run the actual product path, rather than the legacy Firebase-only shell:

```bash
./pprc.sh up-api
```

It starts PostgreSQL, FastAPI, Firebase Auth/Firestore emulators, applies every API migration, creates the fresh PPRC club, and starts the PWA with `VITE_DATA_PROVIDER=api`. Sign in as `admin@pprc.test` / `PprcDemo2026!`, then use **Admin portal → Create event**. Choose **TRIACE 2.0** for the team competition or **Ladder** for an ongoing individual challenge ladder.

The local seed uses the same player IDs as the Auth emulator, so `player1@pprc.test` through `player16@pprc.test` can join individual events immediately. The seeded club ID is deterministic and is supplied by the launcher; do not hard-code it in a production deployment.

## Explicit production release blockers

- The legacy Firebase mode still exists as a fallback. Production must deploy the API-mode PWA (`VITE_DATA_PROVIDER=api`) with the FastAPI base URL and seeded club configuration; do not mix the two data stores for one live club.
- Email and push delivery require provider configuration and device testing.
- Live Stripe payment/refund processing is deferred until Stripe keys, webhook, and reconciliation testing are approved.
- Production hosting, backups, monitoring, domain setup, and load testing require separate environment approval.

## Go / no-go rule

Do not enable API mode in production until every required check above is recorded with a date, command output, and responsible owner. Keep Firebase mode as the fallback until the administrator workflows have FastAPI parity.
