import { z } from "zod";
import { triaceRulesSchema } from "./triace";
import { competitionRulesSchema } from "./competition";
import {ladderRulesSchema} from "./ladder";
export * from "./triace";
export * from "./club";
export * from "./players";
export * from "./competition";
export * from "./ladder";
export * from "./courtBlocks";
export * from "./discovery";
export * from "./availability";
export type Role = "player" | "eventAdmin" | "clubAdmin" | "platformAdmin";
export const statuses = [
  "Draft",
  "Published",
  "Registration Open",
  "Registration Closed",
  "Check-In",
  "In Progress",
  "Completed",
  "Cancelled",
] as const;
export const formats = [
  "single-elimination",
  "round-robin",
  "round-robin-playoffs",
] as const;
export const registrationStates = [
  "Pending Payment",
  "Registered",
  "Waitlisted",
  "Approved",
  "Rejected",
  "Withdrawn",
  "Refunded",
  "Cancelled",
] as const;
export interface Entity {
  id: string;
  clubId: string;
  eventId?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  [key: string]: any;
}
export interface Player extends Entity {
  displayName: string;
  city: string;
  visibility: "public" | "private";
  externalRating?: number;
  singlesUtr?: number;
  doublesUtr?: number;
  ratingSource?: string;
  ratingVerifiedAt?: string;
}
export interface Event extends Entity {
  name: string;
  description: string;
  venue: string;
  location: string;
  startDate: string;
  endDate: string;
  timezone: string;
  status: (typeof statuses)[number];
  visibility: "public" | "private";
  fee: number;
  capacity: number;
  waitlist: boolean;
  registrationOpen: string;
  registrationClose: string;
  waiverRequired: boolean;
  refundPolicy: string;
  sport: string;
  organizer: string;
  questions: string[];
  assignedAdmins: string[];
  duration: number;
  buffer: number;
  courtIds: string[];
}
export interface Division extends Entity {
  name: string;
  format: (typeof formats)[number];
  capacity: number;
  fee?: number;
  minRating: number;
  maxRating: number;
  minAge: number;
  maxAge: number;
  gender: string;
  scoring: "standard" | "match-tiebreak";
  groupSize: number;
  qualifiers: number;
  tieBreakOrder: string[];
}
export interface Registration extends Entity {
  playerId: string;
  divisionId: string;
  state: (typeof registrationStates)[number];
  order: number;
  seed: number;
  checkIn: string;
  waiver: boolean;
  answers: Record<string, string>;
}
export interface Match extends Entity {
  divisionId: string;
  drawId: string;
  round: number;
  position: number;
  p1: string | null;
  p2: string | null;
  winner: string | null;
  status: string;
  nextId?: string;
  nextSlot?: "p1" | "p2";
  group?: number;
  courtId?: string;
  scheduledAt?: string;
  version: number;
}
export interface SetScore {
  a: number;
  b: number;
  tiebreakA?: number;
  tiebreakB?: number;
  matchTiebreak?: boolean;
}
export interface Score {
  winner: string;
  sets: SetScore[];
  outcome: "played" | "retirement" | "walkover" | "default";
  notes: string;
}
export interface Standing {
  playerId: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsPlayed: number;
  gamesWon: number;
  gamesPlayed: number;
  resolution: number;
  tied?: boolean;
}
export const collections = [
  "users",
  "clubs",
  "memberships",
  "venues",
  "courts",
  "courtBlocks",
  "availability",
  "events",
  "divisions",
  "registrations",
  "payments",
  "draws",
  "drawNodes",
  "matches",
  "matchResults",
  "notifications",
  "auditEvents",
  "eventTemplates",
] as const;
export const cleanText = (s: string) => s.replace(/<[^>]*>/g, "").trim();
const text = z.string().max(10000).transform(cleanText);
const tieKeys = [
  "wins",
  "head-to-head",
  "set-percentage",
  "game-percentage",
  "admin",
] as const;
export const divisionSchema = z
  .object({
    name: z.string().min(2).max(100).transform(cleanText),
    format: z.enum(formats),
    capacity: z.number().int().min(2).max(128),
    fee: z.number().int().min(0).max(100000).optional(),
    minRating: z.number().min(0).max(20).default(0),
    maxRating: z.number().min(0).max(20).default(20),
    minAge: z.number().int().min(0).max(120).default(0),
    maxAge: z.number().int().min(0).max(120).default(120),
    gender: z.enum(["Open", "Male", "Female"]).default("Open"),
    scoring: z.enum(["standard", "match-tiebreak"]).default("match-tiebreak"),
    groupSize: z.number().int().min(3).max(8).default(4),
    qualifiers: z.number().int().min(1).max(2).default(2),
    tieBreakOrder: z
      .array(z.enum(tieKeys))
      .min(1)
      .max(5)
      .default([...tieKeys]),
    eligibilityNotes: z.string().max(2000).default(""),
  })
  .refine(
    (d) =>
      d.minRating <= d.maxRating &&
      d.minAge <= d.maxAge &&
      new Set(d.tieBreakOrder).size === d.tieBreakOrder.length,
    "Invalid eligibility range or repeated tie rule",
  );
