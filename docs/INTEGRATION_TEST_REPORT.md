# PPRC Sports Elite integration test report

Date: October 24, 2026. Feature branch: `feat/pprc-sports-triace`. Completed foundation commit: `4faa90a`; original baseline: `2b062c6`.

## Milestones 5 and 6 — end-of-milestone gate

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `973c672` (on `4ef2b49`). Actual results: **135 shared unit**, **92 Firebase integration (fifteen files)**, **24 browser flows**, three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Failure found and fixed during this gate: the core registration-to-score flow failed in the full run only. The cause was state left by the availability browser test, which saved a Monday-evening preference for a seeded player; the scheduler then correctly refused slots outside it. The test now restores the original availability in a `finally` block. The core flow then passed in the full run.

Limitations that remain: the full UI functionality audit, accessibility and performance measurements, and the Phase 14 scenario list are not complete. Ranking movement appears only after the second week close. Organizer approval and reminder timing are per event; the team and captain workflows beyond the card view are unchanged.

## Milestone 5 slice 2 and Milestone 6 slice 5 — availability and ladder standings

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `4ef2b49` (on `7660257`). Actual results: **112 shared unit** (eight new availability cases), **88 Firebase integration (eleven files)** (four new availability cases: owner write, invalid window and missing profile rejected, owner-only read via rules, client write denied), **21 browser flows** (two new: private availability persists after reload; rankings show ladder standings or an explicit empty state with the reference list), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Limitations: availability is stored and visible to its owner and club administrators, but it is not yet used by the scheduler or doubles/team overlap checks (the `sharedWindows` helper exists and is tested). Rankings show standings only; ranking movement and tiebreaker explanations are not yet shown.

## Milestone 6 slice 4 — profile summary

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `7f21a10` (on `1c4a29e`). Actual results: **108 shared unit**, **84 Firebase integration (ten files)**, **19 browser flows** (one new: profile summary shows labelled ratings, confirmed record and teams on a 390px viewport), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Limitation: the summary does not yet show rating history, recent opponents or performance charts, and it has no profile-photo control beyond the existing edit form.

## Milestone 6 slice 3 — tournament discovery

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `12b0389` (on `066941a`). Actual results: **108 shared unit** (eight new discovery cases), **84 Firebase integration (ten files)**, **18 browser flows** (one new: discovery groups filter the list and each count matches its visible cards on a 390px viewport), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Limitation: discovery groups are derived from event status and dates on the client. Featured events, rules pages and waitlist position are not yet shown on cards.

