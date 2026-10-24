# PPRC Events implementation

The October 24 completion work is recorded in [COMPLETION_AUDIT.md](COMPLETION_AUDIT.md). TRIACE extends this architecture with teams, invitations, lineups, confirmed rubbers, qualification and champion completion; local automation and guarded staging preparation are implemented. [VALIDATION.md](VALIDATION.md) records executed results and [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) identifies remaining external checks. The original implementation notes below describe the first individual Events module.

The existing Next.js prototype, source tree and SQLite data remain intact. The new event module lives in `apps/web`, `functions`, and `packages/shared`, using separate Firebase projects and emulator data. No ladder or proprietary rating algorithm is added.

## Milestones

1. Shared models and validation: deterministic elimination/byes, round robin and playoffs, standings, schedule conflicts, legal scores, permission policy.
2. Trusted Firebase backend: authenticated Gen 2 callables, transaction-backed capacity and waitlist, idempotency, payments, draws, schedules, versioned scores, immutable audits and notifications. Emulator seeds and security rules.
3. React 18/Vite player and admin PWA: discovery, registration, receipts, profiles, event wizard, tournament operations, reporting and audit. Local development uses the actual Firebase emulators, not a client-side fake backend.
4. Validation: domain unit tests, Firestore security and transaction integration tests, Playwright workflows, lint, types, build; deployment and architecture documentation.

## Defaults

Single club (`pprc`), America/Chicago event timezone, USD, email/password and Google authentication; admins assigned through trusted memberships. External ratings are reference data only. Manual score entry and form-based scheduling. Payment simulation is restricted to the Functions emulator; production uses Stripe. No deployment or live payment is performed by setup. FCM and Stripe require environment configuration.

## Delivered milestones

Shared domain logic, transactional Functions, security rules, demo seeding, player/admin PWA and developer documentation are implemented. Validation completed with 26 domain tests, 15 emulator integration tests and three full browser flows; see VALIDATION.md for precise results and the production services that need staging credentials. The legacy source and database remain independent.
