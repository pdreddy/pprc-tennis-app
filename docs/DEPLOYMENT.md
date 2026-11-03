# Deploying PPRC

Two pieces: the **web app** (static, Netlify) and the **API** (a Docker container) with a **PostgreSQL** database. They are
connected by two settings: the API's CORS origin and the web app's API URL.

```
Browser ──► Netlify (apps/web/dist) ──► API container (backend/Dockerfile) ──► PostgreSQL
                  │  Firebase Auth (or Clerk) sign-in; the API verifies the tokens
```

## 1. Database (PostgreSQL 14+)

Any managed Postgres works (Render, Neon, Supabase, Railway, RDS). Use the connection string as-is: `postgres://`,
`postgresql://` and `?sslmode=require` are converted for the async driver automatically.

- Behind a **Supabase / PgBouncer transaction pooler** (port 6543) also set `PPRC_DB_POOLER=true`.
- The schema comes from `backend/sql/*.sql`, applied in order by `python backend/scripts/migrate.py` and recorded in
  `schema_migrations`. Set `PPRC_RUN_MIGRATIONS=true` and the container does this on every start.
- **Existing database that was created by the app itself** (`create_all`): run `python scripts/migrate.py --baseline --through 014`
  with `--through 014` to record 001–014 as applied, then a normal run applies 015 and 016 (they convert native enum columns to text
  and add missing timestamp columns).
- `python backend/scripts/schema_drift.py` reports any difference between the models and the migrated database. CI runs it.

## 2. API

Build `backend/Dockerfile` (default target `runtime`) on any container host. `render.yaml` is a ready Render Blueprint
(API + database); Fly.io, Railway and Cloud Run need the same variables.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the Postgres connection string |
| `PPRC_ENVIRONMENT` | `production` (the default; **never** `development` in a deployment, it enables an impersonation header) |
| `PPRC_RUN_MIGRATIONS` | `true` |
| `PPRC_BOOTSTRAP_SCHEMA` | `false` |
| `PPRC_AUTH_PROVIDER` | `firebase` or `clerk` (pin it; startup fails if its credentials are missing) |
| `FIREBASE_PROJECT_ID` / `CLERK_SECRET_KEY` | for the chosen provider |
| `PPRC_CORS_ORIGINS` | your Netlify origin, e.g. `https://pprc.netlify.app` (comma-separate extras) |
| `PPRC_APP_ORIGIN` | the same origin (used in email links and Stripe redirects) |
| `PPRC_TRUST_PROXY` | `true` behind the host's proxy so rate limits use the real client address |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional; point the Stripe webhook at `https://<api>/v1/webhooks/stripe` |

The container listens on `$PORT` (default 8000) and exposes `/health`.

After the first deploy create your club once (any signed-in user can `POST /v1/clubs`; the creator becomes owner) or use
`backend/scripts/seed_fresh_club.py`, then note the club id/slug for the web app.

## 3. Web app on Netlify

`netlify.toml` already sets the build (`pnpm --filter @pprc/web build`), publish directory (`apps/web/dist`), SPA redirect,
cache headers and security headers. In *Site configuration → Environment variables* set:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://<your-api-host>` (no trailing slash) |
| `VITE_PPRC_CLUB_SLUG` | the club slug (default `pprc`) |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID` | your Firebase web app config (public identifiers) |

Add the Netlify domain to Firebase Authentication → Authorized domains. `VITE_*` values are baked in at build time, so
redeploy after changing them. Other static hosts (Vercel, Cloudflare Pages, S3 + CloudFront) work the same way: build with
`pnpm --filter @pprc/web build`, serve `apps/web/dist`, and rewrite unknown paths to `index.html`.

## 4. Checks before go-live

- `GET https://<api>/health` returns `{"status":"ok"}`; a write without a token returns 401 and `X-PPRC-User` is rejected.
- Sign in on the Netlify site; the browser console shows no CORS errors (a CORS error means `PPRC_CORS_ORIGINS` does not match the site origin exactly, including `https://` and no trailing slash).
- Back up the database before the first migration run on real data (`pg_dump`).

## Local production-like run

```bash
docker compose up --build            # API applies the SQL migrations to Postgres, like a deployment
docker compose --profile test up --build --abort-on-container-exit --exit-code-from api-tests api-tests
```
