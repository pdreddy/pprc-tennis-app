# PPRC Events

An original, mobile-first tournament and event module for Prosper Premier Racquet Club. React 18 + Vite + TypeScript, Tailwind, React Router, TanStack Query, Firebase Auth/Firestore/Gen 2 Functions/Storage, Stripe Checkout, and an installable PWA. Player and admin experiences share one app; permissions are enforced by Functions and security rules.

**Current verification:** domain tests, type checks, lint, production builds, browser UI checks and Firebase emulator integration checks have passed. All three tournament-flow browser tests pass; see [validation details](docs/VALIDATION.md). Stripe test-mode reconciliation, real Google sign-in and FCM delivery still require staging configuration before live use.

## Repository layout

```text
apps/web/          React 18 player and admin PWA
functions/src/     Gen 2 callables, Stripe adapter, scheduled jobs and seed
functions/test/    Firestore transaction and rules integration tests
packages/shared/   Typed models, Zod schemas and tournament algorithms/tests
tests/             Playwright browser and tournament-flow tests
docs/              Architecture, decisions, API, validation and implementation plan
backend/           FastAPI + PostgreSQL multi-club SaaS migration service
docker-compose.yml Local PostgreSQL and FastAPI stack
pprc.sh            One-command local stack, test, and reset workflow
```

## Multi-club migration service

The installable PWA and Firebase workflow remain the live PPRC pilot. `backend/` is the separate FastAPI/PostgreSQL service for the club-by-club SaaS migration: every operational record has a `club_id`, and the initial API covers clubs, roles, events, registrations, waitlists, payments, matches, and immutable audit logs. It is intentionally parallel to Firebase, so no player or event data is cut over without an approved export and reconciliation.

```bash
chmod +x pprc.sh
./pprc.sh up          # PostgreSQL + FastAPI at http://localhost:8000/docs
./pprc.sh test-all    # PWA, Firebase Functions, shared domain, and FastAPI checks
./pprc.sh down
```

For Supabase, create a project, set `DATABASE_URL` to its pooler connection string, apply `backend/sql/001_initial.sql`, and set `PPRC_BOOTSTRAP_SCHEMA=false`. Production authentication should validate Firebase/Supabase JWTs at the FastAPI boundary; the development-only `X-PPRC-User` header is intentionally explicit and must not be exposed publicly.

Apply `backend/sql/002_multiclub_tournament.sql` after the initial migration for seasons, TRIACE teams, divisions, courts, schedules, standings, notifications, and Supabase RLS. To import the existing Firebase PPRC pilot into a staging PostgreSQL database, set `FIREBASE_SERVICE_ACCOUNT` to a local service-account JSON file and run `python backend/scripts/import_firestore.py`. Run the importer only against a staging copy first, compare membership/event/registration counts, and schedule the production cutover after that reconciliation succeeds.

The original Next.js prototype below remains intact. Its `app/`, `lib/`, and SQLite `data/` paths are independent of the new Events module. Existing root `dev`, `test`, `seed`, `build` commands still refer to that prototype. Never run its seed command to initialize Events.

## Run locally

Prerequisites: Node 22 (production Functions target), pnpm 11.25+, Java 21+, and Chromium for Playwright. The cloud environment includes checksum-verified Node 22.23.3 and runs Functions with that runtime. Install a Playwright-managed Chromium on a normal workstation and set `PLAYWRIGHT_CHROMIUM_PATH` to that binary, or use `/usr/bin/chromium` on this cloud machine.

```bash
pnpm install --frozen-lockfile
# Terminal 1: builds Functions and starts real Firebase emulators
pnpm events:emulators
# Terminal 2: seed once after emulator readiness; repeat preserves existing events
pnpm events:seed
pnpm events:dev
```

The web app uses port 5173. Emulator UI uses 4000, Auth 9099, Firestore 8080, Functions 5001 and Storage 9199. These are local development ports, not public preview links. Auth emulator accounts:

