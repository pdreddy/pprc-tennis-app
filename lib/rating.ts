/**
 * Baseline Rating engine.
 *
 * An original, game-share based rating on a 1.00–16.50 scale.
 *
 * Idea: what matters is not just who won, but what share of games you won
 * against someone of a known level. Each match produces a "match rating"
 * for each player; a player's rating is the weighted average of their recent
 * match ratings. Because every match rating depends on the opponent's rating,
 * the whole pool is solved iteratively until it settles.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 16.5;

/** Rating points that separate two players when one wins ~73% of games. */
export const SCALE = 1.0;
const WINDOW_DAYS = 365;
const MAX_MATCHES = 30;
const HALF_LIFE_DAYS = 120;

export type Format = "best_of_3" | "best_of_5" | "one_set" | "pro_set" | "tiebreak_10";

export interface MatchInput {
  id: number;
  playedOn: string; // ISO date
  p1: number;
  p2: number;
  p1Games: number;
  p2Games: number;
  format: Format;
  retired?: boolean;
}

export interface RatingResult {
  rating: number;
  reliability: number; // 0–100
  matchCount: number;
}

export interface MatchRatingDetail {
  matchId: number;
  playerId: number;
  matchRating: number;
  weight: number;
}

const FORMAT_WEIGHT: Record<Format, number> = {
  best_of_5: 1.15,
  best_of_3: 1,
  pro_set: 0.7,
  one_set: 0.6,
  tiebreak_10: 0.35,
};

export const clamp = (x: number, lo = MIN_RATING, hi = MAX_RATING) => Math.min(hi, Math.max(lo, x));

/** Expected share of games for a player who is `diff` rating points above the opponent. */
export function expectedShare(diff: number): number {
  return 1 / (1 + Math.exp(-diff / SCALE));
}

/** Inverse of expectedShare: the rating gap implied by a game share. */
export function impliedGap(share: number): number {
  const s = Math.min(0.96, Math.max(0.04, share));
  return SCALE * Math.log(s / (1 - s));
}

/** Weight of one match for one player. */
export function matchWeight(m: MatchInput, asOf: Date, opponentReliability: number): number {
  const ageDays = (asOf.getTime() - new Date(m.playedOn).getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays > WINDOW_DAYS) return 0;
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const total = m.p1Games + m.p2Games;
  // Very short matches tell us less.
  const volume = Math.min(1, total / 12);
  const opp = 0.35 + 0.65 * (opponentReliability / 100);
  const retired = m.retired ? 0.5 : 1;
  return recency * volume * FORMAT_WEIGHT[m.format] * opp * retired;
}

/**
 * Solve ratings for every player as of a date.
 * `seeds` gives a starting rating (self-reported or previous) for each player.
 */
export function solveRatings(
  matches: MatchInput[],
  seeds: Map<number, number>,
  asOf: Date = new Date(),
  iterations = 30,
): { ratings: Map<number, RatingResult>; details: MatchRatingDetail[] } {
  const relevant = matches.filter((m) => new Date(m.playedOn) <= asOf && m.p1Games + m.p2Games > 0);

  // Each player's most recent matches only.
  const byPlayer = new Map<number, MatchInput[]>();
  for (const m of relevant) {
    for (const p of [m.p1, m.p2]) {
      if (!byPlayer.has(p)) byPlayer.set(p, []);
      byPlayer.get(p)!.push(m);
    }
  }
  for (const [p, list] of byPlayer) {
    list.sort((a, b) => b.playedOn.localeCompare(a.playedOn));
    byPlayer.set(p, list.slice(0, MAX_MATCHES));
  }

  const rating = new Map<number, number>();
  const reliability = new Map<number, number>();
  for (const [p, r] of seeds) {
    rating.set(p, clamp(r));
    reliability.set(p, 20);
  }
  for (const p of byPlayer.keys()) {
    if (!rating.has(p)) rating.set(p, 6);
    if (!reliability.has(p)) reliability.set(p, 20);
  }

  let details: MatchRatingDetail[] = [];
  for (let it = 0; it < iterations; it++) {
    const next = new Map<number, number>();
    const nextRel = new Map<number, number>();
    details = [];
    for (const [p, list] of byPlayer) {
      let sumW = 0;
      let sumWR = 0;
      for (const m of list) {
        const isP1 = m.p1 === p;
        const opp = isP1 ? m.p2 : m.p1;
        const mine = isP1 ? m.p1Games : m.p2Games;
        const theirs = isP1 ? m.p2Games : m.p1Games;
        const oppRating = rating.get(opp) ?? 6;
        const mr = clamp(oppRating + impliedGap(mine / (mine + theirs)));
        const w = matchWeight(m, asOf, reliability.get(opp) ?? 20);
        if (w <= 0) continue;
        sumW += w;
        sumWR += w * mr;
        details.push({ matchId: m.id, playerId: p, matchRating: mr, weight: w });
      }
      const seed = seeds.get(p) ?? rating.get(p)!;
      // A light prior towards the seed keeps thin profiles stable.
      const prior = 0.6;
      const r = sumW > 0 ? (sumWR + prior * seed) / (sumW + prior) : seed;
      // Damping keeps the iteration from oscillating.
      next.set(p, clamp(0.5 * (rating.get(p) ?? r) + 0.5 * r));
      nextRel.set(p, Math.round(Math.min(100, 100 * (1 - Math.exp(-sumW / 4)))));
    }
    for (const [p, r] of next) rating.set(p, r);
    for (const [p, r] of nextRel) reliability.set(p, r);
  }

  const ratings = new Map<number, RatingResult>();
  for (const [p, r] of rating) {
    ratings.set(p, {
      rating: Math.round(r * 100) / 100,
      reliability: byPlayer.has(p) ? reliability.get(p)! : 0,
      matchCount: byPlayer.get(p)?.length ?? 0,
    });
  }
  return { ratings, details };
}

/** Win probability for a best-of-3 match given a rating gap (game-level model → match level). */
export function winProbability(diff: number): number {
  const g = expectedShare(diff);
  // Map game share to match probability; a 55% game share wins most matches.
  return 1 / (1 + Math.exp(-(g - 0.5) * 14));
}

/** Parse "6-4 3-6 10-8" style scores. Returns per-set games and totals. */
export function parseScore(score: string): { sets: [number, number][]; p1Games: number; p2Games: number } {
  const sets: [number, number][] = [];
  for (const part of score.trim().split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,2})-(\d{1,2})(?:\(\d+\))?$/);
    if (!m) throw new Error(`Couldn't read the set "${part}". Use a format like 6-4 3-6 10-8.`);
    sets.push([Number(m[1]), Number(m[2])]);
  }
  if (sets.length === 0) throw new Error("Enter at least one set, like 6-4.");
  let p1Games = 0;
  let p2Games = 0;
  sets.forEach(([a, b], i) => {
    // A match tiebreak in the deciding set counts as a single game.
    const isMatchTiebreak = i === sets.length - 1 && sets.length >= 3 && Math.max(a, b) >= 10;
    if (isMatchTiebreak) {
      if (a > b) p1Games += 1;
      else p2Games += 1;
    } else {
      p1Games += a;
      p2Games += b;
    }
  });
  return { sets, p1Games, p2Games };
}

export function winnerOf(sets: [number, number][]): 1 | 2 {
  let a = 0;
  let b = 0;
  for (const [x, y] of sets) {
    if (x > y) a++;
    else if (y > x) b++;
  }
  return a >= b ? 1 : 2;
}
