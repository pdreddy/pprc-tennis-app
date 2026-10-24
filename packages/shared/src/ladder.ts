import { z } from "zod";
import type { Entity } from "./index";

export const ladderRulesSchema = z
  .object({
    version: z.literal(1).default(1),
    policyConfirmed: z.boolean().default(false),
    entryKind: z.enum(["singles", "doubles"]).default("singles"),
    requireReferences: z.boolean().default(true),
    requireVerified: z.boolean().default(false),
    membersOnly: z.boolean().default(false),
    responseHours: z.number().int().min(1).max(168).default(48),
    completionDays: z.number().int().min(1).max(14).default(5),
    normalReach: z.number().int().min(1).max(31).default(3),
    streakReach: z.number().int().min(1).max(31).default(5),
    streakThreshold: z.number().int().min(2).max(10).default(2),
    topDownPositions: z.number().int().min(0).max(10).default(3),
    downwardReach: z.number().int().min(0).max(31).default(3),
    rematchDays: z.number().int().min(1).max(90).default(14),
    maximumMeetings: z.number().int().min(1).max(10).default(2),
    earlyWeeks: z.number().int().min(0).max(52).default(4),
    earlyMaximumMeetings: z.number().int().min(1).max(10).default(1),
    winPoints: z.number().int().min(0).max(100).default(3),
    lossPoints: z.number().int().min(0).max(100).default(1),
    walkoverPoints: z.number().int().min(0).max(100).default(3),
    streakBonus: z.number().int().min(0).max(10).default(1),
    upsetBonus: z.number().int().min(0).max(10).default(1),
    upsetGap: z.number().int().min(1).max(31).default(2),
    challengeBonus: z.number().int().min(0).max(10).default(1),
    defenseBonus: z.number().int().min(0).max(10).default(1),
    freeDeclines: z.number().int().min(0).max(10).default(1),
    declinePenalty: z.number().int().min(0).max(100).default(2),
    strikesForDrop: z.number().int().min(1).max(10).default(2),
    strikeDrop: z.number().int().min(1).max(31).default(3),
    inactivityWeeks: z.number().int().min(1).max(12).default(2),
    inactivityDrop: z.number().int().min(1).max(31).default(3),
    retirementTreatment: z
      .enum(["no-contest", "played", "walkover"])
      .default("no-contest"),
    walkoversCountForRematch: z.boolean().default(true),
    rubberScoring: z
      .enum(["one-set", "best-of-three"])
      .default("best-of-three"),
    finalSetTiebreak: z.boolean().default(true),
    setGames: z.number().int().min(1).max(8).default(6),
    setTiebreakAt: z.number().int().min(0).max(8).nullable().default(6),
    noAd: z.boolean().default(true),
    playoffQualifiers: z
      .union([z.literal(0), z.literal(2), z.literal(4), z.literal(8)])
      .default(0),
    playoffMinimumPlayed: z.number().int().min(0).max(62).default(0),
    playoffSeeding: z.enum(["positions", "points"]).default("positions"),
    playoffGapHours: z.number().int().min(0).max(336).default(0),
    playoffWindowDays: z.number().int().min(1).max(30).default(7),
  })
  .strict()
  .superRefine((r, c) => {
    if (r.streakReach < r.normalReach)
      c.addIssue({
        code: "custom",
        message: "Streak reach must cover the normal challenge range",
      });
    if (r.earlyMaximumMeetings > r.maximumMeetings)
      c.addIssue({
        code: "custom",
        message: "Early-season limit exceeds the full-season limit",
      });
    if (r.setTiebreakAt !== null && r.setTiebreakAt < r.setGames - 1)
      c.addIssue({ code: "custom", message: "Set tiebreak starts too early" });
    if (r.requireVerified && !r.requireReferences)
      c.addIssue({
        code: "custom",
        message: "Verification requires supplied references",
      });
  });
