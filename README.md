# PPRC Sports · Events & TRIACE

An original, mobile-first individual and TRIACE team tournament module for Prosper Premier Racquet Club. React 18 + Vite + TypeScript, Tailwind, React Router, TanStack Query, Firebase Auth/Firestore/Gen 2 Functions/Storage, Stripe Checkout, and an installable PWA. Player and admin experiences share one app; permissions are enforced by Functions and security rules.

**Verification:** see [executed checks](docs/VALIDATION.md) and the [completion audit](docs/COMPLETION_AUDIT.md). TRIACE includes real captain invitations, registration, groups, private lineups, opponent-confirmed rubbers, participation, playoffs and champion declaration. Real Firebase staging, Stripe API/refunds, Google sign-in and FCM still require configuration and approval before live use.

## Repository layout

```text
apps/web/          React 18 player and admin PWA
functions/src/     Gen 2 callables, Stripe adapter, scheduled jobs and seed
functions/test/    Firestore transaction and rules integration tests
packages/shared/   Typed models, Zod schemas and tournament algorithms/tests
tests/             Playwright browser and tournament-flow tests
docs/              Architecture, decisions, API, validation and implementation plan
```

The original Next.js prototype below remains intact. Its `app/`, `lib/`, and SQLite `data/` paths are independent of the new Events module. Existing root `dev`, `test`, `seed`, `build` commands still refer to that prototype. Never run its seed command to initialize Events.

## Run locally

Prerequisites: **Node 22 and Java 21+**. On a Mac with Homebrew:

```bash
brew install node@22
brew install --cask temurin@21
export PATH="$(brew --prefix node@22)/bin:$PATH"
```

From the repository folder:

```bash
./pprc.sh setup   # installs project-local pnpm if missing, dependencies and browser
./pprc.sh start   # starts Firebase + Vite; imports saved local state when available
./pprc.sh seed    # initializes synthetic accounts and missing demo events
```

The helper requires no global pnpm install or sudo. Browser tests automatically use managed Chromium on macOS; `PLAYWRIGHT_CHROMIUM_PATH` can override it. Linux cloud uses the installed Chromium.

```bash
./pprc.sh status
./pprc.sh doctor
./pprc.sh stop                 # gracefully exports demo state and stops owned services
./pprc.sh start                # restores .local/emulator-state
./pprc.sh start --reset        # explicit fresh data; do not combine with --import
./pprc.sh start --import PATH  # explicitly restore a Firebase emulator export
./pprc.sh export               # save a snapshot without stopping
```

Run `stop` before starting with `--reset` or a different import. An already-running complete suite is reused. Only managed processes are stopped; foreign port conflicts produce an actionable error. Logs are `.local/emulators.log` and `.local/web.log`. Existing `pnpm events:emulators`, `pnpm events:seed`, and `pnpm events:dev` remain supported for manual development.

The web app uses port 5173. Emulator UI uses 4000, Auth 9099, Firestore 8080, Functions 5001 and Storage 9199. These are local development ports, not public preview links. Auth emulator accounts:

| Role                   | Email                                        | Password      |
| ---------------------- | -------------------------------------------- | ------------- |
| Player                 | player1@pprc.test through player24@pprc.test | PprcDemo2026! |
| Club admin             | admin@pprc.test                              | PprcDemo2026! |
| Assigned event admin   | event-admin@pprc.test                        | PprcDemo2026! |
| Read-only support      | support@pprc.test                            | PprcDemo2026! |
| Unassigned event admin | other-admin@pprc.test                        | PprcDemo2026! |

These accounts exist only in the emulator. The seed refuses a non-demo project and creates 24 sample players, four events (completed singles, open singles, group round robin/playoffs, TRIACE Champions Cup) and four courts. Emulator state is ephemeral unless you use Firebase `--import` / `--export-on-exit`; do not seed production. To reset local data, stop the emulators and restart without an import, then seed again.

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

Formats: individual elimination/round robin/groups, TRIACE 2.0, organizer-configured KOC, fixed-pair doubles tournaments, and singles/doubles ladder seasons. See the [shared team formats](docs/COMPETITIONS.md), [TRIACE rehearsal](docs/TRIACE.md) and [ladder operations](docs/LADDER.md). Ladder seasons reuse registration, consent, verified scoring and audits, with challenges, weekly deadlines, position swaps, separate points champions and optional playoffs. No proprietary rating calculation, external result submission, scraped data or copied branding is included.