| Role | Email | Password |
| --- | --- | --- |
| Player | player1@pprc.test through player16@pprc.test | PprcDemo2026! |
| Club admin | admin@pprc.test | PprcDemo2026! |
| Assigned event admin | event-admin@pprc.test | PprcDemo2026! |
| Read-only support | support@pprc.test | PprcDemo2026! |
| Unassigned event admin | other-admin@pprc.test | PprcDemo2026! |

These accounts exist only in the emulator. The seed refuses a non-demo project and creates 16 sample players, three events (completed singles, open singles, group round robin/playoffs) and four courts. Emulator state is ephemeral unless you use Firebase `--import` / `--export-on-exit`; do not seed production. To reset local data, stop the emulators and restart without an import, then seed again.

Local defaults require no `.env` and no payment secrets. `apps/web/.env.example` documents public Firebase config; copy it to `.env.local` only if overriding defaults. `functions/.env.example` documents production origin and Secret Manager bindings. Never put Stripe secret keys or service-account JSON in `VITE_*` variables.

On this restricted cloud machine, dependency installation may need:

```bash
npm_config_devdir=/workspace/.cache/node-gyp pnpm install --frozen-lockfile --store-dir /workspace/.cache/pnpm
```

The Firebase wrapper puts emulator downloads and CLI configuration in the checkout's ignored `.local/` directory instead of an unwritable home. Firebase's normal artifact checksum and TLS verification remain enabled. Required download domains: `storage.googleapis.com`, `firebase-public.firebaseio.com`; package registries are also required. These domains are saved in the environment draft and emulator downloads were verified after network access became available.

## Player flow

1. Browse `/events`; filter by keyword, date, location, price, reference level, sport, type, category or availability.
2. Sign in and complete `/profile`. UTR/external values are references only, with a separately audited admin verification workflow.
3. Choose a division, answer questions, acknowledge the waiver and optionally upload a signed waiver PDF.
4. Open `/my-events`; complete payment with the emulator-only simulator. Full divisions use a server-ordered waitlist; withdrawal opens a place and promotes the next player.
5. Follow published draws, `/schedule`, confirmations, results, match history and notifications.

## Admin flow

1. `/admin/events/new`: configure basics/cover, registration, eligibility divisions, scoring, courts, daily hours and blackouts. Create a draft, preview and publish.
2. Review paid/free entries; approve and seed with an audit reason. Resolve pending registrations before generating the division draw.
3. Generate/publish the draw, generate the basic court schedule, and check players in.
4. Enter legal scores; supervised admins can finalize directly. Players submit for opponent/admin confirmation. Winners advance transactionally.
5. Review corrections, reporting reference status, payments/refund requests and CSV exports. Audit history is immutable from clients.

Formats: single elimination, round robin, and group round robin with knockout playoffs. A division locks new registration after draw generation. Standings ties affecting playoff qualification require explicit resolution. No proprietary rating calculation, ladder, external result submission, scraped data or copied branding is included.

## Test commands

Stop any manually running emulator suite before integration/E2E commands; those commands own fresh emulator processes. Run E2E against fresh unseeded emulator state: its command seeds the project itself.

```bash
pnpm events:lint
pnpm events:typecheck
pnpm events:test            # shared domain tests
pnpm events:build           # standalone Functions package + PWA
pnpm events:ui              # browser shell/navigation/sign-in checks, no emulators needed
pnpm events:integration     # real Firestore transactions + security rules
pnpm events:e2e             # real callable-driven player/admin flows via Playwright
```

`PLAYWRIGHT_CHROMIUM_PATH` overrides `/usr/bin/chromium`. `pnpm exec playwright install chromium` installs Playwright's managed browser; update that variable/configuration when using the managed binary. Browser screenshots, traces and reports are generated under ignored `test-results/` and `playwright-report/`. Full-flow tests include registration/payment, approval/seeding, draw publication, scheduling, scores and waitlist promotion. Integration tests also cover contention, idempotency, roles, immutable audits and direct-write denial.

## Firebase and Stripe deployment

