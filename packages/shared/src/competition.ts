import { z } from "zod";
import {
  triaceRulesSchema,
  rubberScoreSchema,
  teamStandings,
  type Team,
  type TeamLineup,
} from "./triace";
import type { Entity } from "./index";

const pairKey = z.string().regex(/^P[1-8]\+P[1-8]$/);
const optionalMinutes = z
  .number()
  .int()
  .min(0)
  .max(10080)
  .nullable()
  .default(null);
const base = triaceRulesSchema.innerType().omit({
  version: true,
  maximumPolicyConfirmed: true,
  allowedDoublesPairs: true,
  combinedMinimum: true,
  combinedMaximum: true,
});
/** Explicit PPRC team policy. KOC presets are proposals until an organizer confirms them. */
export const competitionRulesSchema = base
  .extend({
    version: z.literal(1).default(1),
    policyConfirmed: z.boolean().default(false),
    teamSize: z.number().int().min(1).max(8).default(4),
    singlesRubbers: z.number().int().min(0).max(4).default(2),
    doublesRubbers: z.number().int().min(0).max(4).default(1),
    decidingTiebreak: z.boolean().default(false),
    winsRequired: z.number().int().min(1).max(5).optional(),
    allowedDoublesPairs: z.array(pairKey).max(28).optional(),
    maxRubbersPerPlayer: z.number().int().min(1).max(9).default(9),
    tiebreakAfterOthers: z.boolean().default(true),
    groupCount: z.number().int().min(1).max(4).default(1),
    stageFormat: z
      .enum(["groups-playoffs", "round-robin", "single-elimination"])
      .default("groups-playoffs"),
    singlesParticipationPercent: z.number().min(0).max(100).default(0),
    requireAllRosterEligible: z.boolean().default(false),
    referenceMetric: z.enum(["higher", "singles", "doubles"]).default("higher"),
    requireReferences: z.boolean().default(true),
    requireVerified: z.boolean().default(false),
    membersOnly: z.boolean().default(false),
    combinedMinimum: z.number().min(0).max(160).default(0),
    combinedMaximum: z.number().min(0).max(160).nullable().default(160),
    encounterConfirmation: z.enum(["lineups", "explicit"]).default("explicit"),
    lineupDeadlineMinutes: optionalMinutes,
    resultDeadlineHours: z
      .number()
      .int()
      .min(1)
      .max(336)
      .nullable()
      .default(null),
    pointsOnly: z.boolean().default(false),
    pointsTarget: z.number().int().min(2).max(50).default(10),
    pointsWinBy: z.union([z.literal(1), z.literal(2)]).default(2),
    pointsCap: z.number().int().min(2).max(99).nullable().default(null),
    setGames: z.number().int().min(1).max(8).default(6),
    setWinBy: z.union([z.literal(1), z.literal(2)]).default(2),
    setTiebreakAt: z.number().int().min(0).max(8).nullable().default(6),
    finalSetTiebreak: z.boolean().default(false),
    decidingTiebreakTarget: z.number().int().min(2).max(50).default(10),
    noAd: z.boolean().default(true),
    standingsTieBreaks: z
      .array(z.enum(["wins", "rubber-difference", "head-to-head"]))
      .min(1)
      .max(3)
      .default(["wins", "rubber-difference"]),
  })
  .strict()
  .transform((r) => ({
    ...r,
    winsRequired:
      r.winsRequired ??
      Math.floor(
        (r.singlesRubbers + r.doublesRubbers + Number(r.decidingTiebreak)) / 2,
      ) + 1,
    allowedDoublesPairs:
      r.allowedDoublesPairs ??
      Array.from({ length: r.teamSize }, (_, i) => i + 1).flatMap((i) =>
        Array.from({ length: r.teamSize - i }, (_, j) => `P${i}+P${i + j + 1}`),
      ),
  }))
  .superRefine((r, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const total =
      r.singlesRubbers + r.doublesRubbers + Number(r.decidingTiebreak);
    if (
      !total ||
      total % 2 !== 1 ||
      r.winsRequired !== Math.floor(total / 2) + 1
    )
      issue("Use an odd number of rubbers with a majority required to win");
    if (
      r.teamSize < 2 &&
      (r.doublesRubbers || (r.decidingTiebreak && r.tiebreakPlayers === 2))
    )
      issue("Doubles requires at least two roster players");
    if (r.distinctSingles && r.singlesRubbers > r.teamSize)
      issue("Distinct singles assignments exceed the roster size");
    if (r.decidingTiebreak && r.tiebreakPlayers > r.teamSize)
      issue("Deciding lineup exceeds roster size");
    if (new Set(r.allowedDoublesPairs).size !== r.allowedDoublesPairs.length)
      issue("Repeated doubles pair");
    if (
      r.allowedDoublesPairs.some((p) => {
        const [a, b] = p.split("+").map((s) => Number(s.slice(1)));
        return a >= b || b > r.teamSize;
      })
    )
      issue("Doubles pairs must use distinct ascending roster slots");
    if (
      r.doublesRubbers &&
      (!r.allowedDoublesPairs.length ||
        (r.distinctDoubles && r.doublesRubbers > r.allowedDoublesPairs.length))
    )
      issue("Not enough authorized doubles pairs");
    if (
      r.singlesRubbers +
        2 * r.doublesRubbers +
        (r.decidingTiebreak ? r.tiebreakPlayers : 0) >
      r.teamSize * r.maxRubbersPerPlayer
    )
      issue("Player appearance limit cannot fill the encounter");
    if (r.combinedMaximum !== null && r.combinedMinimum > r.combinedMaximum)
      issue("Minimum exceeds maximum");
    if (
      !r.requireReferences &&
      (r.combinedMinimum > 0 || r.combinedMaximum !== null || r.requireVerified)
    )
      issue(
        "Unrated entrants require no combined bounds or verification requirement",
      );
    if (
      r.stageFormat === "groups-playoffs" &&
      ![2, 4, 8].includes(r.groupCount * r.qualifiersPerGroup)
    )
      issue("Playoffs require 2, 4 or 8 qualifiers");
    if (r.stageFormat === "round-robin" && r.groupCount !== 1)
      issue("Round robin uses one group");
    if (
      r.stageFormat !== "groups-playoffs" &&
      r.requireAllRosterEligible &&
      r.singlesParticipationPercent > 0
    )
      issue("Group participation qualification requires group-stage playoffs");
    if (
      r.requireAllRosterEligible &&
      r.singlesParticipationPercent > 0 &&
      !r.singlesRubbers
    )
      issue("Singles participation requires singles rubbers");
    if (
      r.pointsCap !== null &&
      r.pointsCap <
        Math.max(
          r.pointsOnly ? r.pointsTarget : 0,
          r.decidingTiebreak || r.finalSetTiebreak
            ? r.decidingTiebreakTarget
            : 0,
        )
    )
      issue("Point cap must cover the scoring targets");
    if (r.setTiebreakAt !== null && r.setTiebreakAt < r.setGames - 1)
      issue("Set tiebreak must be at the target or one game before it");
    if (new Set(r.standingsTieBreaks).size !== r.standingsTieBreaks.length)
      issue("Repeated standings tiebreak");
  });
