import { serverNow } from "./clock.js";
import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import {
  ladderRulesSchema,
  ladderCalendar,
  ladderWeek,
  ladderWeekClose,
  replayLadder,
  pointsChampionCandidates,
  validateLadderChallenge,
  elimination,
  cleanText,
  type LadderAction,
  type LadderMatch,
  type LadderStanding,
  type Entity,
} from "@pprc/shared";
import type { TriaceContext } from "./triace.js";
export const ladderCollections = ["ladderChallenges", "ladderLedger"] as const;
const id = z.string().regex(/^[\w-]{1,120}$/),
  day = 86400000;
const fail = (
  message: string,
  code: "permission-denied" | "failed-precondition" = "failed-precondition",
): never => {
  throw new HttpsError(code, message);
};
const baseInput = z.object({
  requestId: z.string().uuid(),
  eventId: id,
  action: z.string(),
});
const parse = <T extends z.ZodRawShape>(c: TriaceContext, shape: T) =>
  baseInput.extend(shape).strict().parse(c.data);
const state = (c: TriaceContext) => c.event.ladderState ?? {};
const save = (c: TriaceContext, fields: any) =>
  c.edit("events", c.event, { ladderState: { ...state(c), ...fields } });
const team = (c: TriaceContext, teamId: string) => c.find("teams", teamId);
const notifyTeam = (
  c: TriaceContext,
  teamId: string,
  title: string,
  body = c.event.name,
) => {
  for (const uid of team(c, teamId).memberIds)
    c.notify(uid, title, body, "ladder");
};
const manager = (c: TriaceContext) => {
  if (!c.manager)
    fail("Assigned organizer access required", "permission-denied");
};
const captain = (c: TriaceContext, teamId: string) => {
  const t = team(c, teamId);
  if (t.captainId !== c.uid)
    fail("Entrant captain access required", "permission-denied");
  return t;
};
function append(
  c: TriaceContext,
  kind: LadderAction["kind"],
  fields: any = {},
  key?: string,
) {
  const sequence = (state(c).sequence ?? 0) + 1;
  const affected = fields.teamId ? [fields.teamId] : (fields.teamIds ?? []);
  const participantIds = [
    ...new Set(affected.flatMap((t: string) => team(c, t).memberIds)),
  ];
  const row = c.make(
    "ladderLedger",
    {
      kind,
      sequence,
      recordedAt: new Date(serverNow()).toISOString(),
      participantIds,
      ...fields,
    },
    key,
  );
  save(c, { sequence });
  return row;
}
function matches(c: TriaceContext): LadderMatch[] {
  const reports = c.list("ladderLedger").filter((a) => a.kind === "result");
  return c
    .list("ladderChallenges")
    .filter((ch) => ch.encounterId)
    .map((ch) => {
      const r = c.list("rubbers").find((r) => r.encounterId === ch.encounterId),
        report = reports.find((a) => a.rubberId === r?.id);
      return {
        id: r?.id ?? ch.id,
        winner: r?.winner,
        teamA: r?.teamA ?? ch.challengerId,
        teamB: r?.teamB ?? ch.defenderId,
        challengerId: ch.challengerId,
        defenderId: ch.defenderId,
        wasUpward: ch.wasUpward,
        outcome: r?.outcome ?? r?.score?.outcome ?? "",
        confirmed: r?.status === "Final",
        reportedWeek: report?.week ?? 0,
        reportedAt: Date.parse(report?.reportedAt ?? ""),
        walkoverMovementApproved: ch.walkoverMovementApproved === true,
      };
    });
}
function rebuild(c: TriaceContext) {
  if (!state(c).started) return;
  const r = ladderRulesSchema.parse(c.event.ladderRules),
    standings = replayLadder(
      state(c).initialOrder,
      c.list("ladderLedger") as LadderAction[],
      matches(c),
      r,
    );
  save(c, { standings });
}
function close(c: TriaceContext) {
  if (state(c).frozen) return;
  rebuild(c);
  const meta = state(c),
    r = ladderRulesSchema.parse(c.event.ladderRules);
  const pending =
    c
      .list("teamEncounters")
      .filter((e) => e.phase === "ladder")
      .some((e) =>
        c
          .list("rubbers")
          .some(
            (b) =>
              b.encounterId === e.id &&
              (b.status === "Awaiting confirmation" || b.disputed),
          ),
      ) || c.list("disputes").some((d) => d.status === "Open");
  const candidates = pointsChampionCandidates(meta.standings, matches(c), r),
    ladderChampionTeamId = pending ? null : (meta.standings[0]?.teamId ?? null),
    pointsChampionTeamId =
      !pending && candidates.length === 1 ? candidates[0] : null;
  append(c, "close", {
    standings: meta.standings,
    ladderChampionTeamId,
    pointsChampionTeamId,
    pendingReview: pending,
  });
  save(c, {
    frozen: true,
    reviewHold: false,
    frozenAt: new Date(serverNow()).toISOString(),
    pendingReview: pending,
    ladderChampionTeamId,
    ladderRunnerUpTeamId: pending ? null : (meta.standings[1]?.teamId ?? null),
    pointsChampionTeamId,
    pointsChampionCandidates: candidates,
  });
  c.edit("events", c.event, { status: "Completed" });
  for (const t of meta.initialOrder)
    notifyTeam(
      c,
      t,
      pending
        ? "Ladder season frozen for review"
        : "Ladder season rankings frozen",
    );
}
/** Same transaction as scoring/registration; time is always read on the trusted server. */
export function tickLadder(c: TriaceContext, autoClose = true) {
  if (!state(c).started || state(c).frozen) return;
  const calendar = ladderCalendar(
      c.event.startDate,
      c.event.endDate,
      c.event.timezone,
    ),
    now = serverNow();
  const due: { at: number; kind: string; row?: Entity; week?: number }[] = [];
  for (const ch of c.list("ladderChallenges")) {
    if (ch.state === "Pending" && Date.parse(ch.responseDeadline) <= now)
      due.push({
        at: Date.parse(ch.responseDeadline),
        kind: "decline",
        row: ch,
      });
    if (ch.state === "Accepted" && Date.parse(ch.completionDeadline) <= now)
      due.push({
        at: Date.parse(ch.completionDeadline),
        kind: "expire",
        row: ch,
      });
  }
  for (let week = 1; week <= calendar.weeks; week++)
    if (
      ladderWeekClose(c.event.startDate, c.event.timezone, week) <= now &&
      !c
        .list("ladderLedger")
        .some((a) => a.kind === "week-close" && a.week === week)
    )
      due.push({
        at: ladderWeekClose(c.event.startDate, c.event.timezone, week),
        kind: "week",
        week,
      });
  for (const item of due.sort(
    (a, b) =>
      a.at - b.at ||
      String(a.row?.id ?? a.week).localeCompare(String(b.row?.id ?? b.week)),
  )) {
    if (item.kind === "week")
      append(
        c,
        "week-close",
        { week: item.week },
        `${c.event.id}-week-${item.week}`,
      );
    if (item.kind === "decline") {
      const ch = c.find("ladderChallenges", item.row!.id);
      c.edit("ladderChallenges", ch, {
        state: "Declined",
        decision: "Response deadline expired",
      });
      append(
        c,
        "decline",
        {
          teamId: ch.defenderId,
          challengeId: ch.id,
          effectiveAt: new Date(item.at).toISOString(),
        },
        `decline-${ch.id}`,
      );
      notifyTeam(c, ch.defenderId, "Challenge response expired");
      notifyTeam(c, ch.challengerId, "Challenge declined");
    }
    if (item.kind === "expire") {
      const ch = c.find("ladderChallenges", item.row!.id),
        e = c.find("teamEncounters", ch.encounterId);
      const pending = c
        .list("rubberResults")
        .some(
          (result) =>
            result.encounterId === e.id &&
            ["Submitted", "Disputed"].includes(result.state),
        );
      if (pending) {
        c.edit("ladderChallenges", ch, {
          state: "Awaiting confirmation",
          overdueConfirmation: true,
        });
        continue;
      }
      c.edit("ladderChallenges", ch, { state: "Expired" });
      c.edit("teamEncounters", e, { status: "Expired" });
      for (const rubber of c
        .list("rubbers")
        .filter((b) => b.encounterId === e.id && b.status === "Scheduled"))
        c.edit("rubbers", rubber, { status: "Expired" });
      for (const t of ch.teamIds)
        notifyTeam(c, t, "Challenge completion deadline expired");
    }
  }
  rebuild(c);
  if (autoClose && !state(c).reviewHold && now >= calendar.freezeAt) close(c);
}
export function reconcileLadder(c: TriaceContext) {
  if (!state(c).started) return;
  for (const ch of c.list("ladderChallenges").filter((ch) => ch.encounterId)) {
    const e = c.find("teamEncounters", ch.encounterId),
      rubber = c.list("rubbers").find((r) => r.encounterId === e.id);
    if (!rubber) continue;
    const reported = c
      .list("rubberResults")
      .some(
        (r) =>
          r.rubberId === rubber.id &&
          ["Submitted", "Disputed", "Final"].includes(r.state),
      );
    if (
      reported &&
      !c
        .list("ladderLedger")
        .some((a) => a.kind === "result" && a.rubberId === rubber.id)
    )
      append(
        c,
        "result",
        {
          rubberId: rubber.id,
          challengeId: ch.id,
          teamIds: ch.teamIds,
          reportedAt: new Date(serverNow()).toISOString(),
          week: ladderWeek(serverNow(), c.event.startDate, c.event.timezone),
        },
        `result-${rubber.id}`,
      );
    const status = rubber.disputed
      ? "Disputed"
      : rubber.status === "Final"
        ? "Final"
        : rubber.status === "Awaiting confirmation"
          ? "Awaiting confirmation"
          : ch.state;
    if (status !== ch.state || (rubber.status === "Final" && !ch.completedAt))
      c.edit("ladderChallenges", ch, {
        state: status,
        ...(rubber.status === "Final" && !ch.completedAt
          ? { completedAt: new Date(serverNow()).toISOString() }
          : {}),
      });
  }
  rebuild(c);
}
export function validateLadderTeamOperation(c: TriaceContext) {
  const a = c.data.action,
    roster = [
      "createTeam",
      "invitePlayer",
      "respondInvitation",
      "revokeInvitation",
      "registerTeam",
      "approveTeam",
      "withdrawTeam",
    ];
  if (
    a === "configure" ||
    [
      "assignGroups",
      "generateFixtures",
      "generateTeamPlayoffs",
      "resolveTeamTies",
    ].includes(a)
  )
    fail("Use ladder season controls for this operation");
  if (!ladderRulesSchema.parse(c.event.ladderRules).policyConfirmed)
    fail("Organizer must review and confirm the ladder policy");
  if (state(c).started && roster.includes(a))
    fail("Season rosters and partnerships are locked");
  tickLadder(c);
  const resultId = c.data.resultId,
    disputeId = c.data.disputeId;
  const res = resultId
    ? c.list("rubberResults").find((r) => r.id === resultId)
    : undefined;
  const dispute = disputeId
    ? c.list("disputes").find((d) => d.id === disputeId)
    : undefined;
  const rubber = c
    .list("rubbers")
    .find(
      (r) => r.id === (c.data.rubberId ?? res?.rubberId ?? dispute?.rubberId),
    );
  const encounterId = c.data.encounterId ?? rubber?.encounterId;
  const e = encounterId
    ? c.list("teamEncounters").find((e) => e.id === encounterId)
    : undefined;
  if (e?.phase === "ladder") {
    if (state(c).frozen)
      fail(
        "Season rankings are frozen; an organizer must reopen review before changing a season result",
      );
    const ch = c.list("ladderChallenges").find((ch) => ch.encounterId === e.id);
    if (
      a === "submitRubberScore" &&
      ch &&
      serverNow() > Date.parse(ch.completionDeadline)
    ) {
      if (!c.manager) fail("Challenge score submission deadline passed");
      c.reason();
    }
  }
}
export async function executeLadder(
  c: TriaceContext,
  system = false,
): Promise<any> {
  if (c.event.competition !== "ladder") fail("Choose a ladder season");
  if (c.role === "platformAdmin")
    fail("Support role is read only", "permission-denied");
  if (
    !system &&
    c.event.visibility === "private" &&
    !c.clubMember &&
    !c.manager
  )
    fail("Club membership required", "permission-denied");
  const r = ladderRulesSchema.parse(c.event.ladderRules),
    calendar = ladderCalendar(
      c.event.startDate,
      c.event.endDate,
      c.event.timezone,
    ),
    now = serverNow();
  if (c.data.action !== "tick" || !system) {
    if (c.event.status === "Draft" && !c.manager)
      fail("Season is not published", "permission-denied");
  }
  if (c.event.status === "Cancelled") fail("Cancelled seasons are locked");
  const active = () => {
    if (!state(c).started) fail("Organizer must start the ladder first");
    if (state(c).frozen) fail("Season rankings are frozen");
  };
  if (
    !["configure", "start", "close", "reopen", "tick"].includes(c.data.action)
  )
    tickLadder(c);
  switch (c.data.action) {
    case "configure": {
      const data = parse(c, {
        rules: ladderRulesSchema,
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      if (state(c).started || c.list("teams").length)
        fail("Ladder policy locks after entry creation");
      c.edit("events", c.event, {
        ladderRules: data.rules,
        formatLabel: `${data.rules.entryKind === "doubles" ? "Doubles" : "Singles"} ladder`,
      });
      return { status: "Configured" };
    }
    case "start": {
      parse(c, {});
      manager(c);
      if (state(c).started) fail("Season already started");
      if (!r.policyConfirmed) fail("Review the ladder policy first");
      if (
        now < Date.parse(c.event.startDate) ||
        now >= calendar.freezeAt ||
        now < Date.parse(c.event.registrationClose)
      )
        fail("Start after registration closes, during the season window");
      if (
        c
          .list("registrations")
          .some((reg) => ["Pending Payment", "Registered"].includes(reg.state))
      )
        fail("Resolve every payment and pending approval first");
      const regs = c
        .list("registrations")
        .filter(
          (reg) =>
            reg.kind === "team" &&
            reg.state === "Approved" &&
            !team(c, reg.teamId).withdrawn,
        )
        .sort(
          (a, b) =>
            (a.seed || 999) - (b.seed || 999) ||
            (b.combinedReference ?? -1) - (a.combinedReference ?? -1) ||
            a.id.localeCompare(b.id),
        );
      if (regs.length < 2 || regs.length > 32)
        fail("Use 2–32 approved ladder entries");
      if (regs.some((reg) => reg.combinedReference === null && !reg.seed))
        fail("Organizer seeding is required for unrated entries");
      if (r.playoffQualifiers > regs.length)
        fail("Playoff qualifiers exceed the approved field");
      save(c, {
        started: true,
        frozen: false,
        reviewHold: false,
        sequence: 0,
        initialOrder: regs.map((reg) => reg.teamId),
        standings: [],
        startedAt: new Date(now).toISOString(),
        freezeAt: new Date(calendar.freezeAt).toISOString(),
        weeks: calendar.weeks,
      });
      rebuild(c);
      c.edit("events", c.event, { status: "In Progress" });
      for (const reg of regs)
        notifyTeam(c, reg.teamId, "Ladder season started");
      return { status: "Started" };
    }
    case "challenge": {
      const data = parse(c, { teamId: id, opponentId: id });
      active();
      captain(c, data.teamId);
      const validation = validateLadderChallenge({
        challengerId: data.teamId,
        defenderId: data.opponentId,
        standings: state(c).standings,
        active: c.list("ladderChallenges").map((ch) => ({
          teamIds: ch.teamIds,
          state: ch.completedAt ? "Final" : ch.state,
        })),
        matches: matches(c),
        rules: r,
        now,
        start: c.event.startDate,
        freezeAt: calendar.freezeAt,
        timezone: c.event.timezone,
      });
      const teamIds = [data.teamId, data.opponentId],
        participantIds = teamIds.flatMap((id) => team(c, id).memberIds);
      const ch = c.make("ladderChallenges", {
        challengerId: data.teamId,
        defenderId: data.opponentId,
        teamIds,
        participantIds,
        state: "Pending",
        ...validation,
        issuedAt: new Date(now).toISOString(),
      });
      notifyTeam(c, data.opponentId, "A ladder challenge needs your response");
      return { challengeId: ch.id };
    }
    case "respond": {
      const data = parse(c, {
        challengeId: id,
        accepted: z.boolean(),
        reason: z.string().max(500).optional(),
      });
      active();
      const ch = c.find("ladderChallenges", data.challengeId);
      captain(c, ch.defenderId);
      if (ch.state !== "Pending") fail("Challenge already answered or expired");
      if (!data.accepted) {
        c.edit("ladderChallenges", ch, {
          state: "Declined",
          decision: cleanText(data.reason ?? "Declined"),
        });
        append(
          c,
          "decline",
          { teamId: ch.defenderId, challengeId: ch.id },
          `decline-${ch.id}`,
        );
        rebuild(c);
        notifyTeam(c, ch.challengerId, "Ladder challenge declined");
        return { status: "Declined" };
      }
      if (now + r.completionDays * day > calendar.freezeAt)
        fail(
          `Acceptance closed ${r.completionDays} days before the final freeze`,
        );
      const a = team(c, ch.challengerId),
        b = team(c, ch.defenderId),
        encounterId = `ladder-${ch.id}`;
      const e = c.make(
        "teamEncounters",
        {
          teamA: a.id,
          teamB: b.id,
          phase: "ladder",
          round: ladderWeek(now, c.event.startDate, c.event.timezone),
          position: 0,
          eventName: c.event.name,
          timezone: c.event.timezone,
          status: "Ready",
          winner: null,
          winsA: 0,
          winsB: 0,
          version: 0,
          published: true,
          confirmedTeamIds: [a.id, b.id],
          confirmationBasis: "Accepted fixed-roster challenge",
        },
        encounterId,
      );
      for (const t of [a, b])
        c.make(
          "lineups",
          {
            teamId: t.id,
            encounterId: e.id,
            memberIds: t.memberIds,
            published: true,
            lineup: {
              singles: r.entryKind === "singles" ? t.memberIds : [],
              doubles:
                r.entryKind === "doubles" ? [{ players: t.memberIds }] : [],
              tiebreak: [],
            },
          },
          `${e.id}-${t.id}`,
        );
      c.make(
        "rubbers",
        {
          encounterId: e.id,
          index: 0,
          competition: "ladder",
          kind: r.entryKind,
          teamA: a.id,
          teamB: b.id,
          playersA: a.memberIds,
          playersB: b.memberIds,
          participantIds: [...a.memberIds, ...b.memberIds],
          status: "Scheduled",
          winner: null,
          version: 0,
          published: true,
        },
        `${e.id}-rubber-0`,
      );
      c.edit("ladderChallenges", ch, {
        state: "Accepted",
        encounterId: e.id,
        acceptedAt: new Date(now).toISOString(),
        completionDeadline: new Date(
          now + r.completionDays * day,
        ).toISOString(),
      });
      notifyTeam(c, a.id, "Ladder challenge accepted");
      return { status: "Accepted", encounterId: e.id };
    }
    case "proposeSchedule": {
      const data = parse(c, {
        challengeId: id,
        teamId: id,
        scheduledAt: z.string().datetime(),
        location: z.string().trim().min(2).max(200),
      });
      active();
      const ch = c.find("ladderChallenges", data.challengeId);
      captain(c, data.teamId);
      if (!ch.teamIds.includes(data.teamId))
        fail("Challenge participant required", "permission-denied");
      if (ch.state !== "Accepted")
        fail("Choose an accepted, unscored challenge");
      const at = Date.parse(data.scheduledAt);
      if (
        at < now ||
        at + c.event.duration * 60000 > Date.parse(ch.completionDeadline)
      )
        fail("Arrange play within the accepted challenge completion window");
      c.edit("ladderChallenges", ch, {
        scheduleProposal: {
          teamId: data.teamId,
          scheduledAt: data.scheduledAt,
          location: cleanText(data.location),
        },
      });
      notifyTeam(
        c,
        ch.teamIds.find((id: string) => id !== data.teamId),
        "Confirm a proposed ladder match time",
      );
      return { status: "Proposed" };
    }
    case "confirmSchedule": {
      const data = parse(c, { challengeId: id, teamId: id });
      active();
      const ch = c.find("ladderChallenges", data.challengeId);
      captain(c, data.teamId);
      const proposal = ch.scheduleProposal;
      if (
        ch.state !== "Accepted" ||
        !proposal ||
        !ch.teamIds.includes(data.teamId) ||
        proposal.teamId === data.teamId
      )
        fail(
          "Opposing entrant must confirm the proposed time",
          "permission-denied",
        );
      if (
        Date.parse(proposal.scheduledAt) < now ||
        Date.parse(proposal.scheduledAt) + c.event.duration * 60000 >
          Date.parse(ch.completionDeadline)
      )
        fail("Proposed schedule is no longer valid");
      const e = c.find("teamEncounters", ch.encounterId);
      c.edit("teamEncounters", e, {
        scheduledAt: proposal.scheduledAt,
        location: proposal.location,
        courtId: null,
      });
      c.edit("ladderChallenges", ch, {
        confirmedSchedule: proposal,
        scheduleProposal: null,
      });
      for (const t of ch.teamIds)
        notifyTeam(c, t, "Ladder match time confirmed");
      return { status: "Scheduled" };
    }
    case "waiveDecline":
    case "waiveStrike":
    case "waiveInactivity": {
      const data = parse(c, {
        ledgerId: id,
        teamId: id,
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      active();
      const target = c.find("ladderLedger", data.ledgerId),
        kind =
          c.data.action === "waiveDecline"
            ? "waive-decline"
            : c.data.action === "waiveStrike"
              ? "waive-strike"
              : "waive-inactivity";
      if (
        !state(c).initialOrder.includes(data.teamId) ||
        (kind === "waive-inactivity"
          ? target.kind !== "week-close"
          : target.kind !== "decline" || target.teamId !== data.teamId)
      )
        fail("Choose the affected entrant's decline or weekly action");
      if (
        c
          .list("ladderLedger")
          .some(
            (a) =>
              a.kind === kind &&
              a.targetId === target.id &&
              a.teamId === data.teamId,
          )
      )
        fail("This penalty is already waived");
      append(c, kind, {
        teamId: data.teamId,
        targetId: target.id,
        reason: data.reason,
      });
      rebuild(c);
      notifyTeam(c, data.teamId, "Organizer reviewed a ladder penalty");
      return { status: "Waived" };
    }
    case "exemption": {
      const data = parse(c, {
        teamId: id,
        fromWeek: z.number().int().min(1).max(calendar.weeks),
        throughWeek: z.number().int().min(1).max(calendar.weeks),
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      active();
      if (
        !state(c).initialOrder.includes(data.teamId) ||
        data.fromWeek > data.throughWeek
      )
        fail("Choose an entrant and valid exemption weeks");
      append(c, "exemption", {
        teamId: data.teamId,
        fromWeek: data.fromWeek,
        throughWeek: data.throughWeek,
        reason: data.reason,
      });
      rebuild(c);
      notifyTeam(c, data.teamId, "Ladder inactivity exemption recorded");
      return { status: "Recorded" };
    }
    case "walkoverMovement": {
      const data = parse(c, {
        challengeId: id,
        approved: z.boolean(),
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      active();
      const ch = c.find("ladderChallenges", data.challengeId),
        r = c.list("rubbers").find((b) => b.encounterId === ch.encounterId);
      if (
        !ch.acceptedAt ||
        r?.status !== "Final" ||
        !["forfeit", "walkover"].includes(r.outcome)
      )
        fail("Choose a verified walkover on an accepted challenge");
      c.edit("ladderChallenges", ch, {
        walkoverMovementApproved: data.approved,
        walkoverMovementReason: data.reason,
      });
      append(c, "decision", {
        teamIds: ch.teamIds,
        challengeId: ch.id,
        reason: data.reason,
        walkoverMovementApproved: data.approved,
      });
      rebuild(c);
      return { status: "Recorded" };
    }
    case "cancelChallenge": {
      const data = parse(c, {
        challengeId: id,
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      active();
      const ch = c.find("ladderChallenges", data.challengeId);
      if (["Cancelled", "Declined"].includes(ch.state))
        fail("Challenge is already closed");
      if (ch.encounterId) {
        const e = c.find("teamEncounters", ch.encounterId);
        if (c.list("teamEncounters").some((e) => e.phase === "playoffs"))
          fail("Playoff qualification locks season corrections");
        c.edit("teamEncounters", e, {
          status: "Cancelled",
          winner: null,
          winsA: 0,
          winsB: 0,
          version: e.version + 1,
        });
        for (const b of c.list("rubbers").filter((b) => b.encounterId === e.id))
          c.edit("rubbers", b, { status: "Cancelled", version: b.version + 1 });
        for (const result of c
          .list("rubberResults")
          .filter(
            (result) =>
              result.encounterId === e.id && result.state !== "Superseded",
          ))
          c.edit("rubberResults", result, {
            state: "Superseded",
            voidReason: data.reason,
          });
        for (const d of c
          .list("disputes")
          .filter((d) => d.encounterId === e.id && d.status === "Open"))
          c.edit("disputes", d, {
            status: "Resolved",
            resolutionReason: data.reason,
            resolvedBy: c.uid,
          });
      }
      c.edit("ladderChallenges", ch, {
        state: "Cancelled",
        cancellationReason: data.reason,
      });
      append(c, "decision", {
        teamIds: ch.teamIds,
        challengeId: ch.id,
        reason: data.reason,
        cancelled: true,
      });
      rebuild(c);
      return { status: "Cancelled" };
    }
    case "close":
      parse(c, {});
      manager(c);
      tickLadder(c, false);
      if (now < calendar.freezeAt)
        fail("Final rankings freeze at the final Sunday 11:59 PM");
      close(c);
      return { status: "Frozen" };
    case "reopen": {
      const data = parse(c, { reason: z.string().min(5).max(1000) });
      manager(c);
      if (!state(c).frozen) fail("Season is not frozen");
      if (c.list("teamEncounters").some((e) => e.phase === "playoffs"))
        fail("Playoff qualification locks season corrections");
      append(c, "reopen", { reason: data.reason });
      save(c, {
        frozen: false,
        reviewHold: true,
        pendingReview: true,
        ladderChampionTeamId: null,
        pointsChampionTeamId: null,
      });
      c.edit("events", c.event, { status: "In Progress" });
      return { status: "Reopened for review" };
    }
    case "decidePointsChampion": {
      const data = parse(c, {
        teamId: id,
        reason: z.string().min(5).max(1000),
      });
      manager(c);
      if (
        !state(c).frozen ||
        state(c).pendingReview ||
        !state(c).pointsChampionCandidates?.includes(data.teamId)
      )
        fail("Choose an eligible tied points champion after season review");
      if (state(c).pointsChampionTeamId)
        fail("Points champion already declared");
      append(c, "decision", {
        teamId: data.teamId,
        reason: data.reason,
        pointsChampion: true,
      });
      save(c, {
        pointsChampionTeamId: data.teamId,
        pointsChampionDecision: data.reason,
      });
      return { status: "Declared" };
    }
    case "generatePlayoffs": {
      parse(c, {});
      manager(c);
      if (!state(c).frozen || state(c).pendingReview || !r.playoffQualifiers)
        fail(
          "Freeze and review a season with explicitly enabled playoffs first",
        );
      if (c.list("teamEncounters").some((e) => e.phase === "playoffs"))
        fail("Playoffs already generated");
      const rows = (state(c).standings as LadderStanding[]).filter(
        (s) => s.played >= r.playoffMinimumPlayed,
      );
      if (r.playoffSeeding === "points")
        rows.sort(
          (a, b) =>
            b.points - a.points ||
            b.wins - a.wins ||
            b.upwardWins - a.upwardWins ||
            a.position - b.position,
        );
      if (rows.length < r.playoffQualifiers)
        fail("Not enough entrants meet playoff participation");
      const ids = rows.slice(0, r.playoffQualifiers).map((s) => s.teamId);
      for (const m of elimination(
        ids,
        `${c.event.id}-ladder-playoffs`,
        c.list("divisions")[0].id,
      ))
        c.make(
          "teamEncounters",
          {
            teamA: m.p1,
            teamB: m.p2,
            eventName: c.event.name,
            timezone: c.event.timezone,
            phase: "playoffs",
            round: m.round,
            position: m.position,
            winner: null,
            winsA: 0,
            winsB: 0,
            version: 0,
            status: "Awaiting lineups",
            published: true,
            ...(m.nextId
              ? {
                  nextId: m.nextId,
                  nextSlot: m.nextSlot === "p1" ? "teamA" : "teamB",
                }
              : {}),
          },
          m.id,
        );
      const playoffStart =
        Math.ceil(
          (calendar.freezeAt + 1 + r.playoffGapHours * 3600000) / 900000,
        ) * 900000;
      save(c, {
        qualification: {
          teamIds: ids,
          minimumPlayed: r.playoffMinimumPlayed,
          seeding: r.playoffSeeding,
        },
      });
      c.edit("events", c.event, {
        status: "In Progress",
        playoffWindow: {
          startDate: new Date(playoffStart).toISOString(),
          endDate: new Date(
            playoffStart + r.playoffWindowDays * day,
          ).toISOString(),
        },
      });
      return { qualifiers: ids };
    }
    case "tick":
      parse(c, {});
      tickLadder(c);
      return { status: state(c).frozen ? "Frozen" : "Updated" };
    default:
      fail("Unknown ladder action");
  }
}
