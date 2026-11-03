# PPRC Rating (formula `pprc-rating-1.0`)

PPRC Rating is PPRC's own tennis rating. It is not UTR and does not use UTR data, formulas, branding or any external rating API. The engine is pure Python in `backend/app/pprc_rating.py`; persistence and replay live in `backend/app/rating_service.py`.

## Scale and kinds
- Range **1.00 – 16.50**, stored to 4 decimals, shown to 2.
- **Singles and doubles are separate ratings.** A doubles side's strength is the mean of its two players.
- New players choose a **provisional starting level** for each kind during onboarding (default 5.00). It can be changed only until their first verified match.

## Which results count
Only results with status `finalized` are rated: a player report confirmed by the opposing side, an organizer verification, or a finalized tournament/ladder match. Reported, disputed and cancelled (voided) results never count.

| Outcome | Rated? |
| --- | --- |
| `completed` with a set score | Yes |
| `retired` with at least 6 games played | Yes (games played so far) |
| `retired` with fewer than 6 games | No |
| `walkover`, `incomplete`, `no_score` | Never |
| `completed` without a score | Stored as `no_score`, not rated |

Score parsing: `6-3 4-6 10-7` → games 11-9, sets 2-1. A set with a side above 7 is a match tiebreak and counts as one game.

## Update rule (per player, per match)
```
expected  E = 1 / (1 + 10^((R_opp - R_side) / 3.0))
perform   P = 0.6 * won + 0.4 * (games_won / games_total)
weight    W = format_weight * recency_weight
K         = 0.30 * W * (1 + 1.5 * (1 - reliability))
delta     = K * (P - E)     then: a win never lowers a rating, a loss never raises one
R'        = clamp(R + delta, 1.00, 16.50)
```
- **Format weight:** best of 5 1.1, best of 3 1.0, pro set 0.8, one set 0.7, match tiebreak only 0.4.
- **Recency weight** (relative to recalculation time): ≤180 days 1.0, ≤365 days 0.75, older 0.5.
- **Reliability** = min(1, Σ W / 12) shown as 0–100%. Low reliability raises K so new players converge quickly.
- **Provisional** until 5 verified matches of that kind.

## Determinism, versioning and recalculation
- Every change (confirmation, verification, correction, void, tournament correction) triggers `recalculate_club`, which **replays all finalized results of the club in (played_at, id) order** from the starting ratings and rewrites `player_ratings` and `rating_history`. Same inputs ⇒ same ratings, so corrections and score reversals can never leave stale values.
- Replay is idempotent and serialized per club with a lock, so it is safe to run from a background worker or cron (`POST /v1/clubs/{club}/ratings/recalculate`).
- `formula_version` is stored on every rating and history row. A new formula gets a new version string and a full replay.

## Tenancy and privacy
- Ratings are **club-scoped** (`club_id` on every table, RLS in `backend/sql/008_pprc_rating.sql`). Club rankings require membership of that club.
- Platform-wide rankings (`GET /v1/public/rankings`) include only players whose profile is **public**, and expose only display name, city/state, club name, rating, reliability and record.
- Profile visibility: `public` (anyone), `club` (members of the club), `private` (the player and club staff). Private players are excluded from directories and rankings for other members.

## Limitations
- No cross-club rating pooling: a player's rating in one club is independent of another club.
- Recalculation is a full club replay: fine for thousands of matches; very large clubs should move it to a worker queue.
- Recency is relative to the recalculation time, so ratings can drift slightly when re-run months later with no new matches.
- TRIACE team rubbers are not yet fed into PPRC Rating (team fixtures keep their own standings).
- Players without a profile start at 5.00.
- Profile images are URLs; uploads are deferred.
