# API and Functions

All public operations except the Stripe webhook are Firebase callable functions in `us-central1`. Authentication is mandatory. Each mutation includes a UUID `requestId`. Event operations also include `eventId`. Responses use Firebase callable result envelopes. Validation errors return `invalid-argument` or `failed-precondition`; authorization errors are `permission-denied`.

| Function                  | Payload beyond requestId/eventId                         | Access / behavior                                                                                            |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| createEvent               | event, divisions[]; omit eventId                         | Club admin or event admin; creates draft and assigns creator                                                 |
| updateEvent               | event patch, optional divisions[]                        | Assigned admin; division replacement prohibited after entries                                                |
| publishEvent              | —                                                        | Assigned admin; validates dates/divisions                                                                    |
| registerForDivision       | divisionId, waiver, answers, optional waiverPath         | Player; profile, eligibility, capacity, waiver, rate limit                                                   |
| cancelRegistration        | registrationId, reason                                   | Owner or assigned admin; promotes waitlist                                                                   |
| promoteWaitlist           | —                                                        | Assigned admin; oldest eligible entries first                                                                |
| startCheckout             | registrationId                                           | Owner; returns development/paymentId or Stripe URL                                                           |
| confirmDevelopmentPayment | paymentId                                                | Owner; Functions emulator only                                                                               |
| refundPayment             | paymentId, reason                                        | Assigned admin; cancelled/withdrawn paid registration                                                        |
| approveRegistration       | registrationId, seed, reason for changes                 | Assigned admin; paid/free entry only                                                                         |
| rejectRegistration        | registrationId, reason                                   | Assigned admin                                                                                               |
| generateDraw              | divisionId                                               | Assigned admin; approved/seeded unique players                                                               |
| publishDraw               | drawId, published boolean                                | Assigned admin; notify participants                                                                          |
| generateSchedule          | optional ISO start                                       | Assigned admin; event hours/courts/blackouts                                                                 |
| rescheduleMatch           | matchId, courtId, scheduledAt ISO, reason                | Assigned admin; conflict/dependency checks                                                                   |
| checkInPlayer             | registrationId, status                                   | Assigned admin; approved entries                                                                             |
| submitScore               | matchId, version, score, finalize boolean                | Participant or assigned admin; only admin may finalize directly                                              |
| requestScoreCorrection    | resultId, reason                                         | Participant or assigned admin                                                                                |
| finalizeScore             | resultId                                                 | Opponent (not submitter) or assigned admin                                                                   |
| updateRoundRobinStandings | divisionId                                               | Assigned admin; recompute and qualify playoffs if possible                                                   |
| exportEventReport         | kind: registrations/results/payments                     | Assigned admin; returns csv and filename                                                                     |
| createEventTemplate       | —                                                        | Club admin; saves current event/divisions                                                                    |
| applyAdminOverride        | kind + relevant fields, reason                           | Assigned admin; status, score reopening, standings, reporting or emulator refund; rating requires club admin |
| saveProfile               | profile                                                  | Owner; validates and updates opt-in public projection                                                        |
| requestAccountDeletion    | —                                                        | Owner; creates request and flags profile                                                                     |
| manageClub                | target court/venue/membership/template/rating + fields, reason | Club admin; roles, venues, courts, membership flags, templates, verified reference                                   |
| registerPushToken         | token                                                    | Owner; token stored server-side                                                                              |

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

## TRIACE configuration

Every TRIACE property is a rule stored on the event and division (`backend/app/triace_rules.py`, camelCase keys). Division values override event values; unset values use the defaults from `GET /v1/triace/defaults`. `GET /v1/divisions/{id}/triace-rules` returns the effective configuration.

