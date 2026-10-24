# PPRC Sports validation — October 24, 2026

Latest complete command: `./pprc.sh test-all`, **exit 0**. Runtime: Node 22.23.3, pnpm 11.25.0, Java 21 and Chromium. Actual Firebase Auth, Firestore, Gen 2 Functions and Storage emulators use `demo-pprc-events` and synthetic data.

| Check | Actual result |
| --- | --- |
| Shared unit | 72 passed, zero skipped |
| Firebase integration | 66 passed, zero skipped; eight files |
| Full browser workflows | Nine passed, including original individual/TRIACE and new KOC/doubles journeys |
| Browser shell | Three passed |
| Production PWA | One passed; manifest/icons/worker/offline shell/mobile |
| Legacy | Four passed; source/database/seed unchanged |
| Lint, types, builds | Passed |
| Migration | Actual dry run three, apply three, reapply zero; preservation verified |
| Projection migration | Three actual CLI Firebase cases included above |
| Backup/restore | Actual callable write, export, graceful stop, import, re-authentication and all private team fields restored |

Raw log: `.local/validation/milestone3-final-full.log`. Tested source revision, focused checks and failed-run diagnoses are in INTEGRATION_TEST_REPORT.md; machine-readable results are in validation/2026-10-24.json. Test servers force local demo settings and do not reuse unrelated listeners. No failing test was skipped, removed or replaced with simulated validation.

Milestone 3 adds configurable KOC, fixed-pair doubles across three formats, shared captain/lineup/score/standings lifecycle, explicit encounter confirmation, deadlines, champion/runner-up persistence and club-scoped authorization. See COMPETITIONS.md. The ladder is the next implementation cycle, not an already completed feature.

Not executed: real Firebase deployment, Google provider setup, Stripe API Checkout/refunds, FCM device delivery, deployed Scheduler IAM/invocation, managed cloud recovery, physical iPhone/Safari certification or remote GitHub Actions. Proposed staging remains multiclub-890ea, unverified and undeployed. No live payment or real player data was modified.
