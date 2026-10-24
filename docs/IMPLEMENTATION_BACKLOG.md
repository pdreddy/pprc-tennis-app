# Implementation backlog (dependency order)

| # | Item | Phase | Depends on | Status |
| --- | --- | --- | --- | --- |
| 1 | Navy/gold design tokens, bottom nav, state components | 1 | – | done |
| 2 | Manifest/theme colour update, PWA install check | 1 | 1 | manifest done; install untested |
| 3 | TRIACE/KOC rules engine in `packages/shared` (pure, configurable) | 3 | – | done (`team.ts`, 8 tests) |
| 4 | Team + doubles schema, rules, callables | 3/4 | 3 | todo |
| 5 | Singles/doubles ratings, match history, aggregates | 2 | 4 | todo |
| 6 | Player search, rankings, analytics views | 2 | 5 | todo |
| 7 | Club directory, announcements | 2 | – | todo |
| 8 | Captain invites, team registration, approval | 4 | 4 | todo |
| 9 | Lineup submission, rubber scoring, team match result | 4 | 3,8 | todo |
| 10 | Team standings, playoff eligibility (40% singles), bracket | 3/4 | 9 | todo |
| 11 | Ladders | 3 | 5 | todo |
| 12 | Synthetic TRIACE lifecycle test (emulator + Playwright) | 5 | 10 | todo |
| 13 | Mobile viewport Playwright suite | 5 | 1 | todo |
| 14 | Staging/deploy/backup docs | 6 | all | todo |

## Open rule questions (kept configurable)
- TRIACE max combined UTR (18.5 proposed, unconfirmed).
- Rubber order and who may play two rubbers; super-tiebreak timing relative to rubber 3.
- Tie handling for 40% singles-participation rule (per team or per player).
