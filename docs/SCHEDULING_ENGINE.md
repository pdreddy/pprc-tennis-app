# Scheduling engine

Status: the event scheduler with court maintenance blocks, player availability (individual fixtures and team encounters), player rescheduling requests with optional organizer approval, and organizer-set reminder timing. Ranked recommendations are not implemented yet.

## Current behavior

Mandatory rules are deterministic and run inside the Firestore transaction for the command.

**Individual fixtures (`generateSchedule`).**

- Matches are placed in round order, earliest first. Each match must start after any feeder match ends.
- A slot must fall inside the event dates, the event's daily playing hours (in the event timezone), and outside event blackouts.
- A court is chosen from the event's active PPRC courts. It is skipped if it has a court maintenance block for the slot (see [COURT_MANAGEMENT.md](COURT_MANAGEMENT.md)).
- A slot fails if it overlaps another match on the same court or with the same player (`scheduleConflict`, using duration plus buffer).
- If no slot fits, the command fails with "Not enough available court time; expand dates or add courts". Nothing is partially written.

**Individual reschedule (`rescheduleMatch`).** Checks the same rules for one proposed slot: daily hours, event dates, blackouts, court blocks, court and player conflicts, preceding round finished, and next round not starting too early.

**Team encounters (`generateTeamSchedule`, `scheduleEncounter`).** Same kind of checks, applied to team encounters: active PPRC courts, daily hours, blackouts, court blocks, team conflicts, group-before-playoff ordering, and feeder completion.

## Player availability

A registered player's saved availability (see the profile page) is a hard constraint for individual fixtures:

- `generateSchedule` skips a slot if any participant of the match is unavailable at that time.
- `rescheduleMatch` fails with "A player is unavailable at this time".

Availability is treated as "no restriction" when a player has never saved any. Team encounters need at least two available roster members of each team (`teamAvailabilityMinimum`), checked for the whole slot. A slot is unavailable when it falls on an unavailable date, on a day outside the player's preferred weekdays, outside every preferred window, or when it crosses local midnight. Preferences are evaluated in the event timezone.

## Player rescheduling requests

A participant of a head-to-head match asks the opponent for a new court and time (`requestReschedule`). The request is checked immediately with the same rules as an organizer change: event courts, daily hours, event dates, blackouts, court blocks, both players' availability, and conflicts. Only one pending request per match is allowed.

The opponent accepts or declines (`respondReschedule`). Accepting re-checks the slot. A request is marked **Stale**, and the match is left alone, if the match's time or court changed after the request was made. If the event turns on organizer approval (`setReschedulePolicy`), an accepted request waits as **Awaiting organizer**. The organizer then approves (`decideReschedule`, which re-checks the slot) or declines. Otherwise applying a request moves the match, which frees the old court automatically, and notifies both players.

## Explanations

The engine returns pass/fail with a reason string, not a ranked recommendation. Organizers see the reason for a rejected slot. A ranked list of recommended slots with explanations is not implemented.

## Not implemented yet

- Player and team availability as input to the engine (Milestone 5, Phase 3).
- Recommendations with explanations, and organizer-defined priority.
- Weather-related rescheduling.
- Rescheduling requests with opponent acceptance and organizer approval.
- Timezone-aware display for players beyond the event timezone rules above.