Deployment is intentionally not executed here. Use a **separate Firebase project from the existing ladder**, enable billing/required APIs for Gen 2 Functions, Firestore, Auth, Storage and Scheduler, and choose the desired Firestore region before creating data.

1. Enable Google and/or email/password in Firebase Auth; add the Hosting domain as authorized.
2. Bootstrap `memberships/{FIRST_ADMIN_UID}` through a trusted Admin SDK/IAM process with `{clubId:'pprc', role:'clubAdmin', member:true}`. Never grant this through signup or browser writes.
3. Create `apps/web/.env.production.local` using your project's public Firebase configuration and `VITE_USE_EMULATORS=false`. Set messaging sender/VAPID config if using FCM. Build-time client config requires a rebuild after changes.
4. Create ignored `functions/.env.YOUR_PROJECT_ID` containing `APP_ORIGIN=https://YOUR_PROJECT_ID.web.app`. The Functions build copies environment files into the generated deployment package. Keep secret values in Secret Manager:

```bash
pnpm exec firebase functions:secrets:set STRIPE_SECRET_KEY --project YOUR_PROJECT_ID
pnpm exec firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project YOUR_PROJECT_ID
pnpm events:build
pnpm exec firebase deploy --project YOUR_PROJECT_ID --only firestore,storage,functions,hosting
```

5. Configure Stripe test-mode Checkout webhook delivery to the deployed `stripeWebhook` Gen 2 URL. Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Use the corresponding signing secret. The handler verifies raw-body signatures, amount, currency, session and user binding; it does not trust redirect query parameters. Stripe test secrets are required for real payment/refund checks. The emulator payment adapter uses no Stripe key.
6. Test signed webhook retries, duplicate delivery, late payments, withdrawals/refunds, unauthorized access and notification delivery against a staging project before enabling live payments. For Stripe CLI forwarding, use a dedicated staging test endpoint/key; do not point a live Stripe account at the local simulator.
7. Configure Storage bucket CORS for the actual Hosting origin for authenticated profile photo reads. Covers are public marketing images; profile photos and waivers have separate access rules.

`functions/deploy/` is generated and ignored. It includes bundled shared code and a standalone `package.json` with normal runtime dependencies, so Cloud Build does not need the pnpm workspace. Production targets Node 22. The cloud helper `bash scripts/events/cloud-install.sh` activates the verified Node 22 runtime and runs the installation/build checks. On a workstation, use your own Node 22 and pnpm installation. No production credentials, deployment, FCM delivery, fresh-task restoration or live Stripe transactions have been verified in this session.

## Scope and operations

Configured in source: all listed player/admin routes, trusted tournament operations, capacity/waitlist handling, audited versions/corrections, exports, in-app notifications, PWA shell, Storage rules, templates, role management and demo seeds. Environment-dependent: Firebase project setup, enabled Auth providers, signed Stripe checkout/webhooks/refunds, FCM/VAPID, scheduled jobs and deployment. Cloud instance verification is listed separately in `docs/VALIDATION.md`.

The release uses a basic form-based scheduler and supervised administrative workflow. Account deletion is a club-reviewed request, not automatic erasure. Scheduled maintenance and push require deployed managed services. Large events should be load-tested; event-wide transactions intentionally cap scope. See [architecture](docs/ARCHITECTURE.md), [decisions](docs/DECISIONS.md) and [API](docs/API_AND_FUNCTIONS.md).

---

# Legacy prototype documentation

# Baseline

