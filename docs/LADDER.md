# Ladder seasons

User-supplied policy, October 24, 2026. Milestone 4 passed the complete integration gate on October 24, 2026: 96 shared unit, 80 Firebase integration, 15 browser/PWA and four legacy tests, plus migration and backup/restore. See INTEGRATION_TEST_REPORT.md for actual evidence.

The ladder is part of the existing Events PWA and Firebase transaction engine. Ladder positions, season points, supplied UTR references and tournament standings are separate concepts. No proprietary rating calculation or external data feed is authorized.

## Confirmed sporting rules

- Played win: 3 points; played loss: 1. A winner whose consecutive played wins reach two or more receives 1 streak point. Beating an opponent at least two positions higher adds 1 upset point. A successful upward challenger receives 1 challenge point; a successful defender receives 1 defense point.
- Uncompleted contests award zero and preserve streaks. Walkovers award only 3 to the winner and zero to the absent player, with no bonuses. They do not count toward inactivity activity. An organizer may explicitly authorize an accepted challenge walkover to move positions, retaining the reason.
- A lower-ranked winner swaps positions with the higher-ranked opponent. A higher-ranked winner leaves positions unchanged.
- Normal upward challenge reach is 3 positions; after two consecutive played wins it is 5. Positions 1–3 may challenge up to 3 positions below. Each entrant may have only one active challenge.
- No opponent rematch within 14 days; at most two matches against one opponent per season, with at most one during weeks 1–4.
- The recipient has 48 hours to respond. An accepted challenge has five days to complete, even across a normal weekly boundary.
- First decline in a season is free. Each subsequent decline deducts 2 points and adds a strike. At two strikes the entrant drops three positions and the strike counter resets. Response expiry counts as a decline. Organizers may waive a decline or strike with a reason.
- Two consecutive weeks without a completed played match cause a three-position drop. Walkovers/no-shows do not reset this clock. Audited organizer exemptions cover injury, travel and other accepted circumstances.
- Weeks close Sunday at 11:59 PM in the event timezone. Positions freeze at the final weekly close. The #1 entrant is Ladder Champion. The season points leader is Points Champion, with tiebreakers: match wins, successful upward challenges, head-to-head, then an explicit organizer decision based on season results.
- Initial order uses supplied UTR references and organizer seeding. Players coordinate time and location. Submitted results require verification; disputes and corrections retain the original records.

## Organizer decisions to expose

Confirmed organizer decisions: challenge acceptance closes five days before the final Sunday freeze, preserving the full completion window for every accepted challenge. Doubles use fixed, consenting pairs for the entire season. Playoffs are disabled unless the organizer explicitly configures qualification.

These details must be explicit in each published season: singles versus fixed doubles partnerships; reference metric/fallback; organizer seeding; whether retirement counts as a completed played match; season timezone and number of weeks; score format; court/location requirements; inactivity exemption dates; playoff qualification, seeding and scoring if playoffs are enabled. Season points and ladder champions must remain distinct from an optional playoff champion.

The system must not silently infer these choices from another tennis application's behavior. Tournament policy locks once entries/fixtures exist; organizer exceptions require immutable audit history.

## Required evidence

Use synthetic Auth accounts and real Firestore/Functions emulators. Verify challenge authorization, partner consent, reach, concurrent challenge creation, rematch limits, deadlines, repeated-decline strikes, ranking swaps, walkovers, inactivity, timezone boundaries, correction replay, champion ties and concurrent season closure. Browser journeys must cover creation/entry/challenge/acceptance/result/opponent confirmation/standings, with mobile and denied actions. Run `./pprc.sh test-all`, including migration and backup/restore, before declaring a cycle complete.

## Implementation and operations

The event wizard creates `competition: ladder` with a reviewed `ladderRules` policy. Use **Season rules** to choose singles or fixed doubles, reference/verification requirements, all point/bonus/penalty/range/deadline settings, retirement treatment, match scoring and optional playoff qualification. Policy locks at the first entry. Calendar boundaries are Monday 00:00 through Sunday 23:59 in the event timezone, with 1–52 complete weeks and 2–32 approved entries. UTC input labels are explicit; player deadlines render in the event timezone, including DST changes.

Use **Entries & playoffs** for existing consent, waiver, registration, payment, approval/seeding, roster, shared score review and optional bracket workflows. After registration closes, the organizer starts the approved season. Singles use one-person entries; doubles use two consenting roster members. Rosters, eligibility snapshots and initial seeding lock for the season. External UTR references remain supplied/admin-verified snapshots, never calculated official ratings.

**Challenges** sends private opponent invitations, accepts/declines, proposes a real match time/location and obtains the opposite entrant's schedule confirmation. Accepted challenges create the existing encounter/lineup/rubber records with fixed participants. Scores use the common versioned submission and opposing-player/organizer verification engine. Pending and disputed results award no points. A completed result is reserved once in the ladder ledger; current canonical versions replay the original action sequence after correction, updating points, streaks and position movement without double-awarding. The last verified time does not replace the original result sequence. No-contest cancellation preserves superseded result versions.

`ladderChallenges` stores invitation state, participants, rank snapshots, response/completion deadlines, schedule proposals/confirmation and explicit walkover movement decisions. `ladderLedger` stores immutable sequenced results, declines, week closes, exemptions, waivers, review/closure and organizer decisions. `events.ladderState` holds the server-derived current standings, initial order, closure/review state, qualification and separate ladder/points champions. Clients cannot write these records. Challenge and ledger reads are limited to their participants and scoped event operators; public approved entries/results/standings follow existing event visibility.

Existing five-minute maintenance invokes the same transactional `tick` handler as organizer refresh. It deduplicates response expiries, accepted-match expiry, weekly inactivity and final freeze. A full 48-hour response period plus five-day completion period must fit before freeze, so new invitations close seven days before freeze with the default policy. Acceptance closes five days before freeze. Unplayed expiry awards zero; an organizer verifies a no-show through the shared forfeit workflow. Walkover movement is a separate audited decision, with exactly three points and no played activity or bonus.

Organizer review provides decline/strike/inactivity waivers, inclusive exemption weeks, no-contest cancellation, walkover movement, points-champion tie decisions and explicit season reopening. Frozen disputed/unverified seasons declare no champions until reviewed. Reopening pauses automatic closure until the organizer explicitly freezes the reviewed results. Playoff generation locks season corrections and serializes concurrent requests. Season champions and season points remain unchanged by playoff scores; the shared bracket declares a separate playoff champion/runner-up.

Playoffs default off. If enabled, choose 2/4/8 qualifiers, minimum played matches and position or points seeding. Points seeds compare points, wins, successful upward wins, then frozen ladder position; this ordering is shown in the policy UI. Playoff schedules use their own configured post-freeze gap/window and existing court conflict/daily-hours checks. Captain lineups and verified scores reuse the shared competition lifecycle.

Retirements default to no contest until the organizer reviews another treatment. Walkovers count toward rematch limits by default. Simultaneous inactivity drops preserve relative order among affected entrants; if everyone is inactive, the same order remains. These choices are explicit PPRC policy, not inferred reference-app behavior. Scheduled cloud invocation, real notifications and physical-device behavior still require staging verification; local tests do not deploy anything.

## Ranking movement

At each week close the server stores the standings positions as `ladderState.movementBaseline`. The rankings page shows each team's change against that baseline (▲ up, ▼ down). A team with no baseline yet shows "No prior week", not zero. Movement is only as current as the last week close.
