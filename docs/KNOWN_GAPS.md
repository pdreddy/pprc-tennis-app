# Known gaps (from the code review)

Fixed items are listed in git history; this file tracks what is still open.

## Product decisions needed
- **Payment gating:** registrations are `confirmed` before payment. Stripe/dev payment does not decide who holds a seat.
- **Double round-robin:** repeat regular-season pairings are allowed on purpose; there is no per-pair limit.

## Backend
- `ranked_playoff_teams` / `team_eligibility` run several queries per team (N+1); batch if divisions grow.
- Schema is created by `create_all` at startup *and* by `backend/sql/*.sql`; the two can drift. Pick Alembic or the SQL files as the single source and set `PPRC_BOOTSTRAP_SCHEMA=false` in production.
- `create_club` slug uniqueness is check-then-insert; a concurrent duplicate returns 500 instead of 409.
- Rate limiting and request-size limits are not configured.
- `update_event` only syncs rules to the first division of an event.

## Frontend
- `apps/web/src/admin.tsx` (~2000 lines) and `player.tsx` (~1000) should be split by feature.
- No unit tests for `apps/web`; coverage is Playwright only.
- Typecheck, lint and Playwright results for this change set were not run in the authoring environment (no package registry access); CI now runs them.

## Ops
- Legacy Next.js app (`app/`, `components/`, `lib/`) still sits beside the PWA; decide whether to remove it.
- Backend and API changes in this review were not executed locally; rely on CI (`.github/workflows/ci.yml`).