export type CompetitionRules = z.infer<typeof competitionRulesSchema>;
export const defaultKocRules = competitionRulesSchema.parse({});
export const defaultDoublesRules = competitionRulesSchema.parse({
  teamSize: 2,
  singlesRubbers: 0,
  doublesRubbers: 1,
  groupCount: 1,
  stageFormat: "round-robin",
  rubberScoring: "best-of-three",
  finalSetTiebreak: true,
  combinedMaximum: 40,
});
export const isTeamCompetition = (event: Partial<Entity>) =>
  ["triace", "koc", "doubles", "ladder"].includes(event.competition);
export const rosterForRules = (rules: CompetitionRules) =>
  Array.from({ length: rules.teamSize }, (_, i) => `P${i + 1}`);
export const rubberKinds = (
  r: CompetitionRules,
): ("singles" | "doubles" | "tiebreak")[] => [
  ...Array.from({ length: r.singlesRubbers }, () => "singles" as const),
  ...Array.from({ length: r.doublesRubbers }, () => "doubles" as const),
  ...(r.decidingTiebreak ? ["tiebreak" as const] : []),
];
export function competitionRules(event: Entity): CompetitionRules {
  if (event.competition === "triace") {
    const {
      version: _version,
      maximumPolicyConfirmed,
      ...legacy
    } = triaceRulesSchema.parse(event.triaceRules ?? {});
    return competitionRulesSchema.parse({
      ...legacy,
      policyConfirmed: maximumPolicyConfirmed,
      teamSize: 3,
      singlesRubbers: 2,
      doublesRubbers: 2,
      decidingTiebreak: true,
      winsRequired: 3,
      stageFormat: "groups-playoffs",
      maxRubbersPerPlayer: legacy.maxRubbersPerPlayer ?? 5,
      encounterConfirmation: legacy.encounterConfirmation ?? "lineups",
    });
  }
  const r = competitionRulesSchema.parse(
    event.teamRules ??
      (event.competition === "doubles" ? defaultDoublesRules : defaultKocRules),
  );
  if (
    event.competition === "doubles" &&
    (r.teamSize !== 2 ||
      r.singlesRubbers !== 0 ||
      r.doublesRubbers !== 1 ||
      r.decidingTiebreak)
  )
    throw Error("Doubles uses a fixed pair and one doubles rubber");
  return r;
}
const lineupSchema = z
  .object({
    singles: z.array(z.string()).max(4),
    doubles: z
      .array(z.object({ players: z.array(z.string()).length(2) }).strict())
      .max(4),
    tiebreak: z.array(z.string()).max(2),
  })
  .strict();
