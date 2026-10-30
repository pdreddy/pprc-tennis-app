# PPRC application boundaries

The PPRC Events product is a PWA-first application with independently deployable frontend and backend layers.

## Frontend — `apps/web`

- React, TypeScript, Vite, and the installable PWA shell.
- Firebase client SDK only: Authentication, Firestore reads, callable Functions, Storage, and Messaging.
- Contains player, organizer, and club-admin experiences.
- Must not contain service-account credentials, Stripe secrets, privileged writes, rating calculations, or scheduling authority.

## Backend — `functions`

- Firebase Gen 2 Cloud Functions deployed from `functions/deploy`.
- Owns validation, transaction-safe registrations, waitlist promotion, draws, scheduling, score finalization, payments, refunds, exports, notifications, audit records, and scheduled maintenance.
- Owns all secrets and privileged Firebase Admin access.
- Is the only layer allowed to make authoritative tournament-state changes.

## Shared domain — `packages/shared`

- Pure TypeScript models, schemas, scoring validation, draws, standings, and schedule algorithms.
- No browser APIs, Firebase Admin SDK, secrets, or side effects.
- Imported by both layers to keep rules consistent.

## Supporting infrastructure

- `firestore.rules`, `storage.rules`, and `firebase.json` define the security and deployment boundary.
- `scripts/events` contains build, emulator, packaging, and deployment helpers.
- The legacy Next.js prototype at the repository root is separate from PPRC Events and must not be used for the PPRC production flow.

## Commands

| Task | Command |
| --- | --- |
| Run the PWA | `pnpm frontend:dev` |
| Build the PWA | `pnpm frontend:build` |
| Run backend emulators | `pnpm backend:emulators` |
| Build the backend | `pnpm backend:build` |
| Test shared tournament logic | `pnpm shared:test` |
| Run the safe full verification set | `pnpm pprc:check` |

Use `pnpm events:e2e` for the complete emulator-driven player and admin journey. It requires a supported Java runtime, Firebase emulator support, and Chromium.