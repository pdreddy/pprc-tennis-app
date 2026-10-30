# PPRC Sports — 3-Week Go-Live Tracker

**Target:** PPRC pilot go-live in three weeks. PWA is the release product; Android packaging is optional after the PWA is stable.

## Status key

- **Done** — implemented and validated in this repository.
- **In progress** — code exists, but the complete workflow is not yet verified.
- **Not started** — required for release, with no implementation evidence yet.
- **Blocked** — requires credentials, a live service, or a decision outside this repository.

## Current release truth

The Firebase PWA remains the operating pilot. The FastAPI/PostgreSQL service is a parallel multi-club migration path and is **not** the live source of truth yet. No production player data, payments, or UTR data has been moved.

| Area | Status | Current evidence / next action |
|---|---|---|
| React/Vite installable PWA shell | Done | PWA source exists; web TypeScript check passed. |
| Firebase Functions event workflow | Done | Functions production build passed. |
| Tournament domain rules | Done | 26 shared domain tests passed. |
| Firebase emulator integration and browser E2E | In progress | Must run on a Mac with Docker, Java, Firebase emulator downloads, and Playwright Chromium available. |
| FastAPI/PostgreSQL service | In progress | Container, base API, multi-club migration, and local runner exist. Docker runtime verification is pending on a developer machine. |
| Firebase token validation in FastAPI | In progress | Server boundary is implemented; requires Firebase project ID and real token validation in staging. |
| Firestore-to-PostgreSQL migration | In progress | Import script handles memberships, events, and registrations; must run on a staging Firebase export and reconcile counts. |
| PWA reads/writes through FastAPI | Not started | Firebase remains the active data layer until parity testing succeeds. |
| Stripe live payment and refunds | Blocked | Requires staging Stripe keys, webhooks, and business approval. |
| Push notifications | Blocked | Requires Firebase Cloud Messaging/VAPID configuration and device testing. |
| Production deployment, backups, monitoring | Not started | Requires cloud accounts, domains, secrets, and hosting decisions. |

## Week 1 — stabilize the PWA pilot

| Task | Status | Exit criteria |
|---|---|---|
| Run `./pprc.sh up` on macOS | In progress | PostgreSQL, FastAPI, Firebase emulators, seed data, and PWA all start successfully. |
| Fix any Docker/FastAPI startup errors | In progress | `http://localhost:8000/health` returns OK. |
| Run `./pprc.sh test-all` | In progress | Typecheck, Functions build, shared tests, Python checks, and Compose validation pass. |
| Run Firebase integration suite | Not started | `pnpm events:integration` completes with real emulator evidence. |
| Run Playwright PWA suite | Not started | `pnpm events:ui` and `pnpm events:e2e` complete with screenshots/traces. |
| Capture product screenshots | Not started | Player home, event details, registration, schedule, results, admin event setup, draw, and score entry captured. |
| Validate PWA install on iPhone and Android | Not started | App installs, opens offline shell, and authenticated session works. |
| Resolve P0 usability defects | Not started | No broken player/admin path in the verified demo flow. |

## Week 2 — complete multi-club readiness

| Task | Status | Exit criteria |
|---|---|---|
| Apply PostgreSQL migrations locally | In progress | `001_initial.sql` and `002_multiclub_tournament.sql` run idempotently. |
| Validate tenant isolation | Not started | A user from Club A cannot read or change Club B data. |
| Complete FastAPI API coverage | In progress | Clubs, memberships, events, registration/waitlist are available; teams, TRIACE, schedules, standings, scores, payments, and notifications still need endpoints. |
| Add TRIACE lifecycle API | In progress | Team registration, three-player roster validation, configurable combined-rating thresholds, admin approval, fixtures, singles-participation eligibility, result recording, and standings recalculation are implemented. Playoff fixture generation and champion reporting remain. |
| Add tournament administration API | Not started | Divisions, draws, scheduling, check-in, score confirmation, corrections, and audit views work end to end. |
| Add FastAPI test suite | Not started | API authorization, tenant isolation, waitlist contention, score workflow, and TRIACE eligibility tests pass. |
| Build Firebase-to-PostgreSQL staging import | In progress | Existing importer runs against staging and produces a count/reconciliation report. |
| Add PWA data-provider switch | Not started | Per-club feature flag selects Firebase or FastAPI without changing screens. |

## Week 3 — staging and launch readiness

| Task | Status | Exit criteria |
|---|---|---|
| Configure staging Firebase/Auth | Blocked | Real Firebase project, authorized domains, Email/Google providers, and first club-admin membership set. |
| Configure staging PostgreSQL/Supabase | Blocked | Managed database, backups, migrations, service credentials, and RLS verified. |
| Configure Stripe test-mode | Blocked | Checkout, webhook signature checks, refund path, duplicate webhook handling, and reconciliation tested. |
| Configure notifications | Blocked | Email and push notification test delivery confirmed on real devices. |
| Security review | Not started | No development header in production; secret scan, CORS review, auth/RBAC tests, audit-log review complete. |
| Performance and concurrency test | Not started | Measure 100 concurrent users, 500 players, and 1,000 matches; document actual results. |
| Backup and restore rehearsal | Not started | Restore a staging backup and verify data integrity. |
| PPRC cutover rehearsal | Not started | Firestore export → PostgreSQL import → count reconciliation → rollback plan tested. |
| Go/no-go review | Not started | P0 tasks complete, production checklist approved, and support owner identified. |
| Production launch | Not started | Deploy PWA first; enable FastAPI club-by-club after reconciliation. |

## UTR-like functional parity checklist

This is a functional reference checklist only. PPRC uses original branding and its own rules; it does not copy UTR software, proprietary ratings, data, or assets.

| Player capability | Firebase pilot | FastAPI migration |
|---|---|---|
| Sign in and profile | Done | In progress |
| Browse and filter events | Done | Not started |
| Register, waiver, payment state, waitlist | Done | In progress |
| Event schedule and match history | Done | Not started |
| Draws, results, standings | Done | Not started |
| Player notifications | Done in-app | Not started for API |
| Admin event setup and publish | Done | In progress |
| Registration approval and seeding | Done | Not started |
| Draw generation and schedule | Done | Not started |
| Score review, corrections, audit | Done | Not started |
| TRIACE team competition | Partial | Not started |
| Stripe live checkout/refunds | Blocked | Blocked |
| Verified-score/UTR integration | Not included | Not included |

## Commands to record evidence

```bash
./pprc.sh up
./pprc.sh test-all
pnpm events:integration
pnpm events:e2e
pnpm events:ui
```

For every completed task, record the date, command or test run, result, relevant screenshot/trace, and commit SHA in the release notes. Do not mark a task Done based only on code review.
