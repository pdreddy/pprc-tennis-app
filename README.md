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
