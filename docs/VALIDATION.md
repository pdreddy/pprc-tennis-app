# PPRC Sports validation — October 24, 2026

Executed on this cloud workspace with Node 22.23.3, pnpm 11.25.0, Java 21 and Chromium. Tests use actual local Firebase Auth, Firestore, Gen 2 Functions and Storage emulators for `demo-pprc-events`. No production or actual-player data was used.

| Check                        | Actual result              | Coverage/evidence                                                                                                                                                               |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./pprc.sh test-all`         | Exit 0                     | Full command ran lint → types → unit → builds → UI → PWA → migration/persistence → full browser → Firebase integration last                                                               |
| Shared domain                | 58 passed, 0 skipped       | Original 26 plus TRIACE references/bounds, roster combinations, score legality, participation and standings                                                                     |
| Firebase integration         | 54 passed, 0 skipped       | Original 35 plus membership 9, owner performance 7 and actual CLI projection migration 3                                                                         |
| Full browser workflows       | 7 passed                   | Original registration/payment/draw/score, waitlist and wizard; TRIACE invitations/registration/groups/lineups/confirmed rubbers/semifinals/final/champion; mobile/access checks |
| Browser shell                | 3 passed                   | Discovery/mobile navigation, authorization gates, labeled sign-in; explicit demo configuration assertion                                                                        |
| Production PWA               | 1 passed                   | Standalone manifest, icons, active worker, offline shell reload and mobile overflow                                                                                             |
| Types/lint/production build  | Passed                     | Existing three Events workspaces; standalone Functions and Vite PWA                                                                                                             |
| Persistence                  | Passed                     | Actual callable team creation → Firestore/Auth export → graceful stop → import → re-authentication → private roster restored                                                    |
| Setup/start/stop/seed/doctor | Passed on this Linux cloud | Frozen install/build, managed readiness, repeated seed, owned process shutdown and restored state; macOS-specific installation not physically executed                          |
| Migration                    | Passed                     | Dry run found three original demo events; apply migrated three; repeat applied zero; sporting records unchanged                                                                 |
| Legacy                       | 4 tests passed             | Git diff confirms no changes to `app`, `lib`, `data` or legacy seed source                                                                                                      |
| Test configuration isolation | Passed                     | UI and PWA commands passed with deliberately conflicting remote/emulator environment variables; test servers force local demo config and do not reuse foreign servers           |
| Staging config               | Blocked, not deployed      | Local check correctly reports absent Firebase web config/HTTPS server origin; approval guard refuses an unapproved deployment without calling Firebase                          |

The integration suites cover transactional invitation races, exact team capacity and automatic waitlist promotion, idempotent receipts, reference eligibility, 40% participation denial, early clinch cancellation, forfeits, opponent-only confirmation, corrected/superseded records, playoff locks, immutable audit/direct-write denial, private lineup/media access, foreign-club Storage denial, and scheduled reminder deduplication. Signed webhook tests use Stripe's actual signature verifier with synthetic payloads and real Firestore reconciliation; no Stripe API calls or live charges occur.

Final raw runner excerpts:

```text
Shared:       Test Files 4 passed; Tests 58 passed
UI:           3 passed
PWA:          1 passed
Persistence:  PASS: real callable team write, Firestore/Auth export, graceful stop,
              import, re-authentication and private roster restoration.
Browser flow: 7 passed
Integration:  Test Files 7 passed; Tests 54 passed
Legacy:       tests 4; pass 4; fail 0; skipped 0
Migration:    Applied: 3 event(s). Repeat: Applied: 0 event(s).
```

Local evidence logs are ignored under `.local/validation/`: `milestone2-final-full-rerun.log` (latest full command exit 0), `final-integration-isolated.log` (last integration run), `test-isolation-ui.log`, `test-isolation-pwa.log`, `setup-final.log`, and the three migration logs. Reproducible commands are in README. Public synthetic UI captures are [desktop](screenshots/pprc-sports-desktop.png) and [mobile](screenshots/pprc-sports-mobile.png). No secret-bearing traces or emulator exports are committed.

Earlier runs exposed and fixed profile verification compatibility, inaccessible input labeling, permission-incompatible invitation/schedule query scopes, stale HTTP connections after emulator restart in the persistence harness, and fixture date/assertion errors. Failed intermediate runs are not counted as successful checks. Final integration has no disabled or skipped cases. Browser test servers now force demo bindings even when a workstation has staging settings.

Not executed: Firebase staging/Hosting deployment, real Google provider configuration, Stripe API Checkout/refunds and merchant webhook delivery, FCM device delivery, managed Scheduler IAM/timed invocation, managed cloud export/recovery, physical iPhone/Safari certification, or remote GitHub Actions execution. The Scheduler handler was directly exercised against Firestore; its deployed job was not. CI configuration is authored, not claimed remotely green. See STAGING.md and PRODUCTION_READINESS.md before live use.

Milestone 2 adds two real browser journeys: new-account membership/private-event payment/privacy opt-out, and persisted performance/reference leaderboard/mobile profiles. Its 58 shared and 54 Firebase tests, 11 total browser/PWA tests, four legacy tests, migration and backup/restore passed together. See INTEGRATION_TEST_REPORT.md for source revision and failed-run diagnoses.
