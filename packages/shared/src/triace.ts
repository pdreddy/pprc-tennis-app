import { z } from "zod";
import type { Entity } from "./index";

const playerId = z.string().regex(/^[\w-]{1,120}$/);
export const rosterSlots = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
] as const;
export const triaceRulesSchema = z
  .object({
    version: z.literal(2).default(2),
    combinedMinimum: z.number().min(0).max(60).default(12),
    combinedMaximum: z.number().min(0).max(60).default(18.5),
    maximumPolicyConfirmed: z.boolean().default(false),
    groupCount: z.number().int().min(1).max(4).default(2),
    qualifiersPerGroup: z.union([z.literal(1), z.literal(2)]).default(2),
    singlesParticipationPercent: z.number().min(0).max(100).default(40),
    participationBasis: z
      .enum(["encounters", "singles-opportunities"])
      .default("encounters"),
    requireAllRosterEligible: z.boolean().default(true),
    distinctSingles: z.boolean().default(true),
    distinctDoubles: z.boolean().default(true),
    allowedDoublesPairs: z
      .array(z.enum(["P1+P2", "P1+P3", "P2+P3"]))
      .min(1)
      .max(3)
      .default(["P1+P2", "P1+P3", "P2+P3"]),
    tiebreakPlayers: z.union([z.literal(1), z.literal(2)]).default(1),
    rubberScoring: z.enum(["one-set", "best-of-three"]).default("one-set"),
    stopAtClinch: z.boolean().default(true),
    forfeitCountsForParticipation: z.boolean().default(false),
    maxRubbersPerPlayer: z.number().int().min(1).max(5).default(5),
    encounterConfirmation: z.enum(["lineups", "explicit"]).default("lineups"),
    lineupDeadlineMinutes: z
      .number()
      .int()
      .min(0)
      .max(10080)
      .nullable()
      .default(null),
    resultDeadlineHours: z
      .number()
      .int()
      .min(1)
      .max(336)
      .nullable()
      .default(null),
    requireVerified: z.boolean().default(false),
    membersOnly: z.boolean().default(false),
  })
  .superRefine((r, ctx) => {
    if (r.combinedMinimum > r.combinedMaximum)
      ctx.addIssue({ code: "custom", message: "Minimum exceeds maximum" });
    if (new Set(r.allowedDoublesPairs).size !== r.allowedDoublesPairs.length)
      ctx.addIssue({ code: "custom", message: "Repeated doubles pair" });
    if (r.distinctDoubles && r.allowedDoublesPairs.length < 2)
      ctx.addIssue({
        code: "custom",
        message: "Two distinct doubles pairs required",
      });
    const qualifiers = r.groupCount * r.qualifiersPerGroup;
    if (![2, 4, 8].includes(qualifiers))
      ctx.addIssue({
        code: "custom",
        message: "Playoffs require 2, 4 or 8 qualifiers",
      });
  });
