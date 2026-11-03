# PPRC Tennis Platform — PRD

## Original problem statement
1. "Build a landing page: i was building this as pwa website and its a UTR tennis app so lets do that gap filling" → continue existing repo pdreddy/pprc-tennis-app, branch feat/fresh-pprc-fastapi-pwa. User picked: landing page, run PWA here on FastAPI, migrate old pages to new look, backend gap fixes, tournament format gaps. Payments: keep confirmed-before-payment.
2. Turn PPRC into an independent UTR-style competition platform under PPRC branding with an original **PPRC Rating** (1.00–16.50, provisional, reliability, singles/doubles, deterministic & versioned, recalculation on corrections), player profiles/directory/public profiles, club + platform rankings, player-reported results with confirmation/dispute/verification/void, walkovers etc. never rated, doubles history, nav (Players, Rankings, My Rating, My Matches, Events, Ladder, Admin), migrations, seed, tests (unit, API, Playwright), docs. Stripe and Firebase→Postgres migration deferred.

## Architecture
- `apps/web`: React 18 + Vite PWA (served on :3000 in preview via `/app/frontend/package.json` → vite). API mode (`VITE_DATA_PROVIDER=api`).
- `backend/app`: FastAPI (mounted under `/api` by `backend/server.py` in preview). PostgreSQL in production; preview uses SQLite file `/app/data/pprc.db` via portable model types.
- Rating: `pprc_rating.py` (pure engine), `rating_service.py` (club replay + competition sync), `ratings.py` (endpoints). Migration `backend/sql/008_pprc_rating.sql`.
- Preview auth: DEMO sign-in (`VITE_AUTH_MODE=demo`, `X-PPRC-User` header, development env only). Production: Firebase Auth.

## Implemented
- 2026-06 round 1: landing page `/`, install prompt, preview runtime on FastAPI, kit badges/tables/tabs on legacy pages, batched TRIACE eligibility, slug 409, multi-division rule sync, rate/body limits, third-place match, Swiss Dutch pairing + Buchholz, late round-robin entries.
- 2026-06 round 2: PPRC Rating engine `pprc-rating-1.0` + docs/PPRC_RATING.md; profiles with onboarding starting level & visibility; directory, profile pages with history chart, partners, form; club & all-clubs rankings (filters, pagination, 30-day movement); report/confirm/dispute/verify/correct/void; tournament & ladder results feed ratings; private players anonymised; ladder page; API-mode nav and redirects of Firebase-only screens; seed with rated demo matches + ladder; UI "UTR" labels replaced by PPRC rating; `./pprc.sh test-rating-ui` + verify-local; README/RELEASE_READINESS updated; fixed wrong PPRC_CLUB_ID in pprc.sh.
- Tests: 128 backend tests pass (incl. 11 rating unit, 12 rating API, testing-agent regression); 4 Playwright rating flows pass against preview.

- 2026-06 round 3: TRIACE rubbers feed PPRC Rating (migration 009); profile photo upload (Emergent object storage, magic-byte check); milestone cards with share sheet / PNG download; Emergent-managed sign-in (Google + email code) in hosted preview with auto-join and ADMIN_EMAIL admin; dev header disabled on hosted preview. 123 backend tests pass on a dev-header test server; testing agent iteration 2 verified real sign-in UI flows.

## Backlog
- P1: background worker for recalculation; admin UI to promote members; Playwright flows for Emergent sign-in (ticket based).
- P2: ladder expiry background job; groups+knockout same-group R1 avoidance; split admin.tsx/player.tsx; Stripe live payments.