## Test commands

The main quality gate finishes with real Firebase integration tests:

```bash
./pprc.sh test-all   # lint, types, unit, build, UI, PWA, restore, full browser, integration LAST
./pprc.sh test       # lint, types, unit, Firebase integration
./pprc.sh test-e2e   # individual + complete TRIACE browser workflows
```

Managed development services are exported/stopped before testing and restored afterwards. Tests use fresh synthetic `demo-pprc-events` data and never import development or production data. Stop manually started emulators/Vite first; test commands refuse unrelated port conflicts. Individual commands remain available:

```bash
pnpm events:lint
pnpm events:typecheck
pnpm events:test
pnpm events:build
pnpm events:ui
pnpm events:pwa
pnpm events:persistence  # isolated export/import; stop managed services first
pnpm events:e2e
pnpm events:integration
```

Browser reports/traces and emulator state remain ignored. `events:persistence` creates its own temporary export directory, verifies an actual callable write, restarts, re-authenticates and reads the private team back. Domain and integration tests cover references, legal lineups/scores, contention, waitlists, role/direct-write denial, participation, disputes, signed Stripe webhook reconciliation and reminders. CI runs the same gate; adding its workflow does not claim a remote CI result.

## Firebase and Stripe staging

The provided Firebase project ID `multiclub-890ea` is configured as the proposed **staging alias**. Its supplied URL was Realtime Database; the app still uses Firestore. No real project has been deployed or populated. Verify this project is isolated from real player data before approving any write.

```bash
pnpm events:staging check
```

Follow [STAGING.md](docs/STAGING.md) for client configuration, Auth, Secret Manager, rules/indexes, Storage CORS, guarded deployment, trusted initial admin bootstrap, private synthetic fixtures, Stripe test-mode checks, FCM/Scheduler and backup/recovery. Missing config fails the check. Mutations require explicit approval plus a matching project guard; live charges are disabled.

Existing Firestore documents stay compatible. [Schema/migration instructions](docs/SCHEMA_MIGRATIONS.md) provide dry-run and additive audited migration commands. No legacy SQLite or actual player data is imported. [Production readiness](docs/PRODUCTION_READINESS.md) lists remaining operational prerequisites and limits.

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

| Area                   | What you can do                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Ratings                | Original game-share rating engine (`lib/rating.ts`), match ratings per player per match, reliability %, 12-month history |
| Players                | Search and filter by name, club, city, division, age group, state; profile with rating plate, stats, chart, results      |
| Rankings               | Leaderboards by division, age group (12U–18U, Adult, 40+) and state                                                      |
| Results                | Add a result with set scores (incl. match tiebreaks, retirements); both ratings recompute instantly                      |
| Events                 | Upcoming level-based events with eligibility check, entry and withdrawal; completed draws round by round                 |
| Clubs                  | Club pages with members and hosted events                                                                                |
| Accounts               | Create a profile with a self-assessed starting level; demo sign-in as any sample player                                  |
| **AI coach**           | Chat grounded in the player's own rating, trend and last 12 months of matches                                            |
| **Video review**       | Upload a clip; get shot grades, patterns, timestamps to rewatch and drills                                               |
| **Generated graphics** | Shareable result cards with a generated court photo; generated profile avatars                                           |

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

| Feature         | Env var                 | Default                   | Notes                                                             |
| --------------- | ----------------------- | ------------------------- | ----------------------------------------------------------------- |
| Coach chat      | `REPLICATE_TEXT_MODEL`  | `google/gemini-3.5-flash` | `system_instruction` + `prompt`                                   |
| Video review    | `REPLICATE_VIDEO_MODEL` | `google/gemini-3.5-flash` | video uploaded through the Files API, passed in `videos`          |
| Cards & avatars | `REPLICATE_IMAGE_MODEL` | `prunaai/p-image`         | `aspect_ratio` 3:4 / 1:1; text is drawn by the app, not the model |

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
