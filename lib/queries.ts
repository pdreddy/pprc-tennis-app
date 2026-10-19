import { getDb } from "./db";

export interface Player {
  id: number;
  first_name: string;
  last_name: string;
  gender: "M" | "F";
  birth_year: number;
  city: string;
  state: string;
  club_id: number | null;
  club_name?: string | null;
  plays: string;
  backhand: string;
  bio: string | null;
  seed_rating: number;
  rating: number | null;
  reliability: number;
  match_count: number;
  avatar_url: string | null;
}

export interface MatchRow {
  id: number;
  event_id: number | null;
  event_name: string | null;
  played_on: string;
  p1: number;
  p2: number;
  p1_name: string;
  p2_name: string;
  p1_rating: number | null;
  p2_rating: number | null;
  score: string;
  p1_games: number;
  p2_games: number;
  winner: number;
  format: string;
  source: string;
}

export interface EventRow {
  id: number;
  name: string;
  club_id: number | null;
  club_name: string | null;
  city: string;
  state: string;
  start_date: string;
  end_date: string;
  min_rating: number;
  max_rating: number;
  gender: string;
  entry_fee: number;
  draw_size: number;
  format: string;
  description: string | null;
  registered: number;
}

export const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;
export const ageOf = (birthYear: number) => new Date().getFullYear() - birthYear;
export const fmtRating = (r: number | null | undefined) => (r == null ? "—" : r.toFixed(2));

const PLAYER_SELECT = `SELECT p.*, c.name AS club_name FROM players p LEFT JOIN clubs c ON c.id = p.club_id`;

export function getPlayer(id: number): Player | undefined {
  return getDb().prepare(`${PLAYER_SELECT} WHERE p.id = ?`).get(id) as Player | undefined;
}

export interface PlayerFilter {
  q?: string;
  gender?: string;
  state?: string;
  ageGroup?: string;
  clubId?: number;
  minRating?: number;
  maxRating?: number;
  limit?: number;
}

export const AGE_GROUPS: Record<string, [number, number]> = {
  "12U": [0, 12],
  "14U": [0, 14],
  "16U": [0, 16],
  "18U": [0, 18],
  Adult: [19, 200],
  "40+": [40, 200],
};

export function searchPlayers(f: PlayerFilter = {}): Player[] {
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (f.q) {
    where.push("(p.first_name || ' ' || p.last_name LIKE ? OR p.city LIKE ? OR c.name LIKE ?)");
    args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.gender === "M" || f.gender === "F") {
    where.push("p.gender = ?");
    args.push(f.gender);
  }
  if (f.state) {
    where.push("p.state = ?");
    args.push(f.state);
  }
  if (f.clubId) {
    where.push("p.club_id = ?");
    args.push(f.clubId);
  }
  if (f.ageGroup && AGE_GROUPS[f.ageGroup]) {
    const [lo, hi] = AGE_GROUPS[f.ageGroup];
    const y = new Date().getFullYear();
    where.push("p.birth_year BETWEEN ? AND ?");
    args.push(y - hi, y - lo);
  }
  if (f.minRating != null) {
    where.push("p.rating >= ?");
    args.push(f.minRating);
  }
  if (f.maxRating != null) {
    where.push("p.rating <= ?");
    args.push(f.maxRating);
  }
  return getDb()
    .prepare(`${PLAYER_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.rating IS NULL, p.rating DESC LIMIT ?`)
    .all(...args, f.limit ?? 200) as Player[];
}

export function allPlayersLite(): { id: number; name: string; rating: number | null }[] {
  return (getDb().prepare("SELECT id, first_name, last_name, rating FROM players ORDER BY last_name, first_name").all() as Player[]).map(
    (p) => ({ id: p.id, name: fullName(p), rating: p.rating }),
  );
}

const MATCH_SELECT = `
SELECT m.*, e.name AS event_name,
  a.first_name || ' ' || a.last_name AS p1_name, b.first_name || ' ' || b.last_name AS p2_name,
  a.rating AS p1_rating, b.rating AS p2_rating
FROM matches m
JOIN players a ON a.id = m.p1
JOIN players b ON b.id = m.p2
LEFT JOIN events e ON e.id = m.event_id`;

export function playerMatches(playerId: number, limit = 50): MatchRow[] {
  return getDb()
    .prepare(`${MATCH_SELECT} WHERE m.p1 = ? OR m.p2 = ? ORDER BY m.played_on DESC, m.id DESC LIMIT ?`)
    .all(playerId, playerId, limit) as MatchRow[];
}

export function getMatch(id: number): MatchRow | undefined {
  return getDb().prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(id) as MatchRow | undefined;
}