| Key | Default | Meaning |
| --- | --- | --- |
| `teamSize` | 3 | Players per team (2–6). Locked once teams register |
| `singlesMatches` / `doublesMatches` / `superTiebreakMatches` | 2 / 2 / 1 | Matches per encounter; the total must be odd (no ties) |
| `superTiebreakPoints` | 10 | Points the super-tiebreak winner must reach (5–21) |
| `singlesPositions` | [1, 2, 3] | Lineup positions allowed to play singles |
| `doublesPairs` | [[1,3],[2,3]] | Lineup position pairs allowed in doubles |
| `teamMinRating` / `teamMaxRating` | 12 / 18.5 | Combined UTR range (≤ teamSize × playerMaxRating) |
| `playerMaxRating` | 20 | Highest UTR allowed for one player |
| `minSinglesParticipationPct` | 0.4 | Share of match days each player must play singles to be playoff eligible, rounded down (8 match days → 3) |
| `playoffSize` | 0 | Teams in the playoffs: 2, 3 or 4. `0` is automatic (official rule): top 4 above 7 teams, otherwise top 3 (2nd v 3rd in an eliminator, winner meets 1st in the final) |
| `tiers` | [] | Combined-rating tiers `{id, name, minRating, maxRating, order, active}` (up to 20, order 1 is highest, both ends inclusive). Empty uses only the `teamMinRating`/`teamMaxRating` window. `GET /v1/triace/defaults` returns the Triace 2.0 preset as `officialTiers` (GOAT 17.50–22.00, Rising 11.50–17.00) |
| `challengeEnabled` | false | Provisional challenge rule: a team in `challengeChallengerPositions` (5, 6) may challenge one in `challengeTargetPositions` (2, 3, 4) once, before the last `challengeCutoffWeeks` (3) weeks, if it has no overdue fixtures. A win swaps their table positions |
| `playoffSize` | 4 | 2 (final only) or 4 (semifinals + final); can be overridden per bracket |
| `pointsPerWin` / `pointsPerLoss` | 3 / 0 | Standings points |
| `requireRubbersInRegularSeason` | false | Require match-by-match scores before regular-season results count (always required in playoffs) |

Scoring rules (`singles*`, `doubles*`, `superTiebreak*`, `points*`) cannot change once results exist; `teamSize` cannot change once teams have registered. Both return 409 with the offending keys.


### Tiers, three-team playoffs and challenges

- `POST /v1/clubs/{id}/teams` accepts `selected_tier` (a tier id, `higher` — the default, highest eligible — or `both`). A team may enter its own tier or a lower one; `both` lists a top-tier team in the top two tiers. Teams outside every active band are refused. Placement is stored on the team (`selectedTier`, `assignedTier`, `listedTiers`).
- `GET /v1/divisions/{id}/tiers` lists teams with their placement; `POST /v1/divisions/{id}/tiers/recalculate` (organizer) re-places every team after the bands or ratings change and returns `{reviewed, moved, unchanged, unassigned}`.
- `POST /v1/divisions/{id}/playoffs/generate` without `size` follows `playoffSize`. A three-team bracket creates a `playoff_eliminator` fixture (2nd v 3rd); finalizing it creates the `playoff_final` against 1st.
- `POST /v1/divisions/{id}/challenges` creates a `challenge` fixture. Challenge fixtures do not count in the regular-season table; when the challenger wins, the two teams' table positions are swapped in the playoff seeding (`/playoff-seeds`). Swaps are applied to the final regular-season order, oldest challenge first.

### Registration, privacy and exports

- `requireConsent` (default false): team registration must send `consent` and `rules_accepted` as true. Both flags are stored on the team.
- `aceNameMaskingEnabled` (default true): `GET /v1/public/divisions/{id}/tiers` (no sign-in; only published, closed or completed events) lists approved teams per tier with a captain first name, player ratings and combined rating. Account ids never appear. Other players' names are included only when masking is off **and** the team consented.
- `GET /v1/divisions/{id}/teams.csv` (organizer): every player name plus placement and consent flags; cells starting with `=`, `+`, `-` or `@` get an apostrophe prefix so spreadsheets do not run them.
- `client_id` on `POST /v1/clubs/{id}/teams` makes retries idempotent: the same owner and payload returns the same team; any other use of the id is a 409.
- `PATCH /v1/events/{id}` accepts `expected_revision`. Rule saves bump `rules.configRevision`; a stale revision is a 409 ("Configuration changed in another session"). A tier that still has teams cannot be removed: deactivate it, save, recalculate, then remove it.
- Registration open/close is the event status: `published` accepts team registration, `closed` does not (the admin "Open/Close registration" buttons).
- The web registration page shows the nine rule cards first (generated from the division's rules); the accept button unlocks after every card has been viewed.
