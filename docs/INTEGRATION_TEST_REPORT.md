# PPRC Sports Elite integration test report

Date: October 24, 2026. Feature branch: `feat/pprc-sports-triace`. Completed foundation commit: `4faa90a`; original baseline: `2b062c6`.

## Milestone 3 completed gate

`./pprc.sh test-all` exited **0** on October 24, 2026: **72 shared unit, 66 Firebase integration, nine full browser, three browser-shell, one production PWA and four legacy tests passed**, with no skipped tests. Actual migration dry-run/apply/idempotence and Firestore/Auth export/import/restore passed. Raw log: `.local/validation/milestone3-final-full.log`. The committed source revision is recorded after the implementation commit.

KOC and doubles now use the existing team transaction engine, collections, payments, scheduling, score history and shared standings. KOC policy is explicitly configurable and must be reviewed before publication. Doubles supports fixed consenting pairs, round robin, knockout/byes and group-stage playoffs. TRIACE retains its default three-player/five-rubber/40% policy and pending 18.5 maximum, with additional configurable encounter confirmation, verification and deadlines. Championship results now persist champion and runner-up. Eligibility snapshot details and structured policy controls are integrated into the React screens.

The new 14 shared tests exercise feasible/infeasible policies, authorized assignments, selected-reference bounds/verification, unknown references, short sets, capped points, deciding match tiebreaks, configured standings and participation denominators. Twelve new Firebase cases cover the complete KOC lifecycle, hidden/revealed lineups, opposing confirmation, version/concurrency/disputes, corrected standings, single playoff generation, all three doubles formats, byes, forfeits, verified membership/references, actual deadline enforcement/extension and foreign-club API/rules denial. The original 13 TRIACE/operations cases also passed in a separate focused regression run before the full gate.

Two new browser journeys exercise the event wizard/policy review, four-player invitations including P4 acceptance, registration/approval/check-in, fixtures/scheduling, captain lineups/encounter confirmation, score submission/opponent confirmation, championship/runner-up and mobile layout. Doubles verifies a real deciding third-set match tiebreak and rejects same-pair confirmation. Browser setup initially read invitations/playoffs before asynchronous UI operations finished; explicit persisted-state readiness assertions fixed the harness, retaining every workflow assertion. The existing history heading assertion was updated to the generalized “My team match history”; its TRIACE record checks remain.

Authorization now checks the event club in trusted operations and Firestore reads. Administrative lists use explicit club scopes and declared indexes; foreign membership/profile/resource overwrites are rejected. Support remains read-only. Bulk schedule notices are consolidated per team; finals cannot precede scheduled group fixtures. Complete encounter forfeits also terminate correctly under a normal play-all policy.

See COMPETITIONS.md for supported configuration and limits. No reference package was available, no proprietary rating algorithm was added, and no production deployment/live payment/real-player mutation was performed. Milestone 4 is in progress; its sporting ladder is not yet complete.

## Milestone 2 completed gate

`./pprc.sh test-all` exited **0** on October 24, 2026. Tested implementation commit: `9077c2a237fb2186eddaad22c852402c741d78cf` (based on foundation `4faa90a`). Actual results: **58 shared unit, 54 Firebase integration, seven full browser, three browser-shell, one production PWA and four legacy tests passed**, with no skipped cases. Migration dry-run/apply/reapply and complete Firestore/Auth backup/restore passed. Log: `.local/validation/milestone2-final-full-rerun.log`.

The added vertical slice covers Auth signup/profile → membership request → trusted review → private-event discovery/registration/development payment → linked notification → privacy opt-out. Public player search/profiles and a clearly labeled supplied-reference leaderboard use whitelist projections. The owner-only dashboard derives confirmed individual results and actually assigned team rubbers, excludes pending/superseded scores, reports corrections once, and shows immutable reference snapshots without inventing rating history. Mobile bottom navigation preserves existing guarded routes.

New Firebase cases comprise nine membership, seven performance and three actual CLI projection-migration tests, added to the original 35. Compound indexes are declared for the new queries. The full gate now runs the four legacy tests and actual migration dry-run/apply/idempotence inside the isolated backup/restore rehearsal.

### Failures found and corrected in this cycle

- The first full baseline had 53 Firebase tests passed and one failed because a notification assertion assumed only its two fixture administrators existed. It now compares the exact trusted recipient set, still detecting missing, extra and duplicated notices; the complete rerun passed all 54.
- Browser coverage exposed raw Firestore permission errors and React Query's rejection of `undefined` for missing documents. Reads retain authorization denial while showing an actionable message; absent documents return `null`, and opted-out profiles show a deliberate empty state.
- A complete run stopped after six flow tests passed and the Club mobile-width assertion failed. The diagnostic identified `6.699999999999999` in a reference card: document width 432 versus viewport 390. Reference displays now use two decimals and flexible grid tracks. The unchanged width requirement includes loaded-directory readiness and diagnostic details; all seven browser flows passed both the focused rerun and final full gate. No test was disabled or weakened.
- Child tooling tried the read-only home dependency store. Helpers now use pnpm 11's supported `pnpm_config_store_dir` and the existing writable install store. The cloud install helper passed frozen installation, types, lint, all 58 shared tests and both builds after the fix.
- The cloud workspace disconnected during mobile diagnosis, then reconnected with the working tree intact. Failed/interrupted runs are retained as failures, not counted as completed validation.

### Milestones 3 and 4

TRIACE's foundation remains validated. Explicit runner-up declaration, configurable KOC/doubles extensions and the sporting ladder are still pending; requesting a milestone does not establish its implementation. The UTR reference audit remains R0: no authorized local APK/XAPK or direct observation evidence is available.

The supplied ladder rules are recorded in LADDER.md. Confirmed decisions: acceptance closes five days before the final Sunday freeze; doubles use fixed, consenting season pairs; playoffs default off unless configured by the organizer. Existing supplied-reference leaderboards are not a sporting ladder.

## Foundation gate (historical)

Completed foundation command: `./pprc.sh test-all`. **Exit 0** for the tested implementation committed as `4faa90a`: 48 shared unit, 35 Firebase integration, five full-flow browser, three browser-shell and one production PWA test passed. Persistence passed. Managed development services were exported/stopped before the suite and restored afterwards. No integration tests were skipped. This completed run re-establishes the baseline for the next onboarding/membership cycle.

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
