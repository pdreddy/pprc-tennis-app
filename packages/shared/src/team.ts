// Team-event rules (KOC / TRIACE 2.0). Pure functions; every ambiguous rule is configurable.
export interface TeamRules {
  teamSize: number;
  minCombinedRating: number;
  maxCombinedRating: number;
  /** The 18.5 maximum is proposed and not yet confirmed by the club. */
  maxCombinedConfirmed: boolean;
  singlesRubbers: number;
  doublesRubbers: number;
  /** Number of rubbers a team must win to take the match. */
  rubbersToWin: number;
  /** Decider played as a 10-point super tiebreak when rubbers are level. */
  superTiebreakPoints: number;
  /** Minimum share of the team's singles rubbers each rostered player must play for playoff eligibility. */
  minSinglesParticipation: number;
  /** Allow the same doubles pair in both doubles rubbers. */
  allowRepeatDoublesPair: boolean;
}
export const TRIACE_2: TeamRules = {
  teamSize: 3,
  minCombinedRating: 12,
  maxCombinedRating: 18.5,
  maxCombinedConfirmed: false,
  singlesRubbers: 2,
  doublesRubbers: 2,
  rubbersToWin: 3,
  superTiebreakPoints: 10,
  minSinglesParticipation: 0.4,
  allowRepeatDoublesPair: false,
};
export interface TeamPlayer {
  id: string;
  singles?: number;
  doubles?: number;
}
/** Rating used for team caps: the higher of singles and doubles. */
export function effectiveRating(p: TeamPlayer): number {
  return Math.max(p.singles ?? 0, p.doubles ?? 0);
}
export function validateTeam(players: TeamPlayer[], rules = TRIACE_2) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) errors.push("Duplicate player on roster");
  if (players.length !== rules.teamSize)
    errors.push(`Team needs exactly ${rules.teamSize} players`);
  for (const p of players)
    if (!effectiveRating(p)) errors.push(`Player ${p.id} has no rating`);
  const total =
    Math.round(players.reduce((s, p) => s + effectiveRating(p), 0) * 100) / 100;
  if (total < rules.minCombinedRating)
    errors.push(`Combined rating ${total} is below ${rules.minCombinedRating}`);
  if (total > rules.maxCombinedRating)
    errors.push(`Combined rating ${total} exceeds ${rules.maxCombinedRating}`);
  if (!rules.maxCombinedConfirmed)
    warnings.push("Maximum combined rating is proposed and not confirmed");
  return { valid: errors.length === 0, total, errors, warnings };
}
export interface Lineup {
  singles: string[];
  doubles: [string, string][];
}
export function validateLineup(
  lineup: Lineup,
  roster: string[],
  rules = TRIACE_2,
) {
  const errors: string[] = [];
  const on = new Set(roster);
  if (lineup.singles.length !== rules.singlesRubbers)
    errors.push(`Need ${rules.singlesRubbers} singles players`);
  if (new Set(lineup.singles).size !== lineup.singles.length)
    errors.push("A player cannot play two singles rubbers");
  if (lineup.doubles.length !== rules.doublesRubbers)
    errors.push(`Need ${rules.doublesRubbers} doubles pairs`);
  for (const id of [...lineup.singles, ...lineup.doubles.flat()])
    if (!on.has(id)) errors.push(`Player ${id} is not on the roster`);
  for (const [a, b] of lineup.doubles)
    if (a === b) errors.push("A doubles pair needs two different players");
  const keys = lineup.doubles.map((p) => [...p].sort().join("|"));
  if (!rules.allowRepeatDoublesPair && new Set(keys).size !== keys.length)
    errors.push("The same doubles pair cannot play both doubles rubbers");
  return { valid: errors.length === 0, errors };
}
export interface Rubber {
  kind: "singles" | "doubles" | "decider";
  /** Winning side: "home" | "away"; undefined while unplayed. */
  winner?: "home" | "away";
}
export function teamMatchResult(rubbers: Rubber[], rules = TRIACE_2) {
  const home = rubbers.filter((r) => r.winner === "home").length;
  const away = rubbers.filter((r) => r.winner === "away").length;
  const regular = rules.singlesRubbers + rules.doublesRubbers;
  const regularPlayed = rubbers.filter(
    (r) => r.kind !== "decider" && r.winner,
  ).length;
  const winner =
    home >= rules.rubbersToWin
      ? "home"
      : away >= rules.rubbersToWin
        ? "away"
        : undefined;
  // Level after all regular rubbers (e.g. 2-2): the super tiebreak decides.
  const deciderNeeded =
    !winner && regularPlayed === regular && home === away;
  return { home, away, winner, deciderNeeded, complete: !!winner };
}
export interface PlayedMatch {
  teamId: string;
  singlesPlayers: string[];
}
/** Share of the team's singles rubbers each rostered player has played. */
export function singlesParticipation(
  roster: string[],
  matches: PlayedMatch[],
  rules = TRIACE_2,
) {
  const total = matches.length * rules.singlesRubbers;
  return roster.map((id) => {
    const played = matches.reduce(
      (n, m) => n + m.singlesPlayers.filter((p) => p === id).length,
      0,
    );
    const share = total ? played / total : 0;
    return { id, played, share, eligible: share >= rules.minSinglesParticipation };
  });
}
export interface TeamResultRow {
  home: string;
  away: string;
  homeRubbers: number;
  awayRubbers: number;
}
export function teamStandings(results: TeamResultRow[]) {
  const t = new Map<string, { teamId: string; played: number; wins: number; losses: number; rubbersFor: number; rubbersAgainst: number }>();
  const row = (id: string) => {
    if (!t.has(id))
      t.set(id, { teamId: id, played: 0, wins: 0, losses: 0, rubbersFor: 0, rubbersAgainst: 0 });
    return t.get(id)!;
  };
  for (const r of results) {
    const h = row(r.home);
    const a = row(r.away);
    h.played++; a.played++;
    h.rubbersFor += r.homeRubbers; h.rubbersAgainst += r.awayRubbers;
    a.rubbersFor += r.awayRubbers; a.rubbersAgainst += r.homeRubbers;
    if (r.homeRubbers > r.awayRubbers) { h.wins++; a.losses++; } else { a.wins++; h.losses++; }
  }
  return [...t.values()].sort(
    (x, y) =>
      y.wins - x.wins ||
      y.rubbersFor - y.rubbersAgainst - (x.rubbersFor - x.rubbersAgainst) ||
      x.teamId.localeCompare(y.teamId),
  );
}