## Milestone 6 slice 2 — player home dashboard

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `2478f67` (on `b328908`). Actual results: **102 shared unit**, **84 Firebase integration (ten files)**, **17 browser flows** (two new: a signed-in player's personal home with no load errors and a 390px overflow check; the guest landing page with no personal data), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Limitation: the home reads supplied references and PPRC records only. It does not show a verified UTR rating, rating history, or recent-results cards; those remain on the performance dashboard.

## Milestone 6 slice 1 — mobile navigation

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `52697fd` (on `e66c17b`). Actual results: **102 shared unit**, **84 Firebase integration (ten files)**, **15 browser flows** (two new: five mobile destinations with active-state checks, and profile links to My teams, Club and Players; the club mobile test now reaches Club through Profile), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration and backup/restore passed.

Earlier failing run: the first gate attempt failed at lint on two icon imports left unused by the new bottom bar. They were removed and the gate was rerun in full.

Remaining Milestone 6 work: design system, player dashboard, discovery, profile, match center, rankings, captain workflows, notification UX, PWA review, and the Phase 14 scenarios.

## Milestone 5 slice 1 — court maintenance blocks

`./pprc.sh test-all` exited **0** on October 25, 2026. Tested implementation commit: `884de66` (on `adfb728`). Actual results: **102 shared unit** (six new court-block cases), **84 Firebase integration across ten files** (four new court-block emulator cases: fixtures avoid a blocked court, direct schedule is rejected then accepted after release, unauthorized/inverted/foreign-court requests denied, court edits keep blocks), **13 browser flows** (two new: club admin blocks and releases a court; non-admin cannot see the form), three browser-shell, one production PWA and four legacy tests passed, with no skipped tests. Migration dry-run/apply/idempotence and Firestore/Auth backup/restore passed. Earlier failing run: the focused emulator run first failed on a fixture with too few teams for the group minimum; the fixture was corrected to four teams and the test rerun. The raw log was kept outside the repository and is not committed.

Milestone 5 remains incomplete: player availability, rescheduling requests, notification center, reminders, organizer dashboard, calendar/ICS and their tests are not implemented. See COURT_MANAGEMENT.md, SCHEDULING_ENGINE.md and NOTIFICATION_ARCHITECTURE.md.

## Milestone 4 completed gate

`./pprc.sh test-all` exited **0** on October 24, 2026. Tested implementation commit: `b4ec00441a80eb48d0b5d9133f933988b8522a01`. Actual results: **96 shared unit, 80 Firebase integration (nine files), 11 complete browser workflows, three browser-shell, one production PWA and four legacy tests passed**, with zero skipped tests. Actual migration dry-run/apply/reapply and Firestore/Auth export/import/restore passed. Raw log: `.local/validation/milestone4-final-full.log`.

The existing event wizard and separate admin portal now support reviewed singles/fixed-doubles ladder seasons. The connected vertical slice covers consent, waivers, registration/payment/approval, seed/reference snapshots, private challenges, response/accepted-match deadlines, negotiated schedule/location, common verified score/dispute/correction history, deterministic points/streak/position replay, declines/strikes, weekly inactivity, exemptions/waivers and final freeze/review. Ladder Champion, Points Champion and an optional playoff champion remain separate. Acceptance closes five days before final freeze; invitations preserve the additional 48-hour response period. Fixed consenting pairs lock for the season. Playoffs default off and use existing lineups, score verification, advancement and champion/runner-up persistence when configured.

### Added evidence

- **24 shared ladder tests:** exact win/loss/streak/upset/challenge/defense points, walkover/no-contest behavior, swaps, declines/waivers/strikes, simultaneous inactivity, exemptions, canonical correction replay, duplicate sequence rejection, points-champion tiebreaks, challenge reach/activity/rematch limits, final-window preservation and DST/week boundaries.
- **14 real Firebase ladder cases:** authenticated callable boundary, server-derived seeds/references, roster-lock and client-write denial, wrong-team/club/support/clock/rank/role spoofing, overlapping challenge races and private reads, fixed participants, opposing schedule confirmation, pending zero points, concurrent score confirmation, correction history/replay, system expiry processing, strike waivers, expired/no-show results, inactivity/exemptions, early/rematch/final-cutoff rejection, single final freeze, frozen-season correction denial, pending-result championship review, audited tied Points Champion decision, fixed doubles consent and single optional playoff generation/completion. Existing 66 Firebase cases remain enabled and passed.
- **Two real Chromium journeys:** event wizard/policy review, singles entry or consenting doubles roster, registration/approval, audited calendar update/start, challenge acceptance, proposed/opposing-confirmed time/location, score submission with zero pending points, opposing confirmation, persisted position swap/points after reload and 390px layout. All nine previous complete tournament/player journeys remain enabled and passed.
- Existing lint/types/builds, three browser-shell cases, production manifest/icons/worker/offline test, four legacy tests, actual migration dry-run 3/apply 3/reapply 0 and private Firestore/Auth backup/restore passed. The restore rehearsal validates existing private team fields; ladder persistence is independently asserted in Firebase and browser reload tests.

### Failures found and corrected

The initial focused backend run passed eight cases and timed out in four because a global future `Date.now` test spy affected Firebase/gRPC authentication timing. Business deadlines now use `functions/src/clock.ts`, whose production implementation is the trusted server clock; tests control only that business helper. No browser clock override or network simulation was added. The focused emulator rerun passed all 12 then-existing cases, and the expanded final run passed all 14.

The initial two browser journeys asserted the standings table while the organizer remained on Season rules after starting. Explicit navigation to Standings fixed the harness; all original score, persistence and mobile assertions remain. The focused rerun passed both journeys, and both passed again in the complete gate. No tests were skipped, removed or weakened.

### Files and remaining boundaries

The implementation adds `packages/shared/src/ladder.ts`, `functions/src/ladder.ts`, `functions/src/clock.ts`, `apps/web/src/ladder.tsx` and their unit/Firebase/browser tests. It extends existing event types, shared competition normalization, transactional dispatch, maintenance, roster/score/scheduling components, player/admin routes, Firestore rules/indexes and the complete browser command. API, architecture, schema, rulebook, backlog and reference matrix documentation are current. Legacy `app/`, `lib/`, SQLite and seed remain unchanged.

No production deployment, live payment or real player data was modified. Reference inspection remains R0 because no authorized local APK/XAPK or direct observation was available. Real staging configuration, provider/FCM/Scheduler/recovery validation and physical Safari/device certification remain external prerequisites. TRIACE's proposed 18.5 maximum still needs organizer confirmation. See LADDER.md, IMPLEMENTATION_BACKLOG.md and PRODUCTION_READINESS.md.

## Milestone 3 completed gate

`./pprc.sh test-all` exited **0** on October 24, 2026: **72 shared unit, 66 Firebase integration, nine full browser, three browser-shell, one production PWA and four legacy tests passed**, with no skipped tests. Actual migration dry-run/apply/idempotence and Firestore/Auth export/import/restore passed. Raw log: `.local/validation/milestone3-final-full.log`. Tested implementation commit: `86f1b57002ab3c30088aead34391900731d5f7f4`.

KOC and doubles now use the existing team transaction engine, collections, payments, scheduling, score history and shared standings. KOC policy is explicitly configurable and must be reviewed before publication. Doubles supports fixed consenting pairs, round robin, knockout/byes and group-stage playoffs. TRIACE retains its default three-player/five-rubber/40% policy and pending 18.5 maximum, with additional configurable encounter confirmation, verification and deadlines. Championship results now persist champion and runner-up. Eligibility snapshot details and structured policy controls are integrated into the React screens.

The new 14 shared tests exercise feasible/infeasible policies, authorized assignments, selected-reference bounds/verification, unknown references, short sets, capped points, deciding match tiebreaks, configured standings and participation denominators. Twelve new Firebase cases cover the complete KOC lifecycle, hidden/revealed lineups, opposing confirmation, version/concurrency/disputes, corrected standings, single playoff generation, all three doubles formats, byes, forfeits, verified membership/references, actual deadline enforcement/extension and foreign-club API/rules denial. The original 13 TRIACE/operations cases also passed in a separate focused regression run before the full gate.

Two new browser journeys exercise the event wizard/policy review, four-player invitations including P4 acceptance, registration/approval/check-in, fixtures/scheduling, captain lineups/encounter confirmation, score submission/opponent confirmation, championship/runner-up and mobile layout. Doubles verifies a real deciding third-set match tiebreak and rejects same-pair confirmation. Browser setup initially read invitations/playoffs before asynchronous UI operations finished; explicit persisted-state readiness assertions fixed the harness, retaining every workflow assertion. The existing history heading assertion was updated to the generalized “My team match history”; its TRIACE record checks remain.

Authorization now checks the event club in trusted operations and Firestore reads. Administrative lists use explicit club scopes and declared indexes; foreign membership/profile/resource overwrites are rejected. Support remains read-only. Bulk schedule notices are consolidated per team; finals cannot precede scheduled group fixtures. Complete encounter forfeits also terminate correctly under a normal play-all policy.

See COMPETITIONS.md for supported configuration and limits. No reference package was available, no proprietary rating algorithm was added, and no production deployment/live payment/real-player mutation was performed. Milestone 4 subsequently passed the gate recorded above.

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

Historical Milestone 2 handoff: TRIACE runner-up and KOC/doubles were pending then; the successful Milestone 3 gate above supersedes that status. The completed Milestone 4 evidence above supersedes its earlier pending status. The UTR reference audit remains R0: no authorized local APK/XAPK or direct observation evidence is available.

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
