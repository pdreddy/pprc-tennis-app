# API and Functions

## TRIACE callable

`triace({ requestId, eventId, action, ...payload })` is authenticated and dispatches inside the existing transaction engine. Permissions come from trusted membership/event assignment or the persisted team captain/roster. Retry the same UUID with an identical payload for idempotency; changing it under the same UUID is rejected. Actors are rate-limited. Client writes to team/sporting/snapshot/dispute/audit documents are denied.

| Action               | Main payload                                                 | Authorization / effects                                                       |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| configure            | rules, reason                                                | Assigned organizer; locked after registration                                 |
| createTeam           | name, waiver                                                 | Player with profile; one accepted team per event                              |
| invitePlayer         | teamId, playerId, slot                                       | Captain; P2/P3; profile UID required                                          |
| respondInvitation    | invitationId, accepted, waiver                               | Invited player only; no double enrollment                                     |
| revokeInvitation     | invitationId                                                 | Captain; pending unlocked roster invitation only                              |
| registerTeam         | teamId, divisionId, answers                                  | Captain; all consent/references; existing capacity/payment/waitlist           |
| approveTeam          | teamId, seed, reason                                         | Assigned organizer; paid/free; locks after fixtures                           |
| assignGroups         | optional groups: [{teamIds}], reason on reassignment         | Assigned organizer; all approved teams exactly once; editable before fixtures |
| generateFixtures     | —                                                            | Assigned organizer; valid groups, one generation                              |
| submitLineup         | encounterId, teamId, lineup                                  | Captain; singles[], doubles: [{players}], tiebreak[]; roster/policy checks    |
| submitRubberScore    | rubberId, baseVersion, score, optional admin finalize/reason | Captain or assigned rubber player; version/score/dispute checks               |
| confirmRubberScore   | resultId, reason for organizer                               | Opposing assigned player/captain or organizer; advances aggregates/bracket    |
| disputeRubber        | resultId, reason                                             | Encounter participant or organizer                                            |
| resolveDispute       | disputeId, resolution, reason, score for correction          | Assigned organizer; preserves prior result version and downstream locks       |
| resolveTeamTies      | groupId, teamIds ordered, reason                             | Assigned organizer; no existing playoffs                                      |
| generateTeamPlayoffs | —                                                            | Assigned organizer; final groups, resolved ties/disputes, participation       |
| generateTeamSchedule | —                                                            | Assigned organizer; active courts, daily windows, team/court/feeder conflicts |
| scheduleEncounter    | encounterId, scheduledAt, courtId, reason                    | Assigned organizer; same conflict checks                                      |
| withdrawTeam         | teamId, reason                                               | Captain before fixtures; organizer after remaining forfeits/finals            |
| forfeitEncounter     | encounterId, winner, reason                                  | Assigned organizer; reasoned 3–0 without invented points                      |
| exportTeamReport     | —                                                            | Assigned organizer; spreadsheet-safe CSV                                      |

Existing `checkInPlayer` supports an approved captain/team registration. Existing Checkout, refund, waitlist and reporting endpoints continue using that registration. `manageClub` adds audited club details and separate singles/doubles verification values. See TRIACE.md and SCHEMA_MIGRATIONS.md for policy and read scopes.

All public operations except the Stripe webhook are Firebase callable functions in `us-central1`. Authentication is mandatory. Each mutation includes a UUID `requestId`. Event operations also include `eventId`. Responses use Firebase callable result envelopes. Validation errors return `invalid-argument` or `failed-precondition`; authorization errors are `permission-denied`.