export function eventMatches(eventId: number): MatchRow[] {
  return getDb().prepare(`${MATCH_SELECT} WHERE m.event_id = ? ORDER BY m.played_on, m.id`).all(eventId) as MatchRow[];
}

export function recentMatches(limit = 8): MatchRow[] {
  return getDb().prepare(`${MATCH_SELECT} ORDER BY m.played_on DESC, m.id DESC LIMIT ?`).all(limit) as MatchRow[];
}

export function matchRatingsFor(matchId: number): Map<number, number> {
  const rows = getDb().prepare("SELECT player_id, match_rating FROM match_ratings WHERE match_id = ?").all(matchId) as {
    player_id: number;
    match_rating: number;
  }[];
  return new Map(rows.map((r) => [r.player_id, r.match_rating]));
}

export function ratingHistory(playerId: number): { as_of: string; rating: number }[] {
  return getDb().prepare("SELECT as_of, rating FROM rating_history WHERE player_id = ? ORDER BY as_of").all(playerId) as {
    as_of: string;
    rating: number;
  }[];
}

const EVENT_SELECT = `
SELECT e.*, c.name AS club_name, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
FROM events e LEFT JOIN clubs c ON c.id = e.club_id`;

export function upcomingEvents(limit = 50): EventRow[] {
  return getDb().prepare(`${EVENT_SELECT} WHERE e.end_date >= date('now') ORDER BY e.start_date LIMIT ?`).all(limit) as EventRow[];
}

export function pastEvents(limit = 50): EventRow[] {
  return getDb().prepare(`${EVENT_SELECT} WHERE e.end_date < date('now') ORDER BY e.start_date DESC LIMIT ?`).all(limit) as EventRow[];
}

export function getEvent(id: number): EventRow | undefined {
  return getDb().prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as EventRow | undefined;
}

export function eventEntrants(eventId: number): Player[] {
  return getDb()
    .prepare(`${PLAYER_SELECT} JOIN registrations r ON r.player_id = p.id WHERE r.event_id = ? ORDER BY p.rating DESC`)
    .all(eventId) as Player[];
}

export function clubs() {
  return getDb()
    .prepare(
      `SELECT c.*, COUNT(p.id) AS members, ROUND(AVG(p.rating), 2) AS avg_rating, MAX(p.rating) AS top_rating
       FROM clubs c LEFT JOIN players p ON p.club_id = c.id GROUP BY c.id ORDER BY members DESC`,
    )
    .all() as { id: number; name: string; city: string; state: string; courts: number; surface: string; members: number; avg_rating: number; top_rating: number }[];
}

export function getClub(id: number) {
  return getDb().prepare("SELECT * FROM clubs WHERE id = ?").get(id) as
    | { id: number; name: string; city: string; state: string; courts: number; surface: string }
    | undefined;
}

export function states(): string[] {
  return (getDb().prepare("SELECT DISTINCT state FROM players ORDER BY state").all() as { state: string }[]).map((r) => r.state);
}

export function playerMedia(playerId: number) {
  return getDb().prepare("SELECT * FROM media WHERE player_id = ? ORDER BY id DESC").all(playerId) as {
    id: number;
    kind: string;
    url: string;
    prompt: string | null;
    mock: number;
    created_at: string;
  }[];
}

/** Summary stats used by the profile page and the AI coach. */
export function playerStats(playerId: number) {
  const ms = playerMatches(playerId, 500);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const recent = ms.filter((m) => m.played_on >= yearAgo);
  const wins = recent.filter((m) => m.winner === playerId).length;
  let gw = 0;
  let gl = 0;
  let upsetWins = 0;
  let closeLosses = 0;
  let threeSetters = 0;
  let threeSetWins = 0;
  const me = getPlayer(playerId);
  for (const m of recent) {
    const mine = m.p1 === playerId;
    gw += mine ? m.p1_games : m.p2_games;
    gl += mine ? m.p2_games : m.p1_games;
    const oppRating = mine ? m.p2_rating : m.p1_rating;
    if (m.winner === playerId && oppRating != null && me?.rating != null && oppRating > me.rating + 0.5) upsetWins++;
    const share = (mine ? m.p1_games : m.p2_games) / (m.p1_games + m.p2_games);
    if (m.winner !== playerId && share > 0.44) closeLosses++;
    if (m.score.split(" ").length >= 3) {
      threeSetters++;
      if (m.winner === playerId) threeSetWins++;
    }
  }
  return {
    played: recent.length,
    wins,
    losses: recent.length - wins,
    gameShare: gw + gl > 0 ? gw / (gw + gl) : 0,
    upsetWins,
    closeLosses,
    threeSetters,
    threeSetWins,
  };
}
