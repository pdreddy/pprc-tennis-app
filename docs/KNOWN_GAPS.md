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

## Tournament formats (added)
Create-tournament now offers TRIACE 2.0, round robin, single elimination and ladder (`backend/app/formats.py` holds the pure draw logic; `competitions.py` the API; migration `005_individual_formats.sql`). Open items:
- Not yet offered: double elimination, Swiss, doubles/team entries for the individual formats, third-place match, consolation brackets.
- A drawn round robin or bracket is locked; late withdrawals need a walkover feature.
- Ladder has no challenge expiry/forfeit rule and ladder scores cannot be corrected after ranks move.
- Registration auto-creates an entry only when the event has exactly one individual division; otherwise organizers add players.
- The legacy Firebase wizard (non-API mode) still shows its old format list.
- New backend endpoints and UI were verified only by the pure-logic unit tests (`tests/test_formats.py`), `py_compile`, ruff and a partial `tsc` pass; `tests/test_individual_flow.py` needs the Docker stack.
