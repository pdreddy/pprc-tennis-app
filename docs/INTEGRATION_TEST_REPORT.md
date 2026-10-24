# PPRC Sports Elite integration test report

Date: October 24, 2026. Feature branch: `feat/pprc-sports-triace`. Baseline: `2b062c6`.

## Final branch gate

Command: `./pprc.sh test-all`. **Exit 0** on the current feature branch: 48 shared unit, 35 Firebase integration, five full-flow browser, three browser-shell and one production PWA test passed. Persistence passed. Managed development services were exported/stopped before the suite and restored afterwards. No integration tests were skipped. This completed run re-establishes the baseline for the next onboarding/membership cycle.

## Executed focused results

| Suite/check | Actual result | Scope |
| --- | --- | --- |
| Shared domain | 48 passed | Original 26 plus reference bounds, authorized lineups, rubber scores, participation and standings |
| Firebase integration | 35 passed | Real Auth/Firestore/Functions/Storage emulators; four test files |
| Full browser workflows | 5 passed | Original three workflows plus complete TRIACE lifecycle and mobile/role checks |
| Browser shell | 3 passed | Includes demo-project assertion with deliberately conflicting workstation environment settings |
| Production PWA | 1 passed | Manifest, icons, active worker, offline shell and responsive layout |
| Legacy | 4 passed | Original parser/rating tests; legacy source/seed paths unchanged |
| Persistence | Passed | Real callable write, export/import, restart, re-authentication and private roster restoration |
| Migration | Passed | Dry run 3; applied 3; repeated apply 0 |
| Setup and process control | Passed on Linux cloud | Frozen install/build, start/readiness, seed, stop/export, import/start, status and doctor |

The 35 integration tests comprise 15 existing cases, six TRIACE lifecycle cases, seven operations/concurrency/reminder cases and seven payment cases. There are no skipped or disabled integration cases in the successful run. Full browser coverage uses actual Firebase callable requests and reads; synthetic fixtures are not a replacement backend.

## Authorization, concurrency and lifecycle evidence

- Captains create teams and send private invitations. Only invitees respond; simultaneous acceptance cannot enroll a player on two teams. Decline/revoke and exact request retries preserve consistent rosters.
- Concurrent team registrations respect exact capacity. Withdrawal automatically promotes waiting entries. Server-side reference snapshots use the higher singles/doubles value and enforce the configured combined range.
- Unassigned organizers, players and read-only support cannot mutate organizer operations. Firestore clients cannot forge teams, lineups, sporting results, payments or immutable audits. Storage rejects foreign-club administrative access and unauthorized/MIME uploads.
- The complete six-team rehearsal registers/approves teams, assigns groups, generates fixtures/schedules, hides lineups until both captains submit, confirms rubbers, resolves a score correction while retaining its superseded record, checks singles participation, generates semifinals/final and declares the champion without manual tournament database edits.
- A separate scenario rejects playoff qualification when the third player misses the 40% requirement. Early clinch cancels unused rubbers; forfeits record reasons without invented participation/points. Qualification and downstream locks protect corrections.
- Stripe's actual signature verifier rejects tampering, stale signatures, live events and forged HTTP requests. Reconciliation checks ownership/session/amount/currency, deduplicates delivery, handles failed/expired and late payments, and exercises emulator refunds in Firestore. It does not call a merchant API.
- Scheduled maintenance is directly invoked against Firestore to verify deduplicated individual/team reminders. The production Scheduler and FCM device delivery remain external checks.

## Failures found and corrected

Earlier runs caught omitted-field compatibility for verified profiles, an inaccessible player invitation input, query scopes inconsistent with strict read rules, stale HTTP connection reuse after emulator restart, a fixture deadline a few milliseconds after its start, and an outdated error-message expectation after adding post-fixture organizer withdrawal. The withdrawal assertion now checks the specific `permission-denied` authorization code. No failing scenario was removed, disabled or replaced with a simulation. Shared-emulator test files are serialized to prevent rule reload races.

Browser test servers force demo configuration and refuse to reuse an unrelated server. UI and PWA checks also passed with `VITE_USE_EMULATORS=false` and an intentionally conflicting dummy remote project in the parent environment. All real test data stays in the local demo project; production credentials/data are unnecessary.

## Artifacts and remaining prerequisites

Raw logs and traces stay ignored under `.local/validation/`, `test-results/` and `playwright-report/`. The final feature-branch log is `.local/validation/feature-branch-full.log`. A summary is in [VALIDATION.md](VALIDATION.md) and [machine-readable evidence](validation/2026-10-24.json). Synthetic screenshots are in `docs/screenshots/pprc-sports-*.png`.

The provided `multiclub-890ea` project is only a proposed staging alias. Client Firebase config and HTTPS server origin are missing; the approval guard correctly refuses unapproved deployment. No production/staging deployment or live payment was performed. Real Google Auth, Stripe test API/refunds, FCM, managed Scheduler, cloud backup/recovery, physical iPhone/Safari and remote CI still need the documented staging configuration and approval. See [STAGING.md](STAGING.md), [TRIACE.md](TRIACE.md) and [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
