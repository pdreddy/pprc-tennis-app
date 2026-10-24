# Ladder policy and implementation boundary

User-supplied policy, October 24, 2026. Implementation is pending baseline validation; this document is not evidence that the feature has shipped.

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