export function validateCompetitionLineup(
  team: Team,
  input: unknown,
  r: CompetitionRules,
): TeamLineup {
  const lineup = lineupSchema.parse(input),
    slots = rosterForRules(r);
  if (
    team.roster.length !== r.teamSize ||
    new Set(team.roster.map((p) => p.playerId)).size !== r.teamSize ||
    new Set(team.roster.map((p) => p.slot)).size !== r.teamSize ||
    team.roster.some((p) => !slots.includes(p.slot))
  )
    throw Error(`${r.teamSize} distinct confirmed roster players required`);
  if (
    lineup.singles.length !== r.singlesRubbers ||
    lineup.doubles.length !== r.doublesRubbers ||
    lineup.tiebreak.length !== (r.decidingTiebreak ? r.tiebreakPlayers : 0)
  )
    throw Error("Lineup does not fill the configured rubbers");
  const roster = new Map(team.roster.map((p) => [p.playerId, p.slot]));
  const all = [
    ...lineup.singles,
    ...lineup.doubles.flatMap((p) => p.players),
    ...lineup.tiebreak,
  ];
  if (all.some((p) => !roster.has(p)))
    throw Error("Lineup contains an unauthorized roster player");
  if (
    r.distinctSingles &&
    new Set(lineup.singles).size !== lineup.singles.length
  )
    throw Error("Singles players must be distinct");
  const pairs = lineup.doubles.map((pair) => {
    if (new Set(pair.players).size !== 2)
      throw Error("A doubles pair needs two distinct players");
    const key = pair.players
      .map((p) => roster.get(p)!)
      .sort()
      .join("+");
    if (!r.allowedDoublesPairs.includes(key))
      throw Error("Doubles pair is not allowed by tournament rules");
    return key;
  });
  if (r.distinctDoubles && new Set(pairs).size !== pairs.length)
    throw Error("Doubles pairs must be distinct");
  if (new Set(lineup.tiebreak).size !== lineup.tiebreak.length)
    throw Error("Invalid deciding tiebreak lineup");
  if (
    all.some((p) => all.filter((v) => v === p).length > r.maxRubbersPerPlayer)
  )
    throw Error("Player appearance limit exceeded");
  return lineup;
}
export function competitionRatingSnapshot(
  player: Entity,
  r: CompetitionRules,
  capturedAt = new Date().toISOString(),
) {
  const value = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 20 ? v : null;
  const singles = value(player.singlesUtr ?? player.externalRating),
    doubles = value(player.doublesUtr ?? player.externalRating);
  const reference =
    r.referenceMetric === "singles"
      ? singles
      : r.referenceMetric === "doubles"
        ? doubles
        : singles !== null && doubles !== null
          ? Math.max(singles, doubles)
          : null;
  if (r.requireReferences && reference === null)
    throw Error("Required external reference ratings are missing or invalid");
  const verified = player.ratingSource === "Admin verified";
  if (r.requireVerified && !verified)
    throw Error("Admin-verified references are required");
  return {
    playerId: player.id,
    singles,
    doubles,
    reference,
    source:
      reference === null
        ? "Not provided"
        : (player.ratingSource ?? "Player provided"),
    verified,
    capturedAt,
    metric: r.referenceMetric,
  };
}
export function validateCompetitionRating(
  snapshots: ReturnType<typeof competitionRatingSnapshot>[],
  r: CompetitionRules,
): number | null {
  if (
    snapshots.length !== r.teamSize ||
    new Set(snapshots.map((s) => s.playerId)).size !== r.teamSize
  )
    throw Error(`${r.teamSize} distinct roster references required`);
  if (snapshots.some((s) => s.reference === null)) {
    if (r.requireReferences) throw Error("Every player needs a reference");
    return null;
  }
  const sum = snapshots.reduce((n, s) => n + s.reference!, 0);
  if (
    sum + 1e-10 < r.combinedMinimum ||
    (r.combinedMaximum !== null && sum - 1e-10 > r.combinedMaximum)
  )
    throw Error(
      `Combined reference outside ${r.combinedMinimum}–${r.combinedMaximum ?? "no maximum"}`,
    );
  if (r.requireVerified && snapshots.some((s) => !s.verified))
    throw Error("Admin-verified references are required");
  return Math.round(sum * 1000) / 1000;
}
const pointGame = (
  a: number,
  b: number,
  target: number,
  winBy: number,
  cap: number | null,
) => {
  const hi = Math.max(a, b),
    lo = Math.min(a, b),
    diff = hi - lo;
  if (
    cap !== null &&
    hi === cap &&
    (hi === target || lo >= cap - winBy) &&
    diff > 0
  )
    return true;
  return (
    (cap === null || hi < cap) &&
    hi >= target &&
    diff >= winBy &&
    (hi === target || (winBy > 1 && diff === winBy))
  );
};
export function validateCompetitionScore(
  input: unknown,
  rubber: Entity,
  r: CompetitionRules,
) {
  const score = rubberScoreSchema.parse(input);
  if (![rubber.teamA, rubber.teamB].includes(score.winner))
    throw Error("Winner must be one of the encounter teams");
  if (score.outcome !== "played") {
    if (!score.notes.trim() || score.sets.length)
      throw Error(
        "Exceptional outcomes require a reason without invented points",
      );
    return score;
  }
  const needed =
    rubber.kind === "tiebreak" || r.rubberScoring === "one-set" ? 1 : 2;
  let a = 0,
    b = 0;
  for (const [i, set] of score.sets.entries()) {
    if (a === needed || b === needed)
      throw Error("Points after rubber completion");
    const decidingSet = !!set.matchTiebreak;
    if (
      decidingSet &&
      !(r.finalSetTiebreak && needed === 2 && i === 2 && a === 1 && b === 1)
    )
      throw Error("A match tiebreak can replace only the deciding third set");
    if (r.pointsOnly || rubber.kind === "tiebreak" || decidingSet) {
      const target =
        rubber.kind === "tiebreak" || decidingSet
          ? r.decidingTiebreakTarget
          : r.pointsTarget;
      if (
        !pointGame(set.a, set.b, target, r.pointsWinBy, r.pointsCap) ||
        set.tiebreakA !== undefined ||
        set.tiebreakB !== undefined
      )
        throw Error(
          `Point game must reach ${target} under the configured win-by/cap rule`,
        );
    } else {
      const hi = Math.max(set.a, set.b),
        lo = Math.min(set.a, set.b),
        at = r.setTiebreakAt;
      const tb = at !== null && hi === at + 1 && lo === at;
      if (at !== null && (hi > at + 1 || lo > at))
        throw Error("Points after the configured set tiebreak");
      if (!tb && !pointGame(set.a, set.b, r.setGames, r.setWinBy, null))
        throw Error("Invalid completed set");
      if ((set.tiebreakA === undefined) !== (set.tiebreakB === undefined))
        throw Error("Both set tiebreak point scores required");
      if (
        set.tiebreakA !== undefined &&
        (!tb ||
          !pointGame(set.tiebreakA, set.tiebreakB!, 7, 2, null) ||
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

/** Reuse the shared encounter totals; organizer-selected metrics resolve sporting order. */
export function competitionStandings(
  teamIds: string[],
  encounters: Entity[],
  r: CompetitionRules,
  resolutions: Record<string, number> = {},
) {
  const rows = teamStandings(teamIds, encounters, resolutions);
  const simple = (row: (typeof rows)[number], key: string) =>
    key === "wins" ? row.wins : row.rubberDifference;
  const index = r.standingsTieBreaks.indexOf("head-to-head");
  const head = (row: (typeof rows)[number]) => {
    const cohort = rows
      .filter((other) =>
        r.standingsTieBreaks
          .slice(0, index)
          .every((key) => simple(row, key) === simple(other, key)),
      )
      .map((t) => t.teamId);
    return encounters.filter(
      (e) =>
        e.status === "Final" &&
        e.winner === row.teamId &&
        cohort.includes(e.teamA) &&
        cohort.includes(e.teamB),
    ).length;
  };
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    for (const key of r.standingsTieBreaks) {
      const delta =
        key === "head-to-head"
          ? head(b) - head(a)
          : simple(b, key) - simple(a, key);
      if (delta) return delta;
    }
    return a.resolution && b.resolution ? a.resolution - b.resolution : 0;
  };
  rows.sort((a, b) => compare(a, b) || a.teamId.localeCompare(b.teamId));
  return rows.map((row, i) => ({
    ...row,
    tied: rows.some((other, j) => i !== j && compare(row, other) === 0),
  }));
}