A level-based tennis rating app in the spirit of UTR, with its own name, rating engine and sample data.
Players get one rating from 1.00 to 16.50 built from the share of games they win against opponents of known level,
and it updates the moment a result is added. AI features run on [Replicate](https://replicate.com), following the
[replicate/skills](https://github.com/replicate/skills) guides.

## What's in it

| Area | What you can do |
|---|---|
| Ratings | Original game-share rating engine (`lib/rating.ts`), match ratings per player per match, reliability %, 12-month history |
| Players | Search and filter by name, club, city, division, age group, state; profile with rating plate, stats, chart, results |
| Rankings | Leaderboards by division, age group (12U–18U, Adult, 40+) and state |
| Results | Add a result with set scores (incl. match tiebreaks, retirements); both ratings recompute instantly |
| Events | Upcoming level-based events with eligibility check, entry and withdrawal; completed draws round by round |
| Clubs | Club pages with members and hosted events |
| Accounts | Create a profile with a self-assessed starting level; demo sign-in as any sample player |
| **AI coach** | Chat grounded in the player's own rating, trend and last 12 months of matches |
| **Video review** | Upload a clip; get shot grades, patterns, timestamps to rewatch and drills |
| **Generated graphics** | Shareable result cards with a generated court photo; generated profile avatars |

## Run it

Requires Node 20+.

```bash
npm install
npm run seed      # creates data/baseline.db with 160 fictional players, ~1,100 matches, 26 events
npm run dev       # http://localhost:3000
npm test          # rating engine + parser tests
```

The database is also seeded automatically on first request if it's empty.

## Turn on the AI features

Without a token the app runs in **sample mode**: every AI feature works end to end with realistic placeholder output,
clearly labelled in the UI.

```bash
cp .env.example .env.local
# add REPLICATE_API_TOKEN=r8_... from https://replicate.com/account/api-tokens
```

Default models (official, always-warm, picked from Replicate's official collection in Oct 2026):

| Feature | Env var | Default | Notes |
|---|---|---|---|
| Coach chat | `REPLICATE_TEXT_MODEL` | `google/gemini-3.5-flash` | `system_instruction` + `prompt` |
| Video review | `REPLICATE_VIDEO_MODEL` | `google/gemini-3.5-flash` | video uploaded through the Files API, passed in `videos` |
| Cards & avatars | `REPLICATE_IMAGE_MODEL` | `prunaai/p-image` | `aspect_ratio` 3:4 / 1:1; text is drawn by the app, not the model |

Per the find-models skill, models change weekly: check the
[official collection](https://replicate.com/collections/official) and each model's schema
(`GET /v1/models/{owner}/{name}`, helper `inputSchema()` in `lib/replicate.ts`) before swapping. Community models need
`owner/name:version`. Generated files are downloaded straight away because Replicate output URLs expire after an hour.

To use the Replicate skills while you keep building with Claude Code or another agent:

```bash
npx skills add replicate/skills
```

## Code map

```
lib/rating.ts            rating engine (pure, tested)
lib/ratings-service.ts   recompute all ratings, match ratings and monthly history
lib/seed.ts              fictional data, matches simulated from hidden skill
lib/replicate.ts         Replicate HTTP client: predictions, polling, Files API, downloads
lib/ai.ts                coach, video review, result cards, avatars (+ sample mode)
lib/queries.ts           read models for pages
app/actions.ts           server actions: sign in, create profile, record result, enter event
app/**/page.tsx          pages;  app/api/*  AI endpoints;  app/media/[file]  generated files
```

## How the rating works

Each match gives each player a match rating = opponent's rating + `ln(share / (1 − share))` (one point ≈ winning 73% of games).
A player's rating is the weighted average of their last 30 match ratings within 12 months, weighted by recency
(120-day half-life), format (best-of-5 > best-of-3 > pro set > one set > tiebreak), match length and the opponent's
reliability, with a light prior towards the starting level. The whole pool is solved iteratively until it settles.
Constants are at the top of `lib/rating.ts`.

## Before production

- Replace demo sign-in (`lib/session.ts`) with real auth, and add verification for self-reported results.
- Move from SQLite to Postgres for multi-instance hosting; recompute ratings in a background job as the pool grows.
- Store uploads and generated media in object storage (S3/R2) instead of `data/`.
- Use Replicate webhooks instead of polling for long video reviews.
- Doubles ratings, payments for event entry, and a mobile app (Expo) are natural next steps.
- Keep your own branding: don't use UTR's name, logo or rating data.