export const eventSchema = z
  .object({
    name: z.string().min(3).max(140).transform(cleanText),
    description: text,
    venue: z.string().min(2).max(160),
    location: z.string().min(2).max(160),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    timezone: z
      .string()
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Invalid IANA timezone")
      .default("America/Chicago"),
    visibility: z.enum(["public", "private"]).default("public"),
    fee: z.number().int().min(0).max(100000),
    capacity: z.number().int().min(2).max(128),
    waitlist: z.boolean(),
    registrationOpen: z.string().datetime(),
    registrationClose: z.string().datetime(),
    waiverRequired: z.boolean(),
    refundPolicy: text,
    sport: z.enum(["Tennis", "Pickleball"]).default("Tennis"),
    organizer: z.string().min(2).max(200),
    questions: z.array(z.string().max(300)).max(20).default([]),
    assignedAdmins: z
      .array(z.string().regex(/^[\w-]{1,128}$/))
      .max(20)
      .default([]),
    duration: z.number().int().min(15).max(240).default(75),
    buffer: z.number().int().min(0).max(60).default(15),
    courtIds: z
      .array(z.string().regex(/^[\w-]{1,128}$/))
      .max(20)
      .default([]),
    dailyStartHour: z.number().int().min(0).max(23).default(8),
    dailyEndHour: z.number().int().min(1).max(24).default(21),
    blackouts: z
      .array(
        z
          .object({ start: z.string().datetime(), end: z.string().datetime() })
          .refine(
            (b) => Date.parse(b.start) < Date.parse(b.end),
            "Blackout must end after start",
          ),
      )
      .max(50)
      .default([]),
    eventType: z
      .enum(["Tournament", "Round robin", "Social"])
      .default("Tournament"),
    ageGroup: z.enum(["Adult", "Junior", "All ages"]).default("All ages"),
    genderCategory: z.enum(["Open", "Male", "Female"]).default("Open"),
    divisionSummary: z.string().max(200).default("Open divisions"),
    coverPath: z.string().startsWith("covers/").max(500).optional(),
    competition: z
      .enum(["individual", "triace", "koc", "doubles", "ladder"])
      .default("individual"),
    triaceRules: triaceRulesSchema.optional(),
    teamRules: competitionRulesSchema.optional(),
    ladderRules:ladderRulesSchema.optional(),
  })
  .refine(
    (e) =>
      e.dailyEndHour > e.dailyStartHour &&
      Date.parse(e.endDate) > Date.parse(e.startDate) &&
      Date.parse(e.registrationClose) > Date.parse(e.registrationOpen) &&
      Date.parse(e.registrationClose) <= Date.parse(e.startDate),
    "Invalid event/registration dates or daily hours",
  );
