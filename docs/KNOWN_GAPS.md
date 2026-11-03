# Known gaps (from the code review)

Fixed items are listed in git history; this file tracks what is still open.

## Product decisions needed
- **Payment gating:** registrations are `confirmed` before payment. Stripe/dev payment does not decide who holds a seat.
- **Double round-robin:** repeat regular-season pairings are allowed on purpose; there is no per-pair limit.

## Backend
- Schema: `create_all` now runs at startup only in development (or when `PPRC_BOOTSTRAP_SCHEMA=true`); deployed schemas come from `backend/sql/*.sql`. Still missing: a migration runner that records applied files.

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
- Double elimination does not seed the losers bracket to avoid rematches. (Single elimination and groups + knockout now offer an optional third-place match.)
- Ladder expiry is applied lazily when the ladder is viewed or challenged, not by a background job. Ladder scores cannot be corrected after ranks move.
- The legacy Firebase wizard lists double elimination, Swiss and ladder as disabled (`requires API mode`) because the Firebase draw engine cannot run them.
- Verified here: `tests/test_formats.py` (27 checks, incl. full double-elimination simulations up to 24 players), `py_compile`, ruff, and a partial `tsc` pass. `tests/test_individual_flow.py` (all formats, walkovers, doubles) needs the Docker stack and has not been run.
- **Groups + knockout:** snake-drawn groups, round robin per group, top N advance to a seeded knockout (migration `007`). Round 1 of the knockout can pair two players from the same group. The legacy Firebase `round-robin-playoffs` draw now also uses a snake draw.
- **Component kit:** `apps/web/src/components.tsx` + `components.css` (StatusBadge, Callout, Tabs, OptionCards, FieldGrid, StatGrid, DataTable, MatchCard, PromptAction, ConfirmAction; all styles prefixed `pp-`). The tournament wizard and competition board use it. The legacy pages (`admin.tsx` events/registrations/scores, `player.tsx`, `App.tsx`) still use the old `.panel/.badge/.tabs` styles and should be migrated page by page. The kit has not been visually checked in a browser (no frontend dependencies in the authoring environment) — review it in `pnpm events:dev` and add Playwright screenshots.

## Closed in the June 2026 gap-filling round
- Batched TRIACE eligibility (fixed query count per division), slug race returns 409, event TRIACE rules sync to every TRIACE division.
- Per-client write rate limit (`PPRC_RATE_LIMIT_WRITES_PER_MINUTE`, in-process) and request body limit (`PPRC_MAX_BODY_BYTES`). Use a shared store if running several workers.
- Swiss: Dutch (top half vs bottom half) pairing inside score groups and a Buchholz tie-break column.
- Optional `thirdPlaceMatch` for single elimination and groups + knockout.
- Organizers can add late players to a drawn round robin; they get one match against every active player.
- Models use portable JSON/UUID/UTC types, so the API also runs on SQLite (used by the hosted preview). PostgreSQL stays the production target.
- Legacy pages now use the component kit's status badges, tables and segmented tabs.
- Public landing page at `/` with a PWA install prompt; event discovery moved to `/events`.

## Still open
- Ladder expiry is still lazy (no background job); ladder scores still cannot be corrected after ranks move.
- Groups + knockout round 1 can still pair two players from the same group with uneven group counts.
- Preview sign-in uses seeded demo accounts (`VITE_AUTH_MODE=demo` + `X-PPRC-User`); production must use Firebase Auth.

## Tenant isolation (reviewed)
- `backend/sql/003_tenant_rls.sql` protects **direct Supabase client access** (JWT `sub` claim). FastAPI connects with the service role, which bypasses RLS, so API isolation is enforced in code.
- Every by-ID lookup sampled in `main.py`, `competitions.py`, `challenges.py` and `ratings.py` authorizes against the loaded row's own `club_id` (`require_role`) or the caller's participation/ownership. Keep that rule for new endpoints: never trust a club id from the URL for an entity loaded by primary key.
- Not yet covered: automated cross-club tests (user in club A hitting club B's ids). Add them to the e2e suite.
