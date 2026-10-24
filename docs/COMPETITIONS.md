# Configurable team competitions

TRIACE, KOC and doubles use the existing Events app, Firestore collections, transactional command engine, payments, scheduling, score versions and audit history. `teamCompetition` is an authenticated alias for the shared team handler; existing `triace` clients remain compatible. No second tournament backend is introduced.

## Organizer policy

TRIACE retains exactly three players, P1/P2/P3, two singles, two doubles and the ten-point deciding rubber. First to three wins. The supplied 18.5 maximum remains explicitly pending confirmation. Singles participation defaults to 40% of completed group encounters, with the alternative denominator and lineup/participation choices still configurable. Deadlines, explicit captain confirmation, verified-reference requirements and club membership can now also be selected.

KOC has no verified external rulebook in this workspace. Its draft preset is an editable PPRC proposal: four players, two singles and one doubles rubber. The organizer must review and confirm the actual event policy before publication. It is not presented as an observed reference-app format.

Doubles uses exactly two consenting players and one doubles rubber. The organizer chooses round robin, knockout, or groups followed by playoffs. Both partners accept invitations; the pair cannot be changed after registration. Fees and capacity apply per team.

The structured Rules form and validated backend policy support:

| Area | Supported choices |
| --- | --- |
| Roster and rubbers | KOC roster 1–8; up to four singles and four doubles plus an optional decider; odd total, majority required to win |
| Assignments | Distinct singles/pairs, permitted roster-slot combinations, maximum appearances, one/two deciding players |
| Scoring | One set or best of three; configurable set target/tiebreak; optional deciding third-set match tiebreak; points-only games, target/winning margin/cap; stop at clinch or play all |
| On-court policy | No-ad setting is published; score entry records completed set/points-game totals rather than individual service points |
| References | Higher/singles/doubles metric; combined bounds; required/admin-verified references; membership; division age/gender/per-player bounds |
| Unrated entries | Only when reference and verification requirements and combined bounds are disabled; unknown values remain null |
| Stages | Round robin, knockout with byes, groups and 2/4/8 playoff qualifiers |
| Standings | Ordered encounter wins, rubber difference and tied-cohort head-to-head; unresolved sporting ties require a reasoned organizer order |
| Deadlines | Event registration window, lineup cutoff before scheduled play, score entry window, audited score deadline extension |
| Confirmation | Both submitted lineups imply encounter confirmation, or both captains explicitly confirm revealed lineups |

Operational limits remain 16 teams per event and eight teams per group. Choose enough groups for the field. Rules lock after registration. Unsupported/infeasible combinations fail validation instead of silently falling back to another format. Tournament-specific rules stay separate from shared scheduling/scoring/standings.

## Complete workflow

Create a draft in the existing event wizard. Choose a competition and stages, fees, capacity, courts and dates. Review the Rules tab and confirm policy before publishing KOC/doubles. Captains create a team and invite the required slots; each player accepts the public approved-roster disclosure and any sporting waiver. Registration captures server-read reference snapshots with source and date. Browser-supplied eligibility values are ignored. Existing payment/waitlist services operate the team entry.

Assigned organizers approve/seed entries and check in teams. Groups use common round-robin fixtures; knockout fixtures are generated directly. Court assignment respects event windows, playing hours, blackouts, team conflicts and predecessors. Bulk schedule notifications are consolidated per team.

Captains submit roster-authorized lineups. The opponent cannot read a hidden lineup before both submit. When explicit confirmation is enabled, scores remain locked until both captains confirm. Captains/assigned players submit a rubber score; the opposing team confirms, or the organizer confirms with an audit reason. Same-team confirmation and duplicate finalization are rejected.

Disputes retain the original score. Corrections supersede old versions and recompute encounter totals and standings. Group qualification locks once playoffs exist; downstream started lineups/results protect feeder corrections. Forfeits record reasons without fabricated points. A whole-encounter forfeit finishes even under a normal play-all policy.

Round robin declares champion and runner-up after all results and title-relevant ties/disputes resolve. Group playoffs and knockout use the shared semifinal/final advancement engine. Final confirmation persists both champion and runner-up. Eligible corrections can reopen and recompute the result; earlier versions remain audited.

## Security and evidence

Club/assigned-organizer privileges are scoped to the event's club, in both trusted commands and Firestore reads. Foreign memberships/profiles/resources cannot be overwritten by a PPRC administrator. Client writes to rosters, snapshots, lineups, results and audits remain denied. All validation uses synthetic emulator data; no production deployment or live payments are authorized.

Focused evidence and the mandatory full-gate result are recorded in `INTEGRATION_TEST_REPORT.md`. A requested milestone or a passing focused subset alone does not establish full completion.
