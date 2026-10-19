import type Database from "better-sqlite3";
import { solveRatings, MatchInput, Format } from "./rating";

interface MatchRow {
  id: number;
  played_on: string;
  p1: number;
  p2: number;
  p1_games: number;
  p2_games: number;
  format: Format;
  retired: number;
}

function loadInputs(db: Database.Database) {
  const matches: MatchInput[] = (db
    .prepare("SELECT id, played_on, p1, p2, p1_games, p2_games, format, retired FROM matches")
    .all() as MatchRow[]).map((m) => ({
    id: m.id,
    playedOn: m.played_on,
    p1: m.p1,
    p2: m.p2,
    p1Games: m.p1_games,
    p2Games: m.p2_games,
    format: m.format,
    retired: !!m.retired,
  }));
  const seeds = new Map<number, number>(
    (db.prepare("SELECT id, seed_rating FROM players").all() as { id: number; seed_rating: number }[]).map((p) => [
      p.id,
      p.seed_rating,
    ]),
  );
  return { matches, seeds };
}

/** Recompute every rating, the per-match ratings and the monthly history. */
export function recomputeAll(db: Database.Database, asOf = new Date()) {
  const { matches, seeds } = loadInputs(db);
  const { ratings, details } = solveRatings(matches, seeds, asOf);

  // Monthly history for the last 12 months, solved as of each month end.
  const history: { player: number; asOf: string; rating: number }[] = [];
  for (let k = 11; k >= 1; k--) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - k + 1, 0);
    const snap = solveRatings(matches, seeds, d, 20).ratings;
    for (const [p, r] of snap) if (r.matchCount > 0) history.push({ player: p, asOf: d.toISOString().slice(0, 10), rating: r.rating });
  }
  for (const [p, r] of ratings) if (r.matchCount > 0) history.push({ player: p, asOf: asOf.toISOString().slice(0, 10), rating: r.rating });

  const tx = db.transaction(() => {
    const upd = db.prepare("UPDATE players SET rating = ?, reliability = ?, match_count = ? WHERE id = ?");
    for (const [p, r] of ratings) upd.run(r.matchCount > 0 ? r.rating : null, r.reliability, r.matchCount, p);
    db.prepare("DELETE FROM match_ratings").run();
    const ins = db.prepare("INSERT OR REPLACE INTO match_ratings (match_id, player_id, match_rating, weight) VALUES (?,?,?,?)");
    for (const d of details) ins.run(d.matchId, d.playerId, Math.round(d.matchRating * 100) / 100, d.weight);
    db.prepare("DELETE FROM rating_history").run();
    const h = db.prepare("INSERT OR REPLACE INTO rating_history (player_id, as_of, rating) VALUES (?,?,?)");
    for (const x of history) h.run(x.player, x.asOf, x.rating);
  });
  tx();
}