export type LadderRules = z.infer<typeof ladderRulesSchema>;
export const defaultLadderRules = ladderRulesSchema.parse({});
const day = 86400000;
function parts(instant: number, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (name: string) =>
    Number(values.find((p) => p.type === name)?.value);
  return {
    year: get("year"),
    month: get("month"),
    date: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
function localDay(instant: number, timezone: string) {
  const p = parts(instant, timezone);
  return Date.UTC(p.year, p.month - 1, p.date);
}
export function zonedInstant(local: number, timezone: string) {
  let instant = local;
  for (let n = 0; n < 4; n++) {
    const p = parts(instant, timezone),
      actual = Date.UTC(
        p.year,
        p.month - 1,
        p.date,
        p.hour,
        p.minute,
        p.second,
      );
    instant += local - actual;
  }
  return instant;
}
export function ladderWeekClose(start: string, timezone: string, week: number) {
  if (!Number.isInteger(week) || week < 1 || week > 52)
    throw Error("Week must be between 1 and 52");
  const date = localDay(Date.parse(start), timezone) + week * 7 * day - day;
  return (
    zonedInstant(date + 23 * 3600000 + 59 * 60000 + 59 * 1000, timezone) + 999
  );
}
export function ladderWeek(instant: number, start: string, timezone: string) {
  return (
    Math.floor(
      (localDay(instant, timezone) - localDay(Date.parse(start), timezone)) /
        (7 * day),
    ) + 1
  );
}
export function nextLadderMonday(instant: number, timezone: string) {
  const local = localDay(instant, timezone),
    weekday = new Date(local).getUTCDay(),
    delta = (8 - weekday) % 7;
  let result = zonedInstant(local + delta * day, timezone);
  if (result < instant)
    result = zonedInstant(local + (delta || 7) * day, timezone);
  return result;
}
export function ladderCalendar(start: string, end: string, timezone: string) {
  const s = parts(Date.parse(start), timezone),
    e = parts(Date.parse(end), timezone);
  if (
    new Date(localDay(Date.parse(start), timezone)).getUTCDay() !== 1 ||
    s.hour !== 0 ||
    s.minute !== 0 ||
    s.second !== 0
  )
    throw Error(
      "Ladder seasons start Monday at midnight in the event timezone",
    );
  if (
    new Date(localDay(Date.parse(end), timezone)).getUTCDay() !== 0 ||
    e.hour !== 23 ||
    e.minute !== 59
  )
    throw Error(
      "Ladder seasons finish Sunday at 11:59 PM in the event timezone",
    );
  const weeks =
    (localDay(Date.parse(end), timezone) -
      localDay(Date.parse(start), timezone) +
      day) /
    (7 * day);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)
    throw Error("Use 1–52 complete ladder weeks");
  return { weeks, freezeAt: ladderWeekClose(start, timezone, weeks) };
}
export interface LadderStanding {
  teamId: string;
  position: number;
  points: number;
  played: number;
  wins: number;
  losses: number;
  walkovers: number;
  noShows: number;
  streak: number;
  declines: number;
  strikes: number;
  upwardWins: number;
  defenses: number;
  lastPlayedWeek: number;
  lastInactivityWeek: number;
}
export interface LadderMatch {
  id: string;
  winner: string;
  teamA: string;
  teamB: string;
  challengerId: string;
  defenderId: string;
  wasUpward: boolean;
  outcome: string;
  confirmed: boolean;
  reportedWeek: number;
  reportedAt: number;
  walkoverMovementApproved: boolean;
}
export interface LadderAction extends Entity {
  sequence: number;
  kind:
    | "result"
    | "decline"
    | "waive-decline"
    | "waive-strike"
    | "week-close"
    | "exemption"
    | "waive-inactivity"
    | "close"
    | "reopen"
    | "decision";
  teamId?: string;
  targetId?: string;
  rubberId?: string;
  week?: number;
  fromWeek?: number;
  throughWeek?: number;
}
function drop(order: string[], id: string, distance: number) {
  const i = order.indexOf(id);
  if (i < 0) return;
  order.splice(i, 1);
  order.splice(Math.min(i + distance, order.length), 0, id);
}
function simultaneousDrops(order: string[], ids: string[], distance: number) {
  const penalized = new Set(ids),
    moves = order
      .map((id, index) => ({ id, index }))
      .filter((p) => penalized.has(p.id)),
    remaining = order.filter((id) => !penalized.has(id));
  for (const m of moves)
    remaining.splice(Math.min(m.index + distance, remaining.length), 0, m.id);
  order.splice(0, order.length, ...remaining);
}
/** Replay immutable actions against current verified result versions. Corrections never award twice. */
export function replayLadder(
  initialOrder: string[],
  actions: LadderAction[],
  matches: LadderMatch[],
  rules: LadderRules,
) {
  if (new Set(initialOrder).size !== initialOrder.length)
    throw Error("Initial ladder contains duplicate entrants");
  if (new Set(actions.map((a) => a.sequence)).size !== actions.length)
    throw Error("Duplicate ladder sequence");
  const order = [...initialOrder],
    stats = new Map(
      initialOrder.map((teamId) => [
        teamId,
        {
          teamId,
          position: 0,
          points: 0,
          played: 0,
          wins: 0,
          losses: 0,
          walkovers: 0,
          noShows: 0,
          streak: 0,
          declines: 0,
          strikes: 0,
          upwardWins: 0,
          defenses: 0,
          lastPlayedWeek: 0,
          lastInactivityWeek: 0,
        } satisfies LadderStanding,
      ]),
    );
  const waive = (kind: string, id: string) =>
    actions.some((a) => a.kind === kind && a.targetId === id);
  const matchMap = new Map(matches.map((m) => [m.id, m])),
    seenResults = new Set<string>();
  for (const action of [...actions].sort((a, b) => a.sequence - b.sequence)) {
    if (action.kind === "decline") {
      const s = stats.get(action.teamId!);
      if (!s || waive("waive-decline", action.id)) continue;
      s.declines++;
      if (s.declines > rules.freeDeclines) {
        s.points -= rules.declinePenalty;
        if (!waive("waive-strike", action.id)) s.strikes++;
        if (s.strikes >= rules.strikesForDrop) {
          drop(order, s.teamId, rules.strikeDrop);
          s.strikes = 0;
        }
      }
    }
    if (action.kind === "result") {
      if (seenResults.has(action.rubberId!))
        throw Error("Duplicate ladder result action");
      seenResults.add(action.rubberId!);
      const m = matchMap.get(action.rubberId!);
      if (!m?.confirmed || ![m.teamA, m.teamB].includes(m.winner)) continue;
      const loser = m.winner === m.teamA ? m.teamB : m.teamA,
        w = stats.get(m.winner),
        l = stats.get(loser);
      if (!w || !l)
        throw Error("Result references an entrant outside this season");
      const outcome =
        m.outcome === "retirement" ? rules.retirementTreatment : m.outcome;
      const walkover = ["walkover", "forfeit"].includes(outcome),
        played = outcome === "played";
      if (!walkover && !played) continue;
      const wi = order.indexOf(w.teamId),
        li = order.indexOf(l.teamId);
      if (walkover) {
        w.points += rules.walkoverPoints;
        w.walkovers++;
        l.noShows++;
      }
      if (played) {
        w.played++;
        l.played++;
        w.wins++;
        l.losses++;
        w.streak++;
        l.streak = 0;
        w.lastPlayedWeek = m.reportedWeek;
        l.lastPlayedWeek = m.reportedWeek;
        w.points += rules.winPoints;
        l.points += rules.lossPoints;
        if (w.streak >= rules.streakThreshold) w.points += rules.streakBonus;
        if (wi - li >= rules.upsetGap) w.points += rules.upsetBonus;
        if (m.winner === m.challengerId && m.wasUpward) {
          w.points += rules.challengeBonus;
          w.upwardWins++;
        }
        if (m.winner === m.defenderId) {
          w.points += rules.defenseBonus;
          w.defenses++;
        }
      }
      if ((played || m.walkoverMovementApproved) && wi > li)
        [order[wi], order[li]] = [order[li], order[wi]];
    }
    if (action.kind === "week-close") {
      const week = action.week!,
        penalties: string[] = [];
      for (const id of order) {
        const s = stats.get(id)!;
        const exempt = actions.some(
          (a) =>
            a.teamId === id &&
            ((a.kind === "exemption" &&
              week >= a.fromWeek! &&
              week <= a.throughWeek!) ||
              (a.kind === "waive-inactivity" && a.targetId === action.id)),
        );
        if (exempt) {
          s.lastInactivityWeek = week;
          continue;
        }
        if (
          week - Math.max(s.lastPlayedWeek, s.lastInactivityWeek) >=
          rules.inactivityWeeks
        ) {
          penalties.push(id);
          s.lastInactivityWeek = week;
        }
      }
      simultaneousDrops(order, penalties, rules.inactivityDrop);
    }
  }
  return order.map((id, i) => ({ ...stats.get(id)!, position: i + 1 }));
}
export function pointsChampionCandidates(
  standings: LadderStanding[],
  matches: LadderMatch[],
  rules: LadderRules,
) {
  let candidates = [...standings];
  for (const key of ["points", "wins", "upwardWins"] as const) {
    if (!candidates.length) return [];
    const max = Math.max(...candidates.map((s) => s[key]));
    candidates = candidates.filter((s) => s[key] === max);
  }
  if (candidates.length > 1) {
    const ids = candidates.map((c) => c.teamId);
    const head = (id: string) =>
      matches.filter(
        (m) =>
          m.confirmed &&
          (m.outcome === "played" ||
            (m.outcome === "retirement" &&
              rules.retirementTreatment === "played")) &&
          ids.includes(m.teamA) &&
          ids.includes(m.teamB) &&
          m.winner === id,
      ).length;
    const max = Math.max(...ids.map(head));
    candidates = candidates.filter((c) => head(c.teamId) === max);
  }
  return candidates.map((c) => c.teamId);
}
export function validateLadderChallenge(input: {
  challengerId: string;
  defenderId: string;
  standings: LadderStanding[];
  active: { teamIds: string[]; state: string }[];
  matches: LadderMatch[];
  rules: LadderRules;
  now: number;
  start: string;
  freezeAt: number;
  timezone: string;
}) {
  const {
    challengerId,
    defenderId,
    standings,
    active,
    matches,
    rules,
    now,
    start,
    freezeAt,
    timezone,
  } = input;
  const challenger = standings.find((s) => s.teamId === challengerId),
    defender = standings.find((s) => s.teamId === defenderId);
  if (!challenger || !defender || challengerId === defenderId)
    throw Error("Choose another approved ladder entrant");
  if (
    now < Date.parse(start) ||
    now + rules.responseHours * 3600000 + rules.completionDays * day > freezeAt
  )
    throw Error(
      "Challenge invitations are closed; preserve the full response and completion windows before the final freeze",
    );
  if (
    active.some(
      (c) =>
        ["Pending", "Accepted", "Awaiting confirmation", "Disputed"].includes(
          c.state,
        ) && c.teamIds.some((id) => [challengerId, defenderId].includes(id)),
    )
  )
    throw Error("Each entrant may have only one active challenge");
  const upward = challenger.position > defender.position,
    distance = Math.abs(challenger.position - defender.position),
    reach =
      challenger.streak >= rules.streakThreshold
        ? rules.streakReach
        : rules.normalReach;
  if (
    upward
      ? distance > reach
      : challenger.position > rules.topDownPositions ||
        distance > rules.downwardReach
  )
    throw Error("Opponent is outside the permitted challenge range");
  const meetings = matches.filter(
    (m) =>
      m.confirmed &&
      [m.teamA, m.teamB].includes(challengerId) &&
      [m.teamA, m.teamB].includes(defenderId) &&
      (m.outcome === "played" ||
        (m.outcome === "retirement" &&
          rules.retirementTreatment === "played") ||
        (rules.walkoversCountForRematch &&
          ["forfeit", "walkover"].includes(
            m.outcome === "retirement" ? rules.retirementTreatment : m.outcome,
          ))),
  );
  const week = ladderWeek(now, start, timezone);
  if (
    meetings.length >= rules.maximumMeetings ||
    (week <= rules.earlyWeeks && meetings.length >= rules.earlyMaximumMeetings)
  )
    throw Error("Opponent match limit reached for this part of the season");
  if (meetings.some((m) => now - m.reportedAt < rules.rematchDays * day))
    throw Error(`Wait ${rules.rematchDays} days before a rematch`);
  return {
    wasUpward: upward,
    challengerPosition: challenger.position,
    defenderPosition: defender.position,
    responseDeadline: new Date(
      now + rules.responseHours * 3600000,
    ).toISOString(),
  };
}
