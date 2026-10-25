# Court management

Status: maintenance blocks are implemented. Reservations and utilization reports are not implemented yet.

## Implemented

- **Club courts and venues.** Existing `venues` and `courts` records, managed by club administrators under **Courts & venues**.
- **Maintenance blocks.** A block removes one PPRC court from scheduling for a half-open window `[start, end)`. Blocks are stored one document per block in `courtBlocks`, so editing a court record never drops its blocks.
- **Enforcement in scheduling.** A blocked court is not used by:
  - `generateSchedule` (individual fixtures): the court is skipped for that slot.
  - `rescheduleMatch`: the request fails with "Court blocked for maintenance".
  - TRIACE/team scheduling (`generateTeamSchedule`, `scheduleEncounter`): the slot is treated as a scheduling conflict.
- **Concurrency.** Blocks are read inside the same Firestore transaction as the schedule or reschedule write, so a block that commits first is seen by the later write.
- **Authorization.** Only `clubAdmin` can add or remove a block (`manageClub`, target `courtBlock`). Blocks reference only active PPRC courts. Foreign-club or unknown courts are rejected.
- **Audit.** Each add or remove is written to `auditEvents` with the actor, the organizer's reason, and the before/after payload. Removal records the deleted block.
- **Reads.** Any signed-in client can read `courtBlocks` (the rule matches `courts` and `venues`). Clients cannot write them.
- **Backup and restore.** `courtBlocks` is listed in the shared `collections` registry, so the existing Firestore export/import path includes it.

## Usage

1. Open **Admin → Courts & venues**.
2. Under **Block a court for maintenance**, pick the court and start/end times, then enter the block reason and an audit reason.
3. Blocks appear under **Maintenance blocks**. To release one, enter a removal reason and choose **Remove block**.

Times are entered and displayed in the browser's local timezone. Event schedules still use the event timezone for daily hours. Converting block times to the event timezone is not implemented.

## Not implemented

- Recurring blocks and block conflict reports for existing matches. A new block does not move already-scheduled matches; the organizer must reschedule them.
- Court utilization reports.
- Venue-level restrictions and external booking-system integration.
- Court reservations as separate records. Court use is still derived from scheduled matches and encounters.
