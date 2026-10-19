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