| Function                  | Payload beyond requestId/eventId                               | Access / behavior                                                                                            |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| createEvent               | event, divisions[]; omit eventId                               | Club admin or event admin; creates draft and assigns creator                                                 |
| updateEvent               | event patch, optional divisions[]                              | Assigned admin; division replacement prohibited after entries                                                |
| publishEvent              | —                                                              | Assigned admin; validates dates/divisions                                                                    |
| registerForDivision       | divisionId, waiver, answers, optional waiverPath               | Player; profile, eligibility, capacity, waiver, rate limit                                                   |
| cancelRegistration        | registrationId, reason                                         | Owner or assigned admin; promotes waitlist                                                                   |
| promoteWaitlist           | —                                                              | Assigned admin; oldest eligible entries first                                                                |
| startCheckout             | registrationId                                                 | Owner; returns development/paymentId or Stripe URL                                                           |
| confirmDevelopmentPayment | paymentId                                                      | Owner; Functions emulator only                                                                               |
| refundPayment             | paymentId, reason                                              | Assigned admin; cancelled/withdrawn paid registration                                                        |
| approveRegistration       | registrationId, seed, reason for changes                       | Assigned admin; paid/free entry only                                                                         |
| rejectRegistration        | registrationId, reason                                         | Assigned admin                                                                                               |
| generateDraw              | divisionId                                                     | Assigned admin; approved/seeded unique players                                                               |
| publishDraw               | drawId, published boolean                                      | Assigned admin; notify participants                                                                          |
| generateSchedule          | optional ISO start                                             | Assigned admin; event hours/courts/blackouts                                                                 |
| rescheduleMatch           | matchId, courtId, scheduledAt ISO, reason                      | Assigned admin; conflict/dependency checks                                                                   |
| checkInPlayer             | registrationId, status                                         | Assigned admin; approved entries                                                                             |
| submitScore               | matchId, version, score, finalize boolean                      | Participant or assigned admin; only admin may finalize directly                                              |
| requestScoreCorrection    | resultId, reason                                               | Participant or assigned admin                                                                                |
| finalizeScore             | resultId                                                       | Opponent (not submitter) or assigned admin                                                                   |
| updateRoundRobinStandings | divisionId                                                     | Assigned admin; recompute and qualify playoffs if possible                                                   |
| exportEventReport         | kind: registrations/results/payments                           | Assigned admin; returns csv and filename                                                                     |
| createEventTemplate       | —                                                              | Club admin; saves current event/divisions                                                                    |
| applyAdminOverride        | kind + relevant fields, reason                                 | Assigned admin; status, score reopening, standings, reporting or emulator refund; rating requires club admin |
| saveProfile               | profile                                                        | Owner; validates and updates opt-in public projection                                                        |
| requestAccountDeletion    | —                                                              | Owner; creates request and flags profile                                                                     |
| manageClub                | target court/venue/membership/template/rating + fields, reason | Club admin; roles, venues, courts, membership flags, templates, verified reference                           |
| registerPushToken         | token                                                          | Owner; token stored server-side                                                                              |

## Score shape

```json
{
  "winner": "player1",
  "outcome": "played",
  "sets": [
    { "a": 6, "b": 4 },
    { "a": 3, "b": 6 },
    { "a": 10, "b": 8, "matchTiebreak": true }
  ],
  "notes": ""
}
```

Outcomes: played, retirement, walkover, default. Walkover/default has no sets and requires notes. A 7–6 set requires both `tiebreakA` and `tiebreakB`. A match tiebreak is legal only as a third set when one set each has been won. No points are automatically submitted to any external ratings service.

## Overrides

- status: `status` (Registration Open/Closed, Check-In, In Progress, Completed, Cancelled)
- score: `resultId`; correction must first have been requested
- standings: `drawId`, `resolutions` mapping player IDs to unique positive places
- reporting: `resultId`, `status` (Not Required/Pending/Submitted/Confirmed)
- rating: `playerId`, `rating`; club admin only
- refund: `paymentId`; development payments only; production uses refundPayment

## Hosted endpoints and background work

`stripeWebhook` accepts POST with Stripe's signature header and the unmodified raw body. Subscribe to checkout.session.completed and checkout.session.async_payment_succeeded. Internal payment-recording and reservation-expiration operations have no exported callable.

`eventMaintenance` runs every five minutes for publication/deadline transitions, expired reservations and match reminders. `deliverPush` handles newly created notifications. Scheduler/FCM are managed production services; the local test suite invokes domain operations rather than waiting for Cloud Scheduler.

The backend does not expose public HTTP exports or role-mutating endpoints without auth. Public discovery uses Firestore rules, not an unauthenticated administrative API.


## Ladder callable

`ladder({requestId, eventId, action, ...payload})` uses the same authenticated transaction engine, trusted club/assignment roles, hashed idempotency receipts and immutable audits. Strict action payloads reject browser-supplied clock, points or role overrides.

- Assigned organizer: `configure(rules,reason)`, `start`, `close`, `reopen(reason)`, `generatePlayoffs`, `decidePointsChampion(teamId,reason)`.
- Entrant captain: `challenge(teamId,opponentId)`, `respond(challengeId,accepted,reason?)`, `proposeSchedule(challengeId,teamId,scheduledAt,location)`, `confirmSchedule(challengeId,teamId)` by the opposite entrant.
- Organizer exceptions: `waiveDecline`, `waiveStrike`, `waiveInactivity` with ledgerId/teamId/reason; `exemption(teamId,fromWeek,throughWeek,reason)`; `walkoverMovement(challengeId,approved,reason)`; `cancelChallenge(challengeId,reason)`.
- `tick` processes due server-clock actions; scheduled maintenance invokes the same handler as a trusted system operation. No public clock-control endpoint exists.

Registration/consent, playoff lineups, score submission/opponent confirmation, disputes, corrections and forfeits continue through `teamCompetition` (legacy `triace` alias remains). Ladder guards prevent roster changes after start, common fixture-generation bypasses, repeated advancement and frozen-season edits. See LADDER.md for persistence and sporting policy.
