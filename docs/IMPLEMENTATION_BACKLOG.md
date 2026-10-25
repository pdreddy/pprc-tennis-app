# PPRC Sports Elite implementation backlog

Updated October 24, 2026. Work on `feat/pprc-sports-triace`. Every implementation cycle requires focused checks and a completed successful `./pprc.sh test-all` before commit/completion. Record actual results in INTEGRATION_TEST_REPORT.md.

| Priority / item | State | Completion boundary |
| --- | --- | --- |
| P0 — Preserve/verify existing individual and TRIACE lifecycle | Complete; current feature-branch full gate passed | 96 unit / 80 Firebase / 15 browser-PWA re-established with full gate exit 0 |
| P0 — Scope Storage admin access to PPRC club/event | Implemented and exercised in integration | Owner/PPRC admin allowed; foreign-club role denied |
| P0 — Keep browser tests on local demo config | Implemented; conflicting-env focused checks passed | Tests force emulator bindings and do not reuse an unrelated server |
| P1 — New-player onboarding and secure club membership | Complete — full gate passed | Auth signup/profile → request → admin review → membership → notification/private-event access; rejection/withdrawal/races/privacy tests |
| P1 — Public club page and opt-in player directory | Complete — full gate passed | Search/view public profiles; private profiles excluded; use existing projections and routes |
| P1 — Player performance/history dashboard | Complete — full gate passed | Derived confirmed individual/team results; honest provenance; no proprietary rating calculation |
| P1 — Complete new-player-to-tournament browser journey | Complete — new-player browser workflow passed | Signup, approve membership, discover/register/pay, confirm/history; preserve team championship suite |
| P2 — Public head-to-head and reference/event leaderboards | Reference leaderboard complete; H2H/event rankings remain planned | Only readable published results and opt-in reference fields; explicit non-proprietary ranking policy |
| P2 — Mobile bottom navigation and deep-link polish | Complete — full gate passed | Existing routes, accessible 44px targets, admin gating, desktop/mobile browser tests |
| P2 — Doubles tournament entries | Complete — Milestone 3 full gate passed | Fixed consenting pairs; round robin, knockout/byes and group-stage playoffs; shared scoring, corrections and championship |
| P2 — Club announcements and analytics | Planned | Published/member audiences, trusted admin writes, notification links, privacy-safe reporting |
| P2 — Ladder competition | Complete — Milestone 4 full gate passed | Singles/fixed consenting doubles; trusted challenges/deadlines, verified result replay, points/position/strike/inactivity rules, audited exceptions, separate season champions and optional playoffs |
| KOC competition | Complete — configurable PPRC policy; full gate passed | Structured policy UI, server validation, 1–8-player rosters, shared fixtures/lineups/confirmation/scoring/standings/playoffs; no claim of a verified external KOC rulebook |
| UTR reference inspection | Blocked on package/evidence | No package/tools supplied; do not invent reference behavior or copy proprietary material |
| Real Firebase staging/providers | Blocked on config and approval | Proposed project multiclub-890ea; configure isolated staging, web app, test Stripe, FCM, Scheduler and backup/recovery |

The broader platform request is a continuing backlog, not a claim that every domain is production-ready. Each completed slice must include UI, trusted persistence, authorization, negative scenarios, real browser coverage and a successful final full gate. The single PPRC club remains the current tenancy boundary; multi-club onboarding needs a separately reviewed migration/security design.

## Incoming Milestone 3

Finish and validate Milestone 2 before declaring it complete. Re-establish the current full gate before changing the competition engine. Verify existing TRIACE, add explicit encounter-confirmation evidence and runner-up declaration, then extend the same team engine for configurable KOC and doubles round robin/knockout/groups. Preserve all prior lifecycle, security, dispute, forfeit, concurrency and persistence tests; run `./pprc.sh test-all` after each completed cycle. No production or live-payment changes.

## Milestone 2 evidence

