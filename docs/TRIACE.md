# TRIACE 2.0 operations

TRIACE extends the existing Events app and transaction engine. There is no second frontend, database, or tournament service. Individual tournaments and the legacy Next.js/SQLite prototype remain independent.

## Rules and policy decisions

| Setting                     | Default                                               | Administration                                                                                                     |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Roster                      | Three confirmed players, P1/P2/P3                     | Captain creates P1 and invites P2/P3; players accept individually                                                  |
| Combined reference          | 12 through 18.5 inclusive                             | Sum of each player's higher singles/doubles reference; maximum explicitly pending policy confirmation              |
| Missing separate references | Existing external reference supplies both             | Missing/non-finite references are rejected at registration                                                         |
| Rubbers                     | Two singles, two doubles, one super tiebreak          | Singles/doubles use one set or best of three, configurable                                                         |
| Encounter winner            | First to three rubber wins                            | Stop at clinch or play all five, configurable                                                                      |
| Decider                     | Ten points, win by two                                | One or two players per side, configurable; follows the four preceding rubbers                                      |
| Lineups                     | Distinct singles players and doubles pairs            | Allowed P1/P2/P3 combinations and distinctness are configurable                                                    |
| Participation               | At least 40% of completed group encounters in singles | Alternative singles-opportunity denominator, threshold, forfeit policy and all-roster requirement are configurable |
| Qualification               | Two groups, two qualifiers per group                  | Supports 2/4/8 qualifiers; wins, rubber difference, explicit organizer tie resolution                              |

The default participation denominator is **completed team group encounters**, not the total singles slots. With three players, a 40% share of all singles slots cannot be achieved by every player; the alternative denominator therefore needs a compatible threshold/all-roster policy. Administrators must review the rulebook before publishing. Policy changes lock after registration. A snapshot of the qualification rules and measured participation is retained when playoffs are generated.

External references are not a PPRC rating calculation or a proprietary UTR algorithm. Changes to player profiles do not rewrite registration snapshots. Admin verification is audited; changing a reference invalidates its previous verification.

## Complete rehearsal

1. Run `./pprc.sh setup`, `./pprc.sh start`, and `./pprc.sh seed`. Use the credentials in README only with the demo emulators.
2. Open the seeded TRIACE Champions Cup from Explore events. Sign in as a player, create a team, then invite two player UIDs. UIDs are shown on profiles. Pending invitations can be revoked; players can accept or decline under My teams. Acceptance records waiver consent and explains public roster disclosure.
3. After three confirmations, register the team. Existing registration/payment/waitlist services handle the captain's entry. Paid events require payment before organizer approval.
4. In the admin event workspace, review registrations and reference snapshots, approve/seed teams, and record team check-in. Assigned organizers can operate their event; unassigned organizers and support cannot mutate it.
5. Assign groups, generate fixtures, and generate or adjust the court schedule. Group assignment supports balanced seeding or explicit assignment through the callable. Resolve all pending registrations first. Groups/seeding may be revised with an audit reason before fixtures; reassign groups after registration or withdrawal changes.
6. Both captains submit authorized lineups for each encounter. Each lineup is locked and private until both are submitted. Scores are accepted only for the resulting rubbers. Confirm a pending score or resolve its dispute before submitting another rubber in that encounter.
7. A captain or assigned player submits a legal rubber score. The opposing side confirms; organizers can confirm with an audit reason. Exceptional outcomes require reasons and do not invent points. After three wins, unused rubbers are marked not required when stop-at-clinch is enabled.
8. Review group standings and participation. Resolve sporting ties explicitly. Generate playoffs only after every group encounter and dispute is final and qualifying rosters satisfy participation. Play semifinals and final through the same lineup/score workflow. Final confirmation automatically records the champion and completes the event.
9. Review player schedule/history, in-app notifications, team CSV report, versioned results and immutable audit records. The complete integration/browser rehearsal performs this without manually editing tournament documents.

For six teams in two groups of three, each team has two encounters: use P1/P2 then P2/P3 in singles so all players reach at least 50%. For eight teams in two groups of four, rotate P1/P2, P1/P3, P2/P3 so each player plays singles twice in three encounters.

## Corrections, withdrawal and boundaries

Players can dispute submitted or final rubbers. Organizers uphold or correct with a reason; corrected records supersede rather than erase earlier versions. Group changes lock after playoff creation. A playoff feeder cannot change once its downstream lineup/results have started. Correcting an eligible final can reopen the event and recompute the champion.

Captains may withdraw before fixtures. After fixtures, organizers must record remaining encounter forfeits before marking the team withdrawn. Withdrawn teams are skipped during qualification; insufficient remaining qualifiers require organizer resolution. Completed events reject withdrawal. Refunds remain an explicitly reviewed financial action.

This release operates the existing single `pprc` club per deployment. It does not implement multi-club tenant onboarding, roster substitutions after registration, lineup reopening after submission, automatic dispute arbitration, or a global scheduling optimizer. Limits are 16 teams per event and eight teams per group. Load-test larger operational volumes before expanding these limits. Browser coverage uses Chromium at an iPhone-sized viewport, not a physical iPhone/Safari certification.
