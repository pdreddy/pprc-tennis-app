# Firebase staging runbook

The supplied Realtime Database URL identifies project **multiclub-890ea**. The `.firebaserc` staging alias targets that project; the default remains `demo-pprc-events`. This configuration does not create a project, verify its isolation, deploy services or import data. The Events backend continues using **Firestore**, not Realtime Database.

Confirm this is an isolated staging project before any write. If it contains real club/player data, select a separate project and update the staging alias/CORS origins. All automated tests and seeds stay on local demo emulators. No deployment approval has been supplied or exercised.

## Configuration before approval

1. In Firebase/Google Cloud, verify project ownership, staging isolation, billing and IAM. Enable Firestore, Auth, Storage, Cloud Functions Gen 2, Cloud Run, Artifact Registry, Cloud Build and Cloud Scheduler. Choose Firestore location deliberately before creating a database; current Functions use `us-central1`.
2. Enable email/password and optionally Google Auth. Add the Hosting/custom domain to Auth authorized domains. Create staging test identities through the application; do not import emulator Auth exports or demo passwords.
3. Copy `apps/web/.env.example` to ignored `apps/web/.env.production.local`. Set `VITE_USE_EMULATORS=false` and copy the actual public Firebase web-app values from project settings: API key, project ID, auth domain, bucket and app ID. Use the actual bucket name rather than assuming `.appspot.com`. Set sender/VAPID public configuration for FCM if testing push. Never place passwords, Stripe secrets or service-account files in the frontend.
4. Create ignored `functions/.env.multiclub-890ea` containing `APP_ORIGIN=https://multiclub-890ea.web.app` (or the approved HTTPS custom origin). Use Secret Manager for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; configure **test-mode** keys only. The code rejects live Stripe keys and live webhook events.
5. Run `pnpm events:staging check`. This inspects local configuration only; missing config produces a nonzero result. Passing it does not prove billing/IAM/Auth/Stripe readiness.

## Deployment and trusted admin bootstrap

Only after explicit approval, an authorized operator can run:

```bash
export PPRC_ALLOW_STAGING_WRITE=multiclub-890ea
pnpm events:staging deploy --approve-staging
```

This builds the existing workspaces and deploys Firestore rules/indexes, Storage rules, Functions and Hosting to the fixed staging alias. It refuses missing/incorrect client configuration and active emulator bindings. Firebase authentication/ADC must already be available; no credentials are printed or embedded by these commands. Use Firebase's interactive Secret Manager prompts to set test secrets after approval; never paste their values into chat or source.

Sign up the first administrator with Firebase Auth, obtain their UID through trusted project administration, then bootstrap exactly one missing membership:

```bash
pnpm events:staging bootstrap --uid ADMIN_UID --approve-staging
```

Bootstrap verifies the Auth identity and refuses to overwrite any existing membership. It creates the trusted `pprc` club-admin membership and an audit record. Sign out/in to refresh app permissions. Subsequent role changes use Club admin → Members & roles. Create the club details, venue and courts through those audited screens.

## Synthetic staging fixtures and migration

```bash
pnpm events:staging fixtures --uid ADMIN_UID --approve-staging
pnpm events:migrate --project multiclub-890ea --dry-run
# Separate approved step after backup and dry-run review:
pnpm events:migrate --project multiclub-890ea --apply --approve-staging
```

Fixtures create a **private draft** using validated synthetic event configuration only. They do not copy emulator accounts/passwords, profiles, real players, waivers, payments, push tokens, operation receipts or audit exports. Add staging-only players through Auth/signup, invitations and registration. This is a safe configuration rehearsal rather than a raw emulator export import into a real project.

Apply `storage.cors.staging.json` to the actual staging bucket with `gcloud storage buckets update gs://ACTUAL_STAGING_BUCKET --cors-file=storage.cors.staging.json` after approval; update origins for custom domains. Verify authenticated image reads, private waiver access and rejected foreign/MIME uploads.

## Staging smoke and payments/notifications

Run `pnpm events:staging smoke` after deployment. It verifies Hosting, routes, manifest, icons and worker, not full backend correctness. Then perform:

- Email/password signup/login; Google redirect/popup on the authorized domain; profile privacy; trusted role bootstrap and every unauthorized role scenario.
- A full six-team TRIACE rehearsal using staging-only identities, the documented singles rotation, opponent confirmations, dispute correction, semifinal/final advancement, reporting and audit history.
- Stripe test Checkout from a real staging registration. Subscribe the deployed `stripeWebhook` URL to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Use the corresponding test signing secret.
- Signed webhook replay and changed amount/currency/session rejection; failed/expired checkout releases a reservation; waitlist promotion; late successful payment becomes Refund Required; real Stripe test refund reconciliation and retry recovery. Emulator signature/reconciliation tests do not prove Stripe API connectivity or merchant configuration.
- Verify in-app notifications and read state. Configure Web Push credentials/VAPID, opt in on a supported browser, register a device token, then confirm FCM receipt and notification navigation. The emulator intentionally does not send FCM.
- Verify the deployed Scheduler job executes every five minutes under the correct service account. Confirm deadline transitions, payment expiry, individual/team reminder delivery and duplicate suppression. Direct emulator invocation does not verify Cloud Scheduler IAM/timed execution.
- Verify PWA installation/offline shell on a real iPhone/Safari and supported Android/browser devices. Authenticated writes require reconnecting; the worker does not queue financial or tournament mutations.

## Backup and recovery

Use a staging-only, access-restricted Cloud Storage bucket in a compatible location. Grant the Firestore service agent the required export/import bucket access and set retention/encryption/lifecycle according to club policy. After approval:

```bash
pnpm events:staging backup --bucket gs://STAGING_BACKUP_BUCKET/exports/REHEARSAL_ID --approve-staging
```

Record the export path, timestamp, project, application commit, rules/index configuration and Auth/Storage backup plans. Firestore export does not back up Auth users or Storage objects. Protect backups as private club data. For a recovery drill, use an empty isolated recovery project, point the staging alias to it deliberately, deploy its rules/indexes, and import the approved Firestore export with `gcloud firestore import gs://BUCKET/EXPORT --project RECOVERY_PROJECT`. Explicit recovery approval is required; do not restore over an active competition. Verify counts, roster/result versions, immutable audits, access rules and the champion before allowing writes. Reconnect Auth identities/Storage separately. Keep financial provider records authoritative during reconciliation.

Actual Google Auth, Firebase staging deployment, FCM delivery, Scheduler IAM, Stripe API/refunds and managed backup/recovery have not been executed in this cloud task. They require the above configuration and approval. Local emulator export/import is separately tested.