export const scoreSchema = z.object({
  winner: z.string().min(1),
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
  outcome: z.enum(["played", "retirement", "walkover", "default"]),
  notes: z.string().max(1000).transform(cleanText).default(""),
});
export function canManage(
  role: Role | undefined,
  uid: string,
  event?: Partial<Event>,
) {
  if (event?.clubId && event.clubId !== "pprc") return false;
  return (
    role === "clubAdmin" ||
    (role === "eventAdmin" && !!event?.assignedAdmins?.includes(uid))
  );
}
function legalTiebreak(a: number, b: number, target: number) {
  const hi = Math.max(a, b),
    lo = Math.min(a, b);
  return hi >= target && hi - lo >= 2 && (hi === target || hi - lo === 2);
}
function completedSet(s: SetScore) {
  if (s.matchTiebreak) return legalTiebreak(s.a, s.b, 10);
  const hi = Math.max(s.a, s.b),
    lo = Math.min(s.a, s.b);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
}
export function validateScore(
  score: Score,
  p1: string,
  p2: string,
  format = "match-tiebreak",
) {
  scoreSchema.parse(score);
  if (![p1, p2].includes(score.winner))
    throw Error("Winner must be a participant");
  if (["walkover", "default"].includes(score.outcome)) {
    if (score.sets.length) throw Error("Walkovers/defaults have no sets");
    if (!score.notes.trim()) throw Error("Reason required");
    return;
  }
  if (score.outcome === "retirement" && !score.notes.trim())
    throw Error("Retirement reason required");
  let a = 0,
    b = 0;
  score.sets.forEach((s, i) => {
    if (a === 2 || b === 2) throw Error("Sets after match completed");
    const hi = Math.max(s.a, s.b),
      lo = Math.min(s.a, s.b),
      retired = score.outcome === "retirement" && i === score.sets.length - 1;
    if (s.matchTiebreak) {
      if (i !== 2 || a !== 1 || b !== 1 || format !== "match-tiebreak")
        throw Error("Invalid match tiebreak");
      if (s.tiebreakA !== undefined || s.tiebreakB !== undefined)
        throw Error("Unexpected set tiebreak points");
    } else {
      if (hi > 7) throw Error("Invalid set games");
      if (hi === 7 && lo === 6) {
        if (
          s.tiebreakA === undefined ||
          s.tiebreakB === undefined ||
          !legalTiebreak(s.tiebreakA, s.tiebreakB, 7) ||
          s.a > s.b !== s.tiebreakA > s.tiebreakB
        )
          throw Error("Invalid tiebreak");
      } else if (s.tiebreakA !== undefined || s.tiebreakB !== undefined) {
        if (!(
          retired &&
          s.a === 6 &&
          s.b === 6 &&
          s.tiebreakA !== undefined &&
          s.tiebreakB !== undefined &&
          !legalTiebreak(s.tiebreakA, s.tiebreakB, 7)
        ))
          throw Error("Unexpected tiebreak points");
      }
    }
    const complete = completedSet(s);
    if (
      !complete &&
      !(retired && (s.matchTiebreak ? hi < 10 || hi - lo < 2 : hi <= 6))
    )
      throw Error("Impossible set score");
    if (complete) {
      if (s.a > s.b) a++;
      else b++;
    }
  });
  if (score.outcome === "retirement" && (a === 2 || b === 2))
    throw Error("Completed match cannot be retired");
  if (
    score.outcome === "played" &&
    (!(a === 2 || b === 2) || (score.winner === p1 ? a !== 2 : b !== 2))
  )
    throw Error("Winner must win two sets");
}
export function eligibility(
  profile: Entity,
  division: Division,
  now = new Date(),
): string | null {
  const stamp = profile.birthDate ? Date.parse(profile.birthDate) : NaN;
  const age = Number.isFinite(stamp)
    ? Math.floor((now.getTime() - stamp) / 31557600000)
    : undefined;
  if ((division.minAge > 0 || division.maxAge < 120) && age === undefined)
    return "Date of birth required for this division";
  if (age !== undefined && (age < division.minAge || age > division.maxAge))
    return "Age outside division range";
  if (division.gender !== "Open" && profile.gender !== division.gender)
    return "Gender category does not match";
  if (
    (division.minRating > 0 || division.maxRating < 20) &&
    !Number.isFinite(profile.externalRating)
  )
    return "External reference value required";
  if (
    profile.externalRating !== undefined &&
    (profile.externalRating < division.minRating ||
      profile.externalRating > division.maxRating)
  )
    return "Reference level outside division range";
  return null;
}
export function registrationPlacement(
  active: number,
  eventActive: number,
  capacity: number,
  eventCapacity: number,
  waitlist: boolean,
) {
  if (active < capacity && eventActive < eventCapacity) return "Registered";
  if (waitlist) return "Waitlisted";
  throw Error("Division or event is full");
}
export function seedOrder(size: number) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}
export function elimination(
  players: string[],
  drawId: string,
  divisionId: string,
  clubId = "pprc",
): Match[] {
  if (players.length < 2 || new Set(players).size !== players.length)
    throw Error("At least two unique players required");
  const size = 2 ** Math.ceil(Math.log2(players.length)),
    rounds = Math.log2(size),
    out: Match[] = [];
  const order = seedOrder(size);
  for (let r = 1; r <= rounds; r++)
    for (let pos = 0; pos < size / 2 ** r; pos++)
      out.push({
        id: `${drawId}-r${r}-${pos}`,
        clubId,
        divisionId,
        drawId,
        round: r,
        position: pos,
        p1: r === 1 ? (players[order[pos * 2] - 1] ?? null) : null,
        p2: r === 1 ? (players[order[pos * 2 + 1] - 1] ?? null) : null,
        winner: null,
        status: "Scheduled",
        version: 0,
        ...(r < rounds
          ? {
              nextId: `${drawId}-r${r + 1}-${Math.floor(pos / 2)}`,
              nextSlot: pos % 2 === 0 ? ("p1" as const) : ("p2" as const),
            }
          : {}),
      });
  for (const m of out.filter((m) => m.round === 1))
    if (!m.p1 || !m.p2) {
      m.winner = m.p1 ?? m.p2;
      m.status = "Bye";
      if (m.nextId) out.find((n) => n.id === m.nextId)![m.nextSlot!] = m.winner;
    }
  return out;
}
export function advance(matches: Match[], match: Match, winner: string) {
  if (![match.p1, match.p2].includes(winner)) throw Error("Invalid winner");
  if (match.nextId) {
    const next = matches.find((m) => m.id === match.nextId);
    if (!next) throw Error("Missing next match");
    if (next.status === "Final" || next.version > 0)
      throw Error("Downstream match already scored");
    next[match.nextSlot!] = winner;
  }
  match.winner = winner;
  match.status = "Final";
}
export function roundRobin(
  players: string[],
  drawId: string,
  divisionId: string,
  group = 0,
): Match[] {
  if (players.length < 2 || new Set(players).size !== players.length)
    throw Error("Unique players required");
  const ring: (string | null)[] = [...players];
  if (ring.length % 2) ring.push(null);
  const out: Match[] = [];
  for (let r = 1; r < ring.length; r++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const p1 = ring[i],
        p2 = ring[ring.length - i - 1];
      if (p1 && p2)
        out.push({
          id: `${drawId}-g${group}-r${r}-${i}`,
          clubId: "pprc",
          divisionId,
          drawId,
          round: r,
          position: i,
          p1,
          p2,
          winner: null,
          status: "Scheduled",
          group,
          version: 0,
        });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return out;
}
export function standings(
  players: string[],
  matches: Match[],
  results: Entity[],
  order = [
    "wins",
    "head-to-head",
    "set-percentage",
    "game-percentage",
    "admin",
  ],
  resolutions: Record<string, number> = {},
): Standing[] {
  const rows = new Map<string, Standing>(
    players.map((p) => [
      p,
      {
        playerId: p,
        wins: 0,
        losses: 0,
        setsWon: 0,
        setsPlayed: 0,
        gamesWon: 0,
        gamesPlayed: 0,
        resolution: resolutions[p] ?? 0,
      },
    ]),
  );
  for (const m of matches.filter((m) => m.status === "Final" && m.winner)) {
    const a = rows.get(m.p1!),
      b = rows.get(m.p2!);
    if (!a || !b) continue;
    const aWon = m.winner === m.p1;
    a.wins += +aWon;
    b.wins += +!aWon;
    a.losses += +!aWon;
    b.losses += +aWon;
    const result = results.find(
      (r) => r.matchId === m.id && r.version === m.version,
    );
    for (const s of (result?.score?.sets ?? []) as SetScore[]) {
      if (!s.matchTiebreak) {
        a.gamesWon += s.a;
        b.gamesWon += s.b;
        a.gamesPlayed += s.a + s.b;
        b.gamesPlayed += s.a + s.b;
      }
      if (completedSet(s)) {
        a.setsWon += +(s.a > s.b);
        b.setsWon += +(s.b > s.a);
        a.setsPlayed++;
        b.setsPlayed++;
      }
    }
  }
  const ratio = (a: number, b: number) => (b ? a / b : 0);
  const compare = (a: Standing, b: Standing) => {
    for (const key of order) {
      let diff = 0;
      if (key === "wins") diff = b.wins - a.wins;
      if (
        key === "head-to-head" &&
        [...rows.values()].filter((r) => r.wins === a.wins).length === 2
      ) {
        const h = matches.find(
          (m) =>
            m.status === "Final" &&
            [m.p1, m.p2].includes(a.playerId) &&
            [m.p1, m.p2].includes(b.playerId),
        );
        diff = h?.winner ? (h.winner === a.playerId ? -1 : 1) : 0;
      }
      if (key === "set-percentage")
        diff = ratio(b.setsWon, b.setsPlayed) - ratio(a.setsWon, a.setsPlayed);
      if (key === "game-percentage")
        diff =
          ratio(b.gamesWon, b.gamesPlayed) - ratio(a.gamesWon, a.gamesPlayed);
      if (key === "admin")
        diff = a.resolution && b.resolution ? a.resolution - b.resolution : 0;
      if (diff) return diff;
    }
    return 0;
  };
  const sorted = [...rows.values()].sort(
    (a, b) => compare(a, b) || a.playerId.localeCompare(b.playerId),
  );
  for (const row of sorted)
    row.tied = sorted.some(
      (other) => other !== row && compare(row, other) === 0,
    );
  return sorted;
}
export function scheduleConflict(
  a: Partial<Match>,
  b: Partial<Match>,
  minutes: number,
) {
  return (
    !!a.scheduledAt &&
    !!b.scheduledAt &&
    Math.abs(Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)) <
      minutes * 60000 &&
    (a.courtId === b.courtId ||
      [a.p1, a.p2].some((p) => p && [b.p1, b.p2].includes(p)))
  );
}
export function withinDailyHours(
  iso: string,
  timezone: string,
  startHour: number,
  endHour: number,
  minutes: number,
) {
  const local = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    return {
      day: `${p.year}-${p.month}-${p.day}`,
      minute: Number(p.hour) * 60 + Number(p.minute),
    };
  };
  const a = local(Date.parse(iso)),
    b = local(Date.parse(iso) + minutes * 60000);
  return (
    a.minute >= startHour * 60 &&
    ((a.day === b.day && b.minute <= endHour * 60) ||
      (endHour === 24 && b.minute === 0))
  );
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [
    keys.map(escape).join(","),
    ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
  ].join("\r\n");
}