export type TriaceRules = z.infer<typeof triaceRulesSchema>;
export const defaultTriaceRules = triaceRulesSchema.parse({});
export interface RatingSnapshot {
  playerId: string;
  singles: number;
  doubles: number;
  reference: number;
  source: string;
  verified: boolean;
  capturedAt: string;
}
export interface Team extends Entity {
  name: string;
  captainId: string;
  memberIds: string[];
  roster: {
    slot: (typeof rosterSlots)[number];
    playerId: string;
    displayName: string;
  }[];
  registrationId?: string;
  withdrawn: boolean;
}
export interface TeamEncounter extends Entity {
  teamA: string | null;
  teamB: string | null;
  phase: "groups" | "playoffs" | "ladder";
  group?: number;
  round: number;
  position: number;
  status: string;
  winner: string | null;
  winsA: number;
  winsB: number;
  version: number;
  published: boolean;
  nextId?: string;
  nextSlot?: "teamA" | "teamB";
}
export interface TeamInvitation extends Entity {
  teamId: string;
  captainId: string;
  playerId: string;
  participantIds: string[];
  slot: Exclude<(typeof rosterSlots)[number], "P1">;
  status: "Pending" | "Accepted" | "Declined" | "Revoked";
}
export interface TeamGroup extends Entity {
  name: string;
  number: number;
  teamIds: string[];
  published: boolean;
  resolutions: Record<string, number>;
  standings: ReturnType<typeof teamStandings>;
}
export interface Lineup extends Entity {
  teamId: string;
  encounterId: string;
  memberIds: string[];
  lineup: TeamLineup;
  published: boolean;
}
export interface Rubber extends Entity {
  encounterId: string;
  index: number;
  kind: "singles" | "doubles" | "tiebreak";
  teamA: string;
  teamB: string;
  playersA: string[];
  playersB: string[];
  participantIds: string[];
  status: string;
  version: number;
  winner: string | null;
  published: boolean;
  score?: RubberScore;
}
export interface RubberResult extends Entity {
  encounterId: string;
  rubberId: string;
  score: RubberScore;
  state: "Submitted" | "Disputed" | "Final" | "Superseded";
  baseVersion: number;
  submittedBy: string;
  submittedTeamId: string | null;
  participantIds: string[];
  version?: number;
  corrects?: string;
}
export interface TeamDispute extends Entity {
  encounterId: string;
  rubberId: string;
  resultId: string;
  participantIds: string[];
  status: "Open" | "Resolved";
  reason: string;
  resolution?: "uphold" | "correct";
  resolvedBy?: string;
}
export interface ExternalRatingSnapshot extends Entity, RatingSnapshot {
  teamId: string;
  registrationId: string;
}
export const teamLineupSchema = z.object({
  singles: z.array(playerId).length(2),
  // Firestore does not support arrays directly inside arrays.
  doubles: z
    .array(z.object({ players: z.array(playerId).length(2) }))
    .length(2),
  tiebreak: z.array(playerId).min(1).max(2),
});
export type TeamLineup = z.infer<typeof teamLineupSchema>;
export function validateTeamLineup(
  team: Team,
  input: unknown,
  rules: TriaceRules,
): TeamLineup {
  const lineup = teamLineupSchema.parse(input);
  if (
    team.roster.length !== 3 ||
    new Set(team.roster.map((p) => p.playerId)).size !== 3 ||
    new Set(team.roster.map((p) => p.slot)).size !== 3 ||
    team.roster.some((p) => !["P1", "P2", "P3"].includes(p.slot))
  )
    throw Error("Three confirmed roster players required");
  const slots = new Map(team.roster.map((p) => [p.playerId, p.slot]));
  const all = [
    ...lineup.singles,
    ...lineup.doubles.flatMap((p) => p.players),
    ...lineup.tiebreak,
  ];
  if (all.some((p) => !slots.has(p)))
    throw Error("Lineup contains an unauthorized roster player");
  if (rules.distinctSingles && new Set(lineup.singles).size !== 2)
    throw Error("Singles players must be distinct");
  const pairs = lineup.doubles.map((p) => {
    if (new Set(p.players).size !== 2)
      throw Error("A doubles pair needs two distinct players");
    const key = p.players
      .map((id) => slots.get(id)!)
      .sort()
      .join("+");
    if (
      !rules.allowedDoublesPairs.includes(
        key as (typeof rules.allowedDoublesPairs)[number],
      )
    )
      throw Error("Doubles pair is not allowed by tournament rules");
    return key;
  });
  if (rules.distinctDoubles && pairs[0] === pairs[1])
    throw Error("Doubles pairs must be distinct");
  if (
    lineup.tiebreak.length !== rules.tiebreakPlayers ||
    new Set(lineup.tiebreak).size !== lineup.tiebreak.length
  )
    throw Error("Invalid deciding tiebreak lineup");
  return lineup;
}
export function ratingSnapshot(
  player: Entity,
  capturedAt = new Date().toISOString(),
): RatingSnapshot {
  const singles = player.singlesUtr ?? player.externalRating;
  const doubles = player.doublesUtr ?? player.externalRating;
  if (
    ![singles, doubles].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 20,
    )
  )
    throw Error(
      "Singles and doubles reference ratings are required for every player",
    );
  return {
    playerId: player.id,
    singles,
    doubles,
    reference: Math.max(singles, doubles),
    source: player.ratingSource ?? "Player provided",
    verified: player.ratingSource === "Admin verified",
    capturedAt,
  };
}
export function validateTeamRating(
  snapshots: RatingSnapshot[],
  rules: TriaceRules,
) {
  if (
    snapshots.length !== 3 ||
    new Set(snapshots.map((p) => p.playerId)).size !== 3
  )
    throw Error("Three distinct player references required");
  const combined =
    Math.round(snapshots.reduce((sum, p) => sum + p.reference, 0) * 1000) /
    1000;
  if (combined < rules.combinedMinimum || combined > rules.combinedMaximum)
    throw Error(
      `Combined reference ${combined} is outside ${rules.combinedMinimum}–${rules.combinedMaximum}`,
    );
  return combined;
}
export const rubberScoreSchema = z.object({
  winner: playerId,
  sets: z
    .array(
      z.object({
        a: z.number().int().min(0).max(99),
        b: z.number().int().min(0).max(99),
        tiebreakA: z.number().int().min(0).max(99).optional(),
        tiebreakB: z.number().int().min(0).max(99).optional(),
        matchTiebreak: z.boolean().optional(),
      }),
    )
    .max(3),
  outcome: z
    .enum(["played", "forfeit", "walkover", "retirement"])
    .default("played"),
  notes: z.string().max(1000).default(""),
});
export type RubberScore = z.infer<typeof rubberScoreSchema>;
const completeTiebreak = (a: number, b: number, target: number) =>
  Math.max(a, b) >= target &&
  Math.abs(a - b) >= 2 &&
  (Math.max(a, b) === target || Math.abs(a - b) === 2);