Full command `./pprc.sh test-all` exited 0 on October 24, 2026: 58 shared tests, 54 Firebase integration tests, seven flow browser tests, three shell browser tests, one production PWA test, four legacy tests, actual migration and backup/restore. The final source revision is recorded in the integration report. New routes include `/clubs/pprc`, `/players`, `/players/:playerId`, `/rankings` and the owner-only `/dashboard`. Profiles, external references and existing match history remain integrated; no proprietary rating calculation was added. See PLAYERS.md.

## Milestone 3 evidence

Full gate exited 0: 72 shared, 66 Firebase, nine flow browser, three shell browser, one PWA and four legacy tests; migration and backup/restore passed. TRIACE runner-up and configurable confirmation/deadlines are implemented. KOC and doubles reuse the same competition engine; see COMPETITIONS.md and INTEGRATION_TEST_REPORT.md. Milestone 4 extends this engine with the confirmed ladder policy in LADDER.md.


## Milestone 4 evidence and next tasks

`./pprc.sh test-all` exited 0 on October 24, 2026: 96 shared unit, 80 Firebase integration (nine files), 11 complete browser flows, three browser-shell, one production PWA and four legacy tests. No skipped cases. Actual migration dry/apply/idempotence and Firestore/Auth backup/restore passed. Raw log: `.local/validation/milestone4-final-full.log`.

The ladder is a complete additive vertical slice: event creation/policy/calendar, consent/registration/approval, initial snapshot/seed, private challenge/response/schedule negotiation, existing verified score/dispute history, deterministic standings replay, declines/strikes/weekly inactivity, waivers/exemptions, final freeze/review, separate ladder and points champions and explicitly enabled shared playoffs. Fourteen real Firebase ladder cases and two full mobile-aware Chromium journeys were added; all prior workflows remain enabled.

Next: isolated staging/provider/Scheduler/recovery verification after required configuration and deployment approval; authorized reference-package audit when a package is available; public H2H/event leaderboards, club announcements and remaining player-experience backlog. The TRIACE 18.5 maximum remains pending organizer confirmation. No production deployment, live payment or real-player import was performed.

## Milestone 5 evidence (slice 1)

Court maintenance blocks are implemented and enforced by fixture generation, rescheduling and TRIACE/team scheduling, with audited club-admin management and a Courts admin panel. `./pprc.sh test-all` exited 0 on October 25, 2026 at implementation commit `884de66`: 102 shared, 84 Firebase integration, 13 browser, three shell, one PWA and four legacy tests. See COURT_MANAGEMENT.md and INTEGRATION_TEST_REPORT.md.

Remaining Milestone 5 work: player availability, rescheduling requests, notification center and preferences, organizer reminders, organizer operations dashboard, calendar/ICS, and their emulator and browser tests.

## Milestone 6 Phase 0 status

- Baseline: `./pprc.sh test-all` exited 0 at commit `884de66` (the implementation tree of Milestone 5 slice 1). Results are in INTEGRATION_TEST_REPORT.md.
- Milestones 1–5: only the court-block slice of Milestone 5 is implemented. Player availability, rescheduling requests, notification center, reminders, organizer dashboard and calendar/ICS remain open.
- Reference audit: static evidence from the supplied XAPK's manifest and resource names only (see MOBILE_UX_REFERENCE_AUDIT.md). No runtime behavior has been observed.
- Not started: the design system, mobile navigation, player dashboard, discovery, profile, match center, rankings, team/captain, notification UX, PWA review, and the Playwright scenarios in Phase 14.

## Milestone 6 slice 1 — mobile navigation

Bottom navigation has five primary destinations (Home, Tournaments, Matches, Rankings, Profile) with active-state and accessible labels. Teams and Club are reached from Profile. `./pprc.sh test-all` exited 0 at commit `52697fd`: 102 shared, 84 Firebase, 15 browser, three shell, one PWA and four legacy tests. See INTEGRATION_TEST_REPORT.md.

