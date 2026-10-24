# PPRC Sports Elite implementation backlog

Updated October 24, 2026. Work on `feat/pprc-sports-triace`. Every implementation cycle requires focused checks and a completed successful `./pprc.sh test-all` before commit/completion. Record actual results in INTEGRATION_TEST_REPORT.md.

| Priority / item | State | Completion boundary |
| --- | --- | --- |
| P0 — Preserve/verify existing individual and TRIACE lifecycle | Complete; current feature-branch full gate passed | 48 unit / 35 Firebase / 9 browser-PWA re-established with full gate exit 0 |
| P0 — Scope Storage admin access to PPRC club/event | Implemented and exercised in integration | Owner/PPRC admin allowed; foreign-club role denied |
| P0 — Keep browser tests on local demo config | Implemented; conflicting-env focused checks passed | Tests force emulator bindings and do not reuse an unrelated server |
| P1 — New-player onboarding and secure club membership | **Next implementation cycle** | Auth signup/profile → request → admin review → membership → notification/private-event access; rejection/withdrawal/races/privacy tests |
| P1 — Public club page and opt-in player directory | Planned with membership slice | Search/view public profiles; private profiles excluded; use existing projections and routes |
| P1 — Player performance/history dashboard | Planned | Derived confirmed individual/team results; honest provenance; no proprietary rating calculation |
| P1 — Complete new-player-to-tournament browser journey | Planned with membership | Signup, approve membership, discover/register/pay, confirm/history; preserve team championship suite |
| P2 — Public head-to-head and reference/event leaderboards | Planned | Only readable published results and opt-in reference fields; explicit non-proprietary ranking policy |
| P2 — Mobile bottom navigation and deep-link polish | Planned | Existing routes, accessible 44px targets, admin gating, desktop/mobile browser tests |
| P2 — Doubles tournament entries | Planned | Reuse existing registrations/matches/brackets; partner consent, authorized pair scoring, migration and full lifecycle |
| P2 — Club announcements and analytics | Planned | Published/member audiences, trusted admin writes, notification links, privacy-safe reporting |
| P2 — Ladder competition | Policy needed | Define challenge vs scheduled ranking, movement/ties/expiry; extend existing result infrastructure |
| KOC competition | Configurable design authorized | User requested all competition properties configurable; build on the existing team engine with explicit per-event policy instead of guessing fixed KOC rules |
| UTR reference inspection | Blocked on package/evidence | No package/tools supplied; do not invent reference behavior or copy proprietary material |
| Real Firebase staging/providers | Blocked on config and approval | Proposed project multiclub-890ea; configure isolated staging, web app, test Stripe, FCM, Scheduler and backup/recovery |

The broader platform request is a continuing backlog, not a claim that every domain is production-ready. Each completed slice must include UI, trusted persistence, authorization, negative scenarios, real browser coverage and a successful final full gate. The single PPRC club remains the current tenancy boundary; multi-club onboarding needs a separately reviewed migration/security design.
