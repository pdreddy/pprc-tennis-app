# Engineering decisions

- Preserve the legacy app instead of replacing or migrating its database. Root `dev`, `build`, `test` remain legacy commands. All new workflow commands use `events:`.
- Use React 18, Vite, Router and TanStack Query. UI components use native labeled form controls, semantic tables, visible focus and reusable card/form/button patterns in the style of accessible shadcn components; no copied product UI or branding.
- Use original CSS court illustrations as default event art. Admins may upload public event cover images. Profile photos and waivers have separate Storage rules.
- Production sign-in supports Google and email/password through Firebase; emulator accounts use email/password. Google requires enabling the provider and authorized domains in the actual project. Email passwordless links are not implemented.
- One PPRC club, USD, America/Chicago by default. Club admins assign event admins explicitly. Platform support is operationally read only. Bootstrap the first production club-admin membership through the Admin SDK/IAM, never client signup.
- External ratings are informational reference fields. There is no PPRC or UTR rating engine, scraping, external submission integration or ladder. Admin verification is audited.
- Seed order prioritizes manually assigned seeds, then external reference values, then deterministic IDs. Admin seed changes always need a reason.
- Results require opponent/admin confirmation. Supervised admins may finalize on submission. Corrections retain old versions and block invalid downstream changes.
- Server transactions are the source of truth. No optimistic client capacity or score advancement. Payment simulation is guarded by `FUNCTIONS_EMULATOR === 'true'`, not a client flag.
- Stripe adapter supports Checkout, signature-verified webhooks and full refunds. No card details enter Firestore. Late successful payments are held for refund, not used to oversell an event.
- UTC inputs and explicit event-local output avoid silently interpreting dates in a developer's timezone. Daily windows and blackouts are configurable; daylight changes use IANA timezone conversion through Intl.
- In-app notifications work immediately with emulators. FCM is environment-dependent. Reminders are scheduled every five minutes and deduplicated by match/player/start time.
- Account deletion is a request/review flow. Administrators must resolve financial, waiver and sporting-record retention before deletion. This is not automatic destructive deletion.
- Generated `functions/deploy` bundles shared code and contains a regular standalone package manifest. No `workspace:*` dependency is shipped to Cloud Build.

## Verification status

See `docs/VALIDATION.md` for measured results and environment blockers. Do not interpret authored tests as executed tests or deploy the platform as production-validated before emulator, Stripe and access-control checks have passed in the target environment.
