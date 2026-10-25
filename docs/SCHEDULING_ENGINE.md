# Scheduling engine

Status: the existing event scheduler, with court maintenance blocks added (Milestone 5, slice 1). Availability, rescheduling requests, and recommendations are not implemented yet.

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

## Explanations

The engine returns pass/fail with a reason string, not a ranked recommendation. Organizers see the reason for a rejected slot. A ranked list of recommended slots with explanations is not implemented.

## Not implemented yet

- Player and team availability as input to the engine (Milestone 5, Phase 3).
- Recommendations with explanations, and organizer-defined priority.
- Weather-related rescheduling.
- Rescheduling requests with opponent acceptance and organizer approval.
- Timezone-aware display for players beyond the event timezone rules above.
