# PPRC feature matrix (audit at commit 2b062c6, baseline 2026-10-24)

Legend: ✅ implemented · 🟡 partial · ❌ missing. "Events app" = `apps/web` + `functions` + `packages/shared`. "Legacy" = root Next.js prototype with SQLite.

## Baseline test results (executed)
| Check | Result |
| --- | --- |
| Legacy `pnpm test` | 4 passed |
| Shared domain tests | 26 passed |
| Typecheck (shared, functions, web) | passed |
| ESLint | passed (no output) |
| Emulator integration (`events:integration`) | 15 passed |
| Playwright (`events:e2e`, `events:ui`) | not yet run in this audit |

## Matrix
| Area | Feature | Status | Notes |
| --- | --- | --- | --- |
| Auth | Email/password, Google, roles via memberships | ✅ | roles: player/eventAdmin/clubAdmin/platformAdmin |
| Auth | Server-side permission checks | ✅ | all writes via callables; rules deny direct writes |
| UI | Responsive PWA, manifest, service worker | ✅ | Workbox app-shell only |
| UI | Midnight navy / champagne gold theme | ❌ | current palette navy + teal (`style.css`) |
| UI | Mobile bottom navigation | ❌ | top `<nav>` only |
| UI | Scoreboard, bracket visual, player card | 🟡 | bracket data exists; check visuals in `admin.tsx`/`player.tsx` |
| UI | Loading/error/empty states | 🟡 | inconsistent |
| Player | Profile (public/private projection), photo | ✅ | `saveProfile`, Storage rules |
| Player | Onboarding wizard | 🟡 | profile form only |
| Player | Singles/doubles ratings | ❌ | single `externalRating` |
| Player | Match history, analytics | ❌ | only in legacy (SQLite) |
| Player | Player search, rankings | ❌ | legacy only (`app/players`, `app/leaderboard`) |
| Club | Club doc, memberships, `manageClub` | ✅ | single club `pprc` |
| Club | Directory, announcements | ❌ | legacy `app/clubs` only |
| Formats | Single elimination, round robin, RR + playoffs | ✅ | `shared`, `engine.ts` |
| Formats | Doubles / team entries | ❌ | registrations are single player |
| Formats | Ladders | ❌ | explicitly out of scope previously |
| Formats | KOC, TRIACE 2.0 | ❌ | |
| Ops | Create/publish event, registration, waitlist, payments | ✅ | Stripe + emulator simulator |
| Ops | Approvals, check-in, seeds | ✅ | |
| Ops | Draw, schedule, conflicts | ✅ | basic scheduler |
| Ops | Score entry, correction, finalize, dispute | ✅ | versioned results |
| Ops | Captain invites, lineup submission | ❌ | needs teams |
| Ops | Notifications in-app / FCM | ✅/🟡 | FCM needs project config |
| Ops | Reporting | 🟡 | CSV export |
| Tests | Unit / emulator / rules | ✅ | rules covered inside integration |
| Tests | Playwright core + UI | 🟡 | exist, mobile viewport coverage limited |
| Tests | TRIACE lifecycle | ❌ | |
| Deploy | Docs, indexes, rules, functions | 🟡 | see ARCHITECTURE/VALIDATION; no staging project |

## Schema gaps
Need: `teams`, `teamMembers`, `teamInvites`, `lineups`, `rubbers`, `ratings` (singles/doubles), `clubAnnouncements`, `ladders`/`challenges`, and player-level aggregates. Entity docs currently assume `playerId` per registration.
