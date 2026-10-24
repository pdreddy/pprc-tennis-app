# PPRC Sports Elite implementation backlog

Updated October 24, 2026. Work on `feat/pprc-sports-triace`. Every implementation cycle requires focused checks and a completed successful `./pprc.sh test-all` before commit/completion. Record actual results in INTEGRATION_TEST_REPORT.md.

| Priority / item | State | Completion boundary |
| --- | --- | --- |
| P0 — Preserve/verify existing individual and TRIACE lifecycle | Complete; current feature-branch full gate passed | 72 unit / 66 Firebase / 13 browser-PWA re-established with full gate exit 0 |
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
| P2 — Ladder competition | Milestone 4 in progress — rules confirmed; shared team engine ready | User-defined points/challenges/movement/deadlines; fixed consenting pairs; acceptance closes five days before freeze; playoffs off unless configured |
| KOC competition | Complete — configurable PPRC policy; full gate passed | Structured policy UI, server validation, 1–8-player rosters, shared fixtures/lineups/confirmation/scoring/standings/playoffs; no claim of a verified external KOC rulebook |
| UTR reference inspection | Blocked on package/evidence | No package/tools supplied; do not invent reference behavior or copy proprietary material |
| Real Firebase staging/providers | Blocked on config and approval | Proposed project multiclub-890ea; configure isolated staging, web app, test Stripe, FCM, Scheduler and backup/recovery |

The broader platform request is a continuing backlog, not a claim that every domain is production-ready. Each completed slice must include UI, trusted persistence, authorization, negative scenarios, real browser coverage and a successful final full gate. The single PPRC club remains the current tenancy boundary; multi-club onboarding needs a separately reviewed migration/security design.

## Incoming Milestone 3

Finish and validate Milestone 2 before declaring it complete. Re-establish the current full gate before changing the competition engine. Verify existing TRIACE, add explicit encounter-confirmation evidence and runner-up declaration, then extend the same team engine for configurable KOC and doubles round robin/knockout/groups. Preserve all prior lifecycle, security, dispute, forfeit, concurrency and persistence tests; run `./pprc.sh test-all` after each completed cycle. No production or live-payment changes.

## Milestone 2 evidence

Full command `./pprc.sh test-all` exited 0 on October 24, 2026: 58 shared tests, 54 Firebase integration tests, seven flow browser tests, three shell browser tests, one production PWA test, four legacy tests, actual migration and backup/restore. The final source revision is recorded in the integration report. New routes include `/clubs/pprc`, `/players`, `/players/:playerId`, `/rankings` and the owner-only `/dashboard`. Profiles, external references and existing match history remain integrated; no proprietary rating calculation was added. See PLAYERS.md.

## Milestone 3 evidence

Full gate exited 0: 72 shared, 66 Firebase, nine flow browser, three shell browser, one PWA and four legacy tests; migration and backup/restore passed. TRIACE runner-up and configurable confirmation/deadlines are implemented. KOC and doubles reuse the same competition engine; see COMPETITIONS.md and INTEGRATION_TEST_REPORT.md. Continue directly with the Milestone 4 ladder, using the confirmed policy in LADDER.md.