export function validateRubberScore(
  input: unknown,
  rubber: Entity,
  rules: TriaceRules,
): RubberScore {
  const score = rubberScoreSchema.parse(input);
  if (![rubber.teamA, rubber.teamB].includes(score.winner))
    throw Error("Winner must be one of the encounter teams");
  if (score.outcome !== "played") {
    if (!score.notes.trim())
      throw Error("A forfeit, walkover or retirement requires a reason");
    if (score.sets.length)
      throw Error(
        "Exceptional outcomes record a reason without invented points",
      );
    return score;
  }
  const needed =
    rubber.kind === "tiebreak" || rules.rubberScoring === "one-set" ? 1 : 2;
  let a = 0,
    b = 0;
  for (const set of score.sets) {
    if (set.matchTiebreak)
      throw Error(
        "TRIACE rubbers use full sets or the separate deciding tiebreak",
      );
    if (a === needed || b === needed)
      throw Error("Points after rubber completion");
    if (rubber.kind === "tiebreak") {
      if (
        !completeTiebreak(set.a, set.b, 10) ||
        set.tiebreakA !== undefined ||
        set.tiebreakB !== undefined
      )
        throw Error("Deciding super tiebreak must reach 10, win by two");
    } else {
      const hi = Math.max(set.a, set.b),
        lo = Math.min(set.a, set.b);
      if (!((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6))))
        throw Error("Invalid completed set");
      if ((set.tiebreakA === undefined) !== (set.tiebreakB === undefined))
        throw Error("Both set tiebreak point scores required");
      if (
        set.tiebreakA !== undefined &&
        (!(hi === 7 && lo === 6) ||
          !completeTiebreak(set.tiebreakA, set.tiebreakB!, 7) ||
          set.a > set.b !== set.tiebreakA > set.tiebreakB!)
      )
        throw Error("Invalid set tiebreak");
    }
    if (set.a > set.b) a++;
    else b++;
  }
  if (
    Math.max(a, b) !== needed ||
    (a > b ? rubber.teamA : rubber.teamB) !== score.winner
  )
    throw Error("Completed score must agree with winner");
  return score;
}
export function singlesParticipation(
  playerId: string,
  teamId: string,
  encounters: Entity[],
  rubbers: Entity[],
  rules: Pick<
    TriaceRules,
    | "participationBasis"
    | "singlesParticipationPercent"
    | "forfeitCountsForParticipation"
  > & { singlesRubbers?: number },
) {
  const completed = encounters.filter(
    (e) =>
      e.phase === "groups" &&
      e.status === "Final" &&
      [e.teamA, e.teamB].includes(teamId),
  );
  const ids = new Set(completed.map((e) => e.id));
  const appearances = rubbers.filter(
    (r) =>
      ids.has(r.encounterId) &&
      r.kind === "singles" &&
      r.status === "Final" &&
      (r.playersA ?? []).concat(r.playersB ?? []).includes(playerId) &&
      (r.outcome === "played" ||
        r.outcome === "retirement" ||
        rules.forfeitCountsForParticipation),
  ).length;
  const denominator =
    completed.length *
    (rules.participationBasis === "singles-opportunities"
      ? (rules.singlesRubbers ?? 2)
      : 1);
  const percent = denominator ? (appearances / denominator) * 100 : 0;
  return {
    playerId,
    appearances,
    opportunities: denominator,
    percent,
    eligible:
      rules.singlesParticipationPercent === 0 ||
      (denominator > 0 && percent + 1e-9 >= rules.singlesParticipationPercent),
  };
}
export function teamStandings(
  teamIds: string[],
  encounters: Entity[],
  resolutions: Record<string, number> = {},
) {
  const rows = teamIds.map((teamId) => {
    const games = encounters.filter(
      (e) => e.status === "Final" && [e.teamA, e.teamB].includes(teamId),
    );
    return {
      teamId,
      played: games.length,
      wins: games.filter((e) => e.winner === teamId).length,
      rubberDifference: games.reduce(
        (sum, e) =>
          sum + (e.teamA === teamId ? e.winsA - e.winsB : e.winsB - e.winsA),
        0,
      ),
      resolution: resolutions[teamId] ?? 0,
      tied: false,
    };
  });
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.wins - a.wins ||
    b.rubberDifference - a.rubberDifference ||
    (a.resolution && b.resolution ? a.resolution - b.resolution : 0);
  rows.sort((a, b) => compare(a, b) || a.teamId.localeCompare(b.teamId));
  for (let i = 0; i < rows.length; i++)
    rows[i].tied = rows.some((r, j) => i !== j && compare(rows[i], r) === 0);
  return rows;
}