export interface Club extends Entity {
  name: string;
  timezone: string;
}
export interface Membership extends Entity {
  playerId: string;
  role: Role;
  member: boolean;
}
export interface Venue extends Entity {
  name: string;
  location: string;
}
export interface Court extends Entity {
  name: string;
  venueId: string;
  surface: string;
  active: boolean;
}
export interface Payment extends Entity {
  registrationId: string;
  playerId: string;
  amount: number;
  currency: "usd";
  state: "Pending" | "Paid" | "Refund Required" | "Refunded";
  provider: "development" | "stripe";
  stripeSessionId?: string;
  providerReference?: string;
  refundRequested?: boolean;
  refundReason?: string;
}
export interface Draw extends Entity {
  divisionId: string;
  phase: "knockout" | "groups" | "playoffs";
  players: string[];
  published: boolean;
  groups?: { players: string[] }[];
  standings?: { rows: Standing[] }[];
  resolutions?: Record<string, number>;
}
export interface DrawNode extends Entity {
  divisionId: string;
  drawId: string;
  matchId: string;
  round: number;
  position: number;
  published: boolean;
}
export interface MatchResult extends Entity {
  divisionId: string;
  drawId: string;
  matchId: string;
  score: Score;
  state: "Submitted" | "Final" | "Superseded";
  baseVersion: number;
  version: number;
  submittedBy: string;
  participants: [string, string];
  published: boolean;
  correctionRequested?: boolean;
  correctionReason?: string;
  reportingStatus: "Not Required" | "Pending" | "Submitted" | "Confirmed";
}
export interface Notification extends Entity {
  playerId: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
}
export interface AuditEvent extends Entity {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason?: string;
  requestId?: string;
}
export interface EventTemplate extends Entity {
  name: string;
  event: Partial<Event>;
  divisions: Partial<Division>[];
}
export const profileSchema = z.object({
  displayName: z.string().min(2).max(100).transform(cleanText),
  city: z.string().max(100),
  preferredSport: z.enum(["Tennis", "Pickleball"]),
  tennisLevel: z.string().max(100),
  externalRating: z.number().min(0).max(20).optional(),
  ratingSource: z.string().max(100).default("Player provided"),
  handedness: z.enum(["Right", "Left", "Ambidextrous"]),
  availability: z.string().max(500),
  emergencyContact: z.string().max(300),
  visibility: z.enum(["public", "private"]),
  notificationPreferences: z.object({ inApp: z.boolean(), push: z.boolean() }),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v &&
        Date.parse(v) <= Date.now(),
      "Valid past birth date required",
    )
    .optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  photoPath: z.string().startsWith("photos/").max(500).optional(),
});
