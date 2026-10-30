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

## Tournament formats
TRIACE 2.0, round robin, single elimination, double elimination, Swiss and ladder, singles or doubles (`backend/app/formats.py` pure logic, `competitions.py` API, migrations `005` and `006`). Open items:
- Doubles means fixed pairs. Rotating partners (mixers) and teams larger than two are not supported outside TRIACE.
- Swiss pairs adjacent players by record (not top-half vs bottom-half) and has no Buchholz tie-break.
- Double elimination does not seed the losers bracket to avoid rematches; there is no third-place match.
- A drawn bracket or round robin cannot add late players (withdrawals and walkovers are supported).
- Ladder expiry is applied lazily when the ladder is viewed or challenged, not by a background job. Ladder scores cannot be corrected after ranks move.
- The legacy Firebase wizard lists double elimination, Swiss and ladder as disabled (`requires API mode`) because the Firebase draw engine cannot run them.
- Verified here: `tests/test_formats.py` (27 checks, incl. full double-elimination simulations up to 24 players), `py_compile`, ruff, and a partial `tsc` pass. `tests/test_individual_flow.py` (all formats, walkovers, doubles) needs the Docker stack and has not been run.
