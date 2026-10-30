# TRIACE 2.0 Functional Acceptance Checklist

## Included functional scope

| Capability | Implementation | Verification required |
|---|---|---|
| Configurable draft creation | API-mode admin setup | Create a draft with altered UTR, capacity, deadline, and playoff settings. |
| Rule updates with audit reason | `PATCH /v1/events/{id}` | Confirm the audit record contains the reason. |
| Registration state | Draft → published → closed → completed | Verify no team entry before publish and no playoff generation before close. |
| Three-player teams | Player and admin team-entry forms | Verify duplicate player, duplicate player in another active team, invalid UTR, and full division are rejected. |
| Organizer approval | Team approval endpoint and admin control | Verify only approved teams can be scheduled. |
| Fixture scheduling | Admin fixture form | Verify a team cannot be scheduled twice at the identical time. |
| Score finalization | Admin score form | Verify a tie, duplicate player, or player outside the roster is rejected. |
| Score correction | Correction form and reason-required endpoint | Verify finalized results cannot be overwritten through the normal score endpoint. |
| Standings | Rebuilt after each final result | Verify played, wins, losses, and points after a correction. |
| Eligibility | 40% configurable singles participation | Verify each playoff team member reaches the configured threshold. |
| Playoffs and champion | Two/four-team generator, winner advancement, champion endpoint | Verify registration is closed, eligible teams are seeded, semifinal winners create a final, and final winner is champion. |
| In-app notifications | Team submission, approval, fixtures, registration/waitlist | Verify each notification is visible only to its recipient and read state persists. |

## Edge-case checklist

- Registration deadline is enforced in UTC.
- Waitlist can be disabled per event.
- Capacity decisions lock the event row to avoid overbooking during concurrent registration.
- A finalized score requires a separate correction request with an audit reason.
- Completed events reject new or corrected scores.
- Team, division, club, and event relationships are validated server-side.
- Public endpoints expose published events only; organizers can access drafts through authenticated endpoints.

## Final validation commands

```bash
./pprc.sh test-api
./pprc.sh test-all
pnpm events:integration
pnpm events:e2e
pnpm events:ui
```

Run these on a Node 22 developer machine with Docker, Firebase emulators, and Playwright Chromium installed. The API test must exercise the full TRIACE team-to-champion flow.
