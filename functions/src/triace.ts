import { serverNow } from "./clock.js";
import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import {
  triaceRulesSchema,
  competitionRules,
  competitionRulesSchema,
  validateCompetitionLineup,
  competitionRatingSnapshot,
  validateCompetitionRating,
  validateCompetitionScore,
  competitionStandings,
  rubberKinds,
  rosterForRules,
  isTeamCompetition,
  eligibility,
  type Division,
  singlesParticipation,
  roundRobin,
  elimination,
  registrationPlacement,
  withinDailyHours,
  cleanText,
  courtBlocked,
  csv,
  type CourtBlock,
  type Entity,
  type Team,
} from "@pprc/shared";

export const triaceCollections = [
  "teams",
  "invitations",
  "teamGroups",
  "teamEncounters",
  "lineups",
  "rubbers",
  "rubberResults",
  "disputes",
  "ratingSnapshots",
] as const;
const id = z.string().regex(/^[\w-]{1,120}$/);
const terminal = ["Withdrawn", "Rejected", "Refunded", "Cancelled"];
const fail = (
  message: string,
  code:
    | "permission-denied"
    | "failed-precondition"
    | "not-found" = "failed-precondition",
): never => {
  throw new HttpsError(code, message);
};
export interface TriaceContext {
  uid: string;
  role: string | undefined;
  data: any;
  event: Entity;
  profile?: Entity;
  manager: boolean;
  clubMember: boolean;
  list: (collection: string) => Entity[];
  find: (collection: string, id: unknown) => Entity;
  make: (collection: string, fields: any, id?: string) => Entity;
  edit: (collection: string, entity: Entity, fields: any) => Entity;
  notify: (uid: string, title: string, body: string, type: string) => Entity;
  readPlayer: (uid: string) => Promise<Entity | undefined>;
  readCourt: (id: string) => Promise<Entity | undefined>;
  courtBlocks: CourtBlock[];
  readMembership: (id: string) => Promise<Entity | undefined>;
  reason: () => string;
}
// This handler shares execute()'s transaction, authorization, receipt and audit commit.
// It never writes through a second database path or directly from the browser.
export async function executeTriace(c: TriaceContext): Promise<any> {
  const { uid, role, data, event, list, find, make, edit, notify, manager } = c;
  if (event.clubId !== "pprc" || !isTeamCompetition(event))
    fail("Choose a supported team competition");
  if (role === "platformAdmin")
    fail("Support role is read only", "permission-denied");
  if (event.visibility === "private" && !c.clubMember && !manager)
    fail("Club membership required", "permission-denied");
  if (event.status === "Draft" && !manager)
    fail("Event is not published", "permission-denied");
  const rules = competitionRules(event);
  if (
    ["koc", "doubles", "ladder"].includes(event.competition) &&
    !rules.policyConfirmed &&
    !["configure", "exportTeamReport"].includes(data.action)
  )
    fail("Organizer must review and confirm the competition policy");
  const kinds = rubberKinds(rules);
  const slots = rosterForRules(rules);
  if (
    event.status === "Cancelled" &&
    !["exportTeamReport", "withdrawTeam"].includes(data.action)
  )
    fail("Cancelled tournaments are locked");
  const admin = () => {
    if (!manager)
      fail("Assigned organizer access required", "permission-denied");
  };
  const team = (teamId: unknown) => find("teams", teamId) as Team;
  const captain = (t: Team) => {
    if (t.captainId !== uid)
      fail("Team captain access required", "permission-denied");
  };
  const openRoster = (t: Team) => {
    if (t.withdrawn || t.registrationId || list("teamEncounters").length)
      fail("Roster is locked after registration");
  };
  const notifyTeam = (t: Team, title: string, body: string) =>
    t.memberIds.forEach((p) => notify(p, title, body, "triace"));
  const encounter = (encounterId: unknown) =>
    find("teamEncounters", encounterId);
  const teamForActor = (e: Entity) =>
    [e.teamA, e.teamB].find((t) => t && team(t).memberIds.includes(uid));
  const requireSide = (e: Entity) => {
    const side = teamForActor(e);
    if (!side && !manager)
      fail("Encounter participant access required", "permission-denied");
    return side;
  };
  const refreshTables = () => {
    for (const g of list("teamGroups"))
      edit("teamGroups", g, {
        standings: competitionStandings(
          g.teamIds,
          list("teamEncounters").filter((e) => e.groupId === g.id),
          rules,
          g.resolutions,
        ),
      });
  };
  const finishRoundRobin = () => {
    if (rules.stageFormat !== "round-robin") return;
    const games = list("teamEncounters").filter((e) => e.phase === "groups"),
      g = list("teamGroups")[0];
    if (!g || !games.length) return;
    const rows = competitionStandings(g.teamIds, games, rules, g.resolutions);
    const complete =
      games.every((e) => e.status === "Final") &&
      !rows[0]?.tied &&
      !rows[1]?.tied &&
      !list("disputes").some((d) => d.status === "Open");
    edit("events", event, {
      status: complete ? "Completed" : "In Progress",
      championTeamId: complete ? rows[0].teamId : null,
      runnerUpTeamId: complete ? (rows[1]?.teamId ?? null) : null,
    });
  };
  const createEncounter = (fields: any, encounterId: string) => {
    const e = make(
      "teamEncounters",
      {
        eventName: event.name,
        timezone: event.timezone,
        winner: null,
        winsA: 0,
        winsB: 0,
        version: 0,
        status: "Awaiting lineups",
        published: true,
        ...fields,
      },
      encounterId,
    );
    return e;
  };
  const refreshEncounter = (e: Entity) => {
    const rs = list("rubbers").filter((r) => r.encounterId === e.id);
    const winsA = rs.filter(
      (r) => r.status === "Final" && r.winner === e.teamA,
    ).length;
    const winsB = rs.filter(
      (r) => r.status === "Final" && r.winner === e.teamB,
    ).length;
    const clinched = winsA >= rules.winsRequired || winsB >= rules.winsRequired;
    const final =
      clinched &&
      (rules.stopAtClinch ||
        rs.every(
          (r) =>
            r.status === "Final" ||
            (r.status === "Not required" && r.outcome === "forfeit"),
        ));
    const winner = final ? (winsA > winsB ? e.teamA : e.teamB) : null;
    const next = e.nextId ? encounter(e.nextId) : null;
    if (
      next &&
      e.winner !== winner &&
      (list("lineups").some((l) => l.encounterId === next.id) ||
        next.version > 0)
    )
      fail(
        "Resolve downstream lineups and results before correcting this encounter",
      );
    edit("teamEncounters", e, {
      winsA,
      winsB,
      winner,
      status: final ? "Final" : "In Progress",
      version: e.version + 1,
    });
    if (final && rules.stopAtClinch)
      for (const r of rs.filter((r) => r.status === "Scheduled"))
        edit("rubbers", r, { status: "Not required" });
    if (!final)
      for (const r of rs.filter((r) => r.status === "Not required"))
        edit("rubbers", r, { status: "Scheduled" });
    if (next) edit("teamEncounters", next, { [e.nextSlot]: winner });
    if (e.phase === "playoffs" && !e.nextId) {
      edit("events", event, {
        status: final ? "Completed" : "In Progress",
        championTeamId: winner,
        runnerUpTeamId: final ? (winner === e.teamA ? e.teamB : e.teamA) : null,
      });
      if (winner && winner !== e.winner)
        for (const t of list("teams"))
          notifyTeam(
            t as Team,
            "Champion declared",
            `${team(winner).name} wins ${event.name}.`,
          );
    } else if (event.status !== "Cancelled" && event.status !== "Completed")
      edit("events", event, { status: "In Progress" });
    refreshTables();
    finishRoundRobin();
  };
  const finalize = (r: Entity, res: Entity) => {
    if (
      r.version !== res.baseVersion ||
      !["Submitted", "Disputed"].includes(res.state)
    )
      fail("Score version changed; reload before confirming");
    const score = validateCompetitionScore(res.score, r, rules);
    edit("rubberResults", res, {
      state: "Final",
      confirmedBy: uid,
      version: r.version + 1,
    });
    edit("rubbers", r, {
      status: "Final",
      winner: score.winner,
      outcome: score.outcome,
      version: r.version + 1,
      score,
      disputed: false,
    });
    const e = encounter(r.encounterId);
    refreshEncounter(e);
    notifyTeam(team(e.teamA), "Rubber result confirmed", event.name);
    notifyTeam(team(e.teamB), "Rubber result confirmed", event.name);
  };
  const assertPlayoffParticipation = (t: Team) => {
    const participation = t.roster.map((p) =>
      singlesParticipation(
        p.playerId,
        t.id,
        list("teamEncounters"),
        list("rubbers"),
        rules,
      ),
    );
    if (
      rules.requireAllRosterEligible &&
      participation.some((p) => !p.eligible)
    )
      fail(`Playoff participation requirement not met for ${t.name}`);
    return participation;
  };
  const lockQualification = (e: Entity) => {
    if (
      ["groups", "ladder"].includes(e.phase) &&
      list("teamEncounters").some((g) => g.phase === "playoffs")
    )
      fail("Group results are locked after playoff generation");
  };
  switch (data.action) {
    case "configure": {
      admin();
      c.reason();
      if (
        list("registrations").some((r) => !terminal.includes(r.state)) ||
        list("teamEncounters").length
      )
        fail("Rules are locked after registration");
      competitionRules({
        ...event,
        ...(event.competition === "triace"
          ? { triaceRules: triaceRulesSchema.parse(data.rules) }
          : { teamRules: data.rules }),
      });
      edit("events", event, {
        ...(event.competition === "triace"
          ? { triaceRules: triaceRulesSchema.parse(data.rules) }
          : {
              teamRules: competitionRules({
                ...event,
                teamRules: competitionRulesSchema.parse(data.rules),
              }),
            }),
        schemaVersion: event.competition === "triace" ? 2 : 3,
      });
      if (event.competition !== "triace") {
        const policy = competitionRules({ ...event, teamRules: data.rules });
        edit("divisions", list("divisions")[0], {
          format:
            policy.stageFormat === "groups-playoffs"
              ? "round-robin-playoffs"
              : policy.stageFormat,
        });
      }
      return { status: "Configured" };
    }
    case "createTeam": {
      if (!c.profile) fail("Complete your player profile first");
      if (!data.waiver && !data.rosterConsent)
        fail("Consent to the public approved roster is required");
      if (
        event.status !== "Registration Open" ||
        serverNow() > Date.parse(event.registrationClose) ||
        list("teamEncounters").length
      )
        fail("Team registration is closed");
      if (list("teams").some((t) => !t.withdrawn && t.memberIds.includes(uid)))
        fail("A player may join only one team per event");
      if (event.waiverRequired && !data.waiver)
        fail("Waiver acknowledgement required");
      const name = z
        .string()
        .trim()
        .min(2)
        .max(60)
        .transform(cleanText)
        .parse(data.name);
      if (
        list("teams").some(
          (t) => !t.withdrawn && t.name.toLowerCase() === name.toLowerCase(),
        )
      )
        fail("Team name already used");
      const t = make("teams", {
        name,
        captainId: uid,
        memberIds: [uid],
        roster: [
          { slot: "P1", playerId: uid, displayName: c.profile!.displayName },
        ],
        withdrawn: false,
        published: false,
        waiverAcceptedBy: [uid],
        waiverVersion: event.waiverVersion ?? 1,
      });
      return { teamId: t.id };
    }
    case "invitePlayer": {
      const t = team(data.teamId);
      captain(t);
      openRoster(t);
      const playerId = id.parse(data.playerId),
        slot = z
          .string()
          .refine(
            (v) => slots.slice(1).includes(v),
            "Choose an available configured roster slot",
          )
          .parse(data.slot);
      if (
        t.roster.some((p) => p.slot === slot) ||
        list("teams").some(
          (x) => !x.withdrawn && x.memberIds.includes(playerId),
        )
      )
        fail("Player or roster slot is already assigned");
      if (
        list("invitations").some(
          (i) =>
            i.teamId === t.id &&
            i.status === "Pending" &&
            (i.slot === slot || i.playerId === playerId),
        )
      )
        fail("A pending invitation already occupies this slot or player");
      const p = await c.readPlayer(playerId);
      if (!p) fail("Player profile not found", "not-found");
      const invitation = make("invitations", {
        teamId: t.id,
        teamName: t.name,
        playerId,
        captainId: uid,
        participantIds: [uid, playerId],
        slot,
        status: "Pending",
      });
      notify(
        playerId,
        "You are invited",
        `Join ${t.name} in ${event.name}.`,
        "team-invitation",
      );
      return { invitationId: invitation.id };
    }
    case "respondInvitation": {
      const invitation = find("invitations", data.invitationId);
      if (invitation.playerId !== uid)
        fail("Only the invited player can respond", "permission-denied");
      if (invitation.status !== "Pending") fail("Invitation already answered");
      const accepted = z.boolean().parse(data.accepted),
        t = team(invitation.teamId);
      openRoster(t);
      if (
        serverNow() > Date.parse(event.registrationClose) ||
        event.status !== "Registration Open"
      )
        fail("Team registration is closed");
      if (accepted) {
        if (!data.waiver && !data.rosterConsent)
          fail("Consent to the public approved roster is required");
        if (!c.profile) fail("Complete your player profile first");
        if (event.waiverRequired && !data.waiver)
          fail("Waiver acknowledgement required");
        if (
          list("teams").some(
            (x) => !x.withdrawn && x.memberIds.includes(uid),
          ) ||
          t.roster.some((p) => p.slot === invitation.slot)
        )
          fail("Player or roster slot is already assigned");
        edit("teams", t, {
          memberIds: [...t.memberIds, uid],
          roster: [
            ...t.roster,
            {
              slot: invitation.slot,
              playerId: uid,
              displayName: c.profile!.displayName,
            },
          ].sort((a, b) => a.slot.localeCompare(b.slot)),
          waiverAcceptedBy: [...t.waiverAcceptedBy, uid],
        });
      }
      edit("invitations", invitation, {
        status: accepted ? "Accepted" : "Declined",
        waiver: accepted && !!data.waiver,
      });
      notify(
        t.captainId,
        accepted ? "Invitation accepted" : "Invitation declined",
        c.profile?.displayName ?? uid,
        "team-invitation",
      );
      return { status: accepted ? "Accepted" : "Declined" };
    }
    case "revokeInvitation": {
      const invitation = find("invitations", data.invitationId),
        t = team(invitation.teamId);
      captain(t);
      openRoster(t);
      if (invitation.status !== "Pending")
        fail("Only pending invitations may be revoked");
      edit("invitations", invitation, { status: "Revoked" });
      notify(
        invitation.playerId,
        "Team invitation revoked",
        t.name,
        "team-invitation",
      );
      return { status: "Revoked" };
    }
    case "registerTeam": {
      const t = team(data.teamId);
      captain(t);
      openRoster(t);
      if (
        event.status !== "Registration Open" ||
        serverNow() < Date.parse(event.registrationOpen) ||
        serverNow() > Date.parse(event.registrationClose)
      )
        fail("Registration is closed");
      if (
        t.roster.length !== rules.teamSize ||
        new Set(t.memberIds).size !== rules.teamSize ||
        new Set(t.roster.map((p) => p.slot)).size !== rules.teamSize ||
        t.roster.some((p) => !slots.includes(p.slot))
      )
        fail(
          rules.teamSize === 3
            ? "Three confirmed players required"
            : `${rules.teamSize} distinct confirmed players required`,
        );
      if (
        event.waiverRequired &&
        (t.waiverAcceptedBy.length !== rules.teamSize ||
          t.waiverVersion !== (event.waiverVersion ?? 1))
      )
        fail(
          "All players must accept the current waiver; recreate the team after waiver changes",
        );
      const profiles = await Promise.all(
        t.roster.map((p) => c.readPlayer(p.playerId)),
      );
      if (profiles.some((p) => !p || p.clubId !== "pprc"))
        fail("Every roster player needs a PPRC profile");
      if (rules.membersOnly) {
        const memberships = await Promise.all(
          t.memberIds.map((id) => c.readMembership(id)),
        );
        if (memberships.some((m) => m?.clubId !== "pprc" || m.member !== true))
          fail("Every roster player needs club membership");
      }
      const snapshots = profiles.map((p) =>
          competitionRatingSnapshot(p!, rules),
        ),
        combined = validateCompetitionRating(snapshots, rules);
      const division = find("divisions", data.divisionId);
      for (let i = 0; i < profiles.length; i++) {
        const errors = eligibility(
          { ...profiles[i], externalRating: snapshots[i].reference } as Entity,
          division as Division,
          new Date(event.startDate),
        );
        if (errors) fail(`${t.roster[i].displayName}: ${errors}`);
      }
      const state = registrationPlacement(
        list("registrations").filter(
          (r) =>
            r.divisionId === division.id &&
            !terminal.includes(r.state) &&
            r.state !== "Waitlisted",
        ).length,
        list("registrations").filter(
          (r) => !terminal.includes(r.state) && r.state !== "Waitlisted",
        ).length,
        division.capacity,
        event.capacity,
        event.waitlist,
      );
      const answers = z.record(z.string().max(2000)).parse(data.answers ?? {});
      if (event.questions.some((q: string) => !answers[q]?.trim()))
        fail("Answer all registration questions");
      const reg = make("registrations", {
        kind: "team",
        teamId: t.id,
        playerId: uid,
        displayName: t.name,
        eventName: event.name,
        divisionName: division.name,
        divisionId: division.id,
        state:
          state === "Registered" && (division.fee ?? event.fee) > 0
            ? "Pending Payment"
            : state,
        order: serverNow(),
        seed: 0,
        checkIn: "Not Checked In",
        waiver: true,
        waiverVersion: event.waiverVersion ?? 1,
        answers,
        externalRating: combined,
        combinedReference: combined,
        ratingSnapshots: snapshots,
        paymentExpiresAt: serverNow() + 30 * 60000,
      });
      edit("teams", t, { registrationId: reg.id, combinedReference: combined });
      snapshots.forEach((s) =>
        make(
          "ratingSnapshots",
          { ...s, teamId: t.id, registrationId: reg.id },
          `${reg.id}-${s.playerId}`,
        ),
      );
      notifyTeam(
        t,
        "Team registration received",
        `${event.name}: ${reg.state}`,
      );
      return { registrationId: reg.id, state: reg.state };
    }
    case "approveTeam": {
      admin();
      c.reason();
      const t = team(data.teamId),
        reg = find("registrations", t.registrationId);
      if (!["Registered", "Approved"].includes(reg.state))
        fail("Team must be paid or free before approval");
      if (list("teamEncounters").length)
        fail("Approval and seeding are locked after fixture generation");
      validateCompetitionRating(reg.ratingSnapshots, rules);
      const seed = z
        .number()
        .int()
        .min(0)
        .max(event.competition === "ladder" ? 32 : 16)
        .parse(data.seed ?? reg.seed);
      if (
        seed &&
        list("registrations").some((r) => r.id !== reg.id && r.seed === seed)
      )
        fail("Seed already assigned");
      edit("registrations", reg, { state: "Approved", seed });
      notifyTeam(t, "Team approved", event.name);
      edit("teams", t, { published: true });
      return { status: "Approved" };
    }
    case "assignGroups": {
      admin();
      if (list("teamEncounters").length)
        fail("Groups are locked after fixture generation");
      if (list("teamGroups").length) c.reason();
      const regs = list("registrations")
        .filter(
          (r) =>
            r.kind === "team" &&
            r.state === "Approved" &&
            !team(r.teamId).withdrawn,
        )
        .sort(
          (a, b) =>
            (a.seed || 999) - (b.seed || 999) ||
            b.combinedReference - a.combinedReference ||
            a.id.localeCompare(b.id),
        );
      if (
        list("registrations").some((r) =>
          ["Pending Payment", "Registered"].includes(r.state),
        )
      )
        fail(
          "Approve or resolve every pending registration before assigning groups",
        );
      if (
        regs.length <
          rules.groupCount * Math.max(2, rules.qualifiersPerGroup) ||
        regs.length > 16
      )
        fail("Use 2–16 approved teams with enough teams in each group");
      if (rules.stageFormat === "single-elimination")
        fail("Knockout fixtures do not use groups");
      const groups: { teamIds: string[] }[] = data.groups
        ? z
            .array(z.object({ teamIds: z.array(id).min(2).max(8) }))
            .length(rules.groupCount)
            .parse(data.groups)
        : Array.from({ length: rules.groupCount }, () => ({ teamIds: [] }));
      if (!data.groups)
        regs.forEach((r, i) => {
          const round = Math.floor(i / rules.groupCount),
            slot = i % rules.groupCount;
          groups[round % 2 ? rules.groupCount - 1 - slot : slot].teamIds.push(
            r.teamId,
          );
        });
      const assigned = groups.flatMap((g) => g.teamIds);
      if (
        assigned.length !== regs.length ||
        new Set(assigned).size !== assigned.length ||
        assigned.some((t) => !regs.some((r) => r.teamId === t)) ||
        groups.some(
          (g) =>
            g.teamIds.length < Math.max(2, rules.qualifiersPerGroup) ||
            g.teamIds.length > 8,
        )
      )
        fail(
          "Groups must assign every approved team exactly once, with 2–8 teams per group",
        );
      groups.forEach((g, i) => {
        const fields = {
          name: `Group ${String.fromCharCode(65 + i)}`,
          number: i,
          teamIds: g.teamIds,
          resolutions: {},
          standings: competitionStandings(g.teamIds, [], rules),
          published: true,
        };
        const previous = list("teamGroups").find(
          (row) => row.id === `${event.id}-group-${i}`,
        );
        if (previous) edit("teamGroups", previous, fields);
        else make("teamGroups", fields, `${event.id}-group-${i}`);
      });
      edit("events", event, { status: "Registration Closed" });
      return { groups: groups.length };
    }
    case "generateFixtures": {
      admin();
      if (rules.stageFormat === "single-elimination") {
        if (list("teamEncounters").length) fail("Fixtures already generated");
        if (
          list("registrations").some((r) =>
            ["Pending Payment", "Registered"].includes(r.state),
          )
        )
          fail(
            "Approve or resolve every pending registration before generating fixtures",
          );
        const regs = list("registrations")
          .filter(
            (r) =>
              r.kind === "team" &&
              r.state === "Approved" &&
              !team(r.teamId).withdrawn,
          )
          .sort(
            (a, b) =>
              (a.seed || 999) - (b.seed || 999) ||
              (b.combinedReference ?? -1) - (a.combinedReference ?? -1) ||
              a.id.localeCompare(b.id),
          );
        if (regs.length < 2 || regs.length > 16)
          fail("Use 2–16 approved teams");
        const games = elimination(
          regs.map((r) => r.teamId),
          `${event.id}-team-knockout`,
          list("divisions")[0].id,
        );
        for (const m of games)
          createEncounter(
            {
              teamA: m.p1,
              teamB: m.p2,
              phase: "playoffs",
              round: m.round,
              position: m.position,
              status: m.status === "Bye" ? "Bye" : "Awaiting lineups",
              winner: m.winner ?? null,
              ...(m.nextId
                ? {
                    nextId: m.nextId,
                    nextSlot: m.nextSlot === "p1" ? "teamA" : "teamB",
                  }
                : {}),
            },
            m.id,
          );
        edit("events", event, { status: "Check-In" });
        return { encounters: games.length };
      }
      if (!list("teamGroups").length || list("teamEncounters").length)
        fail("Assign groups once before generating fixtures");
      const assigned = list("teamGroups").flatMap((g) => g.teamIds);
      const approved = list("registrations")
        .filter(
          (r) =>
            r.kind === "team" &&
            r.state === "Approved" &&
            !team(r.teamId).withdrawn,
        )
        .map((r) => r.teamId);
      if (
        assigned.length !== approved.length ||
        assigned.some((t) => !approved.includes(t))
      )
        fail("Reassign groups after registration or withdrawal changes");
      let count = 0;
      for (const g of list("teamGroups"))
        for (const m of roundRobin(
          g.teamIds,
          g.id,
          list("divisions")[0].id,
          g.number,
        )) {
          createEncounter(
            {
              teamA: m.p1,
              teamB: m.p2,
              phase: "groups",
              groupId: g.id,
              round: m.round,
              position: m.position,
            },
            m.id,
          );
          count++;
        }
      edit("events", event, { status: "Check-In" });
      return { encounters: count };
    }
    case "submitLineup": {
      const t = team(data.teamId);
      captain(t);
      const e = encounter(data.encounterId);
      if (
        ![e.teamA, e.teamB].includes(t.id) ||
        !e.teamA ||
        !e.teamB ||
        t.withdrawn
      )
        fail("Team is not active in this encounter");
      if (
        list("lineups").some(
          (l) => l.encounterId === e.id && l.teamId === t.id,
        ) ||
        e.status === "Final"
      )
        fail("Lineup is already locked");
      if (e.phase === "playoffs" && rules.stageFormat === "groups-playoffs")
        assertPlayoffParticipation(t);
      if (
        rules.lineupDeadlineMinutes !== null &&
        (!e.scheduledAt ||
          serverNow() >
            Date.parse(e.scheduledAt) - rules.lineupDeadlineMinutes * 60000)
      )
        fail(
          "Lineup submission deadline has passed or the encounter is not scheduled",
        );
      const lineup = validateCompetitionLineup(t, data.lineup, rules);
      const l = make(
        "lineups",
        {
          teamId: t.id,
          encounterId: e.id,
          memberIds: t.memberIds,
          lineup,
          published: false,
        },
        `${e.id}-${t.id}`,
      );
      const other = list("lineups").find(
        (x) => x.encounterId === e.id && x.teamId !== t.id,
      );
      if (other) {
        edit("lineups", l, { published: true });
        edit("lineups", other, { published: true });
        const a = l.teamId === e.teamA ? l : other,
          b = l.teamId === e.teamB ? l : other;
        for (let index = 0; index < kinds.length; index++) {
          const players = (line: Entity) =>
            index < rules.singlesRubbers
              ? [line.lineup.singles[index]]
              : index < rules.singlesRubbers + rules.doublesRubbers
                ? line.lineup.doubles[index - rules.singlesRubbers].players
                : line.lineup.tiebreak;
          make(
            "rubbers",
            {
              encounterId: e.id,
              index,
              kind: kinds[index],
              competition: event.competition,
              teamA: e.teamA,
              teamB: e.teamB,
              playersA: players(a),
              playersB: players(b),
              participantIds: [
                ...team(e.teamA).memberIds,
                ...team(e.teamB).memberIds,
              ],
              status: "Scheduled",
              winner: null,
              version: 0,
              published: true,
            },
            `${e.id}-rubber-${index}`,
          );
        }
        edit("teamEncounters", e, {
          status:
            rules.encounterConfirmation === "lineups"
              ? "Ready"
              : "Awaiting encounter confirmation",
          confirmedTeamIds:
            rules.encounterConfirmation === "lineups" ? [e.teamA, e.teamB] : [],
          lineupCaptainIds: [a.createdBy, b.createdBy],
          confirmationBasis: rules.encounterConfirmation,
        });
      }
      return {
        status: other
          ? rules.encounterConfirmation === "lineups"
            ? "Ready"
            : "Awaiting encounter confirmation"
          : "Awaiting opponent lineup",
      };
    }
    case "confirmEncounter": {
      const e = encounter(data.encounterId),
        t = team(data.teamId);
      captain(t);
      if (
        ![e.teamA, e.teamB].includes(t.id) ||
        e.status !== "Awaiting encounter confirmation" ||
        !list("lineups").some(
          (l) => l.encounterId === e.id && l.teamId === t.id && l.published,
        )
      )
        fail("Submit both lineups before encounter confirmation");
      const confirmed = e.confirmedTeamIds ?? [];
      if (confirmed.includes(t.id))
        fail("Encounter already confirmed by this team");
      const next = [...confirmed, t.id];
      edit("teamEncounters", e, {
        confirmedTeamIds: next,
        status: next.length === 2 ? "Ready" : "Awaiting encounter confirmation",
      });
      return {
        status: next.length === 2 ? "Ready" : "Awaiting opponent confirmation",
      };
    }
    case "submitRubberScore": {
      const r = find("rubbers", data.rubberId),
        e = encounter(r.encounterId),
        side = requireSide(e);
      if (
        !manager &&
        team(side).captainId !== uid &&
        ![...r.playersA, ...r.playersB].includes(uid)
      )
        fail("Captain or assigned rubber player required", "permission-denied");
      if (e.status === "Awaiting encounter confirmation")
        fail("Both captains must confirm the encounter before scoring");
      if (
        e.scoreDeadline
          ? serverNow() > Date.parse(e.scoreDeadline)
          : rules.resultDeadlineHours !== null &&
            (!e.scheduledAt ||
              serverNow() >
                Date.parse(e.scheduledAt) + rules.resultDeadlineHours * 3600000)
      )
        fail("Score entry deadline has passed");
      if (
        r.status !== "Scheduled" ||
        !["Ready", "In Progress"].includes(e.status) ||
        event.status === "Cancelled"
      )
        fail("Rubber is not open for scoring");
      if (
        list("rubbers").some(
          (other) =>
            other.encounterId === e.id &&
            other.status === "Awaiting confirmation",
        ) ||
        list("disputes").some(
          (dispute) =>
            dispute.encounterId === e.id && dispute.status === "Open",
        )
      )
        fail(
          "Confirm pending scores and resolve disputes before scoring another rubber",
        );
      if (
        r.kind === "tiebreak" &&
        rules.tiebreakAfterOthers &&
        list("rubbers").filter(
          (x) =>
            x.encounterId === e.id &&
            x.index < kinds.length - 1 &&
            x.status === "Final",
        ).length !==
          kinds.length - 1
      )
        fail("Play the preceding rubbers before the deciding tiebreak");
      const score = validateCompetitionScore(data.score, r, rules);
      if (data.baseVersion !== r.version)
        fail("Score version changed; reload before submitting");
      const res = make("rubberResults", {
        encounterId: e.id,
        rubberId: r.id,
        score,
        state: "Submitted",
        baseVersion: r.version,
        submittedBy: uid,
        submittedTeamId: side ?? null,
        participantIds: r.participantIds,
        published: true,
      });
      edit("rubbers", r, { status: "Awaiting confirmation" });
      if (manager && data.finalize === true) {
        c.reason();
        finalize(r, res);
      } else
        notifyTeam(
          team(side === e.teamA ? e.teamB : e.teamA),
          "Confirm a rubber score",
          event.name,
        );
      return { resultId: res.id };
    }
    case "confirmRubberScore": {
      const res = find("rubberResults", data.resultId),
        r = find("rubbers", res.rubberId),
        e = encounter(r.encounterId),
        side = requireSide(e);
      if (res.state !== "Submitted" || r.disputed)
        fail("Resolve disputed or finalized scores before confirmation");
      if (!manager && (side === res.submittedTeamId || res.submittedBy === uid))
        fail("Opponent confirmation required", "permission-denied");
      if (
        !manager &&
        team(side).captainId !== uid &&
        ![...r.playersA, ...r.playersB].includes(uid)
      )
        fail("Captain or assigned rubber player required", "permission-denied");
      if (manager) c.reason();
      finalize(r, res);
      return { status: "Final" };
    }
    case "disputeRubber": {
      const res = find("rubberResults", data.resultId),
        r = find("rubbers", res.rubberId),
        e = encounter(r.encounterId);
      requireSide(e);
      c.reason();
      lockQualification(e);
      if (!["Submitted", "Final"].includes(res.state) || r.disputed)
        fail("This result cannot be disputed");
      const d = make("disputes", {
        encounterId: e.id,
        resultId: res.id,
        rubberId: r.id,
        participantIds: r.participantIds,
        status: "Open",
        reason: data.reason,
        openedBy: uid,
      });
      edit("rubbers", r, { disputed: true });
      if (res.state === "Submitted")
        edit("rubberResults", res, { state: "Disputed" });
      for (const p of event.assignedAdmins ?? [])
        notify(p, "Score dispute needs review", event.name, "dispute");
      finishRoundRobin();
      return { disputeId: d.id };
    }
    case "resolveDispute": {
      admin();
      c.reason();
      const d = find("disputes", data.disputeId),
        res = find("rubberResults", d.resultId),
        r = find("rubbers", d.rubberId),
        e = encounter(r.encounterId);
      lockQualification(e);
      if (d.status !== "Open") fail("Dispute already resolved");
      const resolution = z.enum(["uphold", "correct"]).parse(data.resolution);
      if (resolution === "correct") {
        if (e.nextId) {
          const n = encounter(e.nextId);
          if (
            n.version > 0 ||
            list("lineups").some((l) => l.encounterId === n.id)
          )
            fail("Downstream lineups or scores lock this correction");
        }
        const score = validateCompetitionScore(data.score, r, rules);
        edit("rubberResults", res, { state: "Superseded" });
        const replacement = make("rubberResults", {
          encounterId: e.id,
          rubberId: r.id,
          score,
          state: "Submitted",
          baseVersion: r.version,
          submittedBy: uid,
          submittedTeamId: null,
          participantIds: r.participantIds,
          published: true,
          corrects: res.id,
          reason: data.reason,
        });
        finalize(r, replacement);
      } else if (res.state === "Disputed") finalize(r, res);
      else edit("rubbers", r, { disputed: false });
      edit("disputes", d, {
        status: "Resolved",
        resolution,
        resolvedBy: uid,
        resolutionReason: data.reason,
      });
      finishRoundRobin();
      return { status: "Resolved" };
    }
    case "resolveTeamTies": {
      admin();
      c.reason();
      if (list("teamEncounters").some((e) => e.phase === "playoffs"))
        fail("Qualification is locked");
      const g = find("teamGroups", data.groupId),
        order = z.array(id).parse(data.teamIds);
      if (
        order.length !== g.teamIds.length ||
        new Set(order).size !== order.length ||
        order.some((t) => !g.teamIds.includes(t))
      )
        fail("Provide each group team exactly once");
      edit("teamGroups", g, {
        resolutions: Object.fromEntries(order.map((t, i) => [t, i + 1])),
      });
      refreshTables();
      finishRoundRobin();
      return { status: "Resolved" };
    }
    case "generateTeamPlayoffs": {
      admin();
      if (rules.stageFormat !== "groups-playoffs")
        fail("This tournament does not use group-stage playoffs");
      const games = list("teamEncounters");
      if (
        !games.length ||
        games.some((e) => e.phase === "playoffs") ||
        games.some((e) => e.status !== "Final") ||
        list("disputes").some((d) => d.status === "Open")
      )
        fail("Finish all group encounters and disputes before qualification");
      const groups = list("teamGroups").sort((a, b) => a.number - b.number);
      const tables = groups.map((g) =>
        competitionStandings(
          g.teamIds,
          games.filter((e) => e.groupId === g.id),
          rules,
          g.resolutions,
        ),
      );
      if (
        tables.some((rows) =>
          rows.slice(0, rules.qualifiersPerGroup).some((r) => r.tied),
        )
      )
        fail("Resolve qualification or seeding ties explicitly");
      const qualifiers: string[] = [];
      for (let i = 0; i < tables.length; i++) {
        tables[i] = tables[i].filter((row) => !team(row.teamId).withdrawn);
        if (tables[i].length < rules.qualifiersPerGroup)
          fail("Not enough active teams remain for qualification");
      }
      for (let rank = 0; rank < rules.qualifiersPerGroup; rank++)
        for (const rows of tables) qualifiers.push(rows[rank].teamId);
      const participation = qualifiers.map((t) => ({
        teamId: t,
        players: assertPlayoffParticipation(team(t)),
      }));
      for (const m of elimination(
        qualifiers,
        `${event.id}-team-playoffs`,
        list("divisions")[0].id,
      ))
        createEncounter(
          {
            teamA: m.p1,
            teamB: m.p2,
            phase: "playoffs",
            round: m.round,
            position: m.position,
            ...(m.nextId
              ? {
                  nextId: m.nextId,
                  nextSlot: m.nextSlot === "p1" ? "teamA" : "teamB",
                }
              : {}),
          },
          m.id,
        );
      edit("events", event, {
        status: "In Progress",
        qualification: { teamIds: qualifiers, participation, rules },
      });
      return { qualifiers };
    }
    case "extendScoreDeadline": {
      admin();
      c.reason();
      const e = encounter(data.encounterId);
      const deadline = z.string().datetime().parse(data.scoreDeadline);
      if (
        e.status === "Final" ||
        Date.parse(deadline) < serverNow() ||
        Date.parse(deadline) > serverNow() + 30 * 86400000
      )
        fail(
          "Choose a future score deadline within 30 days for an open encounter",
        );
      edit("teamEncounters", e, { scoreDeadline: deadline });
      return { status: "Updated" };
    }
    case "scheduleEncounter":
    case "generateTeamSchedule": {
      admin();
      const courts = await Promise.all(
        event.courtIds.map((courtId: string) => c.readCourt(courtId)),
      );
      if (
        !courts.length ||
        courts.some((x) => !x || !x.active || x.clubId !== "pprc")
      )
        fail("Choose active PPRC courts");
      const duration = event.duration * 60000,
        buffer = event.buffer * 60000;
      const playWindow = (e: Entity) =>
        event.competition === "ladder" && e.phase === "playoffs"
          ? (event.playoffWindow ?? event)
          : event;
      const schedule = (e: Entity, start: number, courtId: string) => {
        const end = start + duration,
          existing = list("teamEncounters").filter(
            (x) => x.id !== e.id && x.scheduledAt && x.status !== "Bye",
          );
        if (
          !event.courtIds.includes(courtId) ||
          start < Date.parse(playWindow(e).startDate) ||
          end > Date.parse(playWindow(e).endDate) ||
          !withinDailyHours(
            new Date(start).toISOString(),
            event.timezone,
            event.dailyStartHour ?? 8,
            event.dailyEndHour ?? 21,
            (duration + buffer) / 60000,
          )
        )
          return false;
        if (
          (event.blackouts ?? []).some(
            (b: any) =>
              start < Date.parse(b.end) && end + buffer > Date.parse(b.start),
          )
        )
          return false;
        if (courtBlocked(c.courtBlocks, courtId, start, end)) return false;
        if (
          existing.some(
            (x) =>
              start < Date.parse(x.scheduledAt) + duration + buffer &&
              end + buffer > Date.parse(x.scheduledAt) &&
              (x.courtId === courtId ||
                [e.teamA, e.teamB]
                  .filter(Boolean)
                  .some((t) => [x.teamA, x.teamB].includes(t))),
          )
        )
          return false;
        if (
          e.phase === "playoffs" &&
          list("teamEncounters").some(
            (x) =>
              x.phase === "groups" &&
              (!x.scheduledAt ||
                Date.parse(x.scheduledAt) + duration + buffer > start),
          )
        )
          return false;
        const feeders = list("teamEncounters").filter(
          (x) => x.nextId === e.id && x.status !== "Bye",
        );
        if (
          feeders.some(
            (x) =>
              !x.scheduledAt ||
              Date.parse(x.scheduledAt) + duration + buffer > start,
          )
        )
          return false;
        return true;
      };
      const affectedTeams = new Set<string>();
      const notifySchedule = () => {
        for (const t of affectedTeams)
          notifyTeam(team(t), "Team schedule updated", event.name);
      };
      const apply = (e: Entity, start: number, courtId: string) => {
        edit("teamEncounters", e, {
          scheduledAt: new Date(start).toISOString(),
          courtId,
        });
        for (const t of [e.teamA, e.teamB].filter(Boolean))
          affectedTeams.add(t);
      };
      if (data.action === "scheduleEncounter") {
        c.reason();
        const e = encounter(data.encounterId),
          start = Date.parse(z.string().datetime().parse(data.scheduledAt)),
          courtId = id.parse(data.courtId);
        if (["Final", "Bye", "Cancelled", "Expired"].includes(e.status))
          fail("Closed encounters cannot be rescheduled");
        if (!schedule(e, start, courtId))
          fail(
            "Court, team, predecessor, daily-hours or blackout scheduling conflict",
          );
        apply(e, start, courtId);
        notifySchedule();
        return { status: "Scheduled" };
      }
      const pending = list("teamEncounters")
        .filter(
          (e) =>
            !e.scheduledAt &&
            [
              "Awaiting lineups",
              "Awaiting encounter confirmation",
              "Ready",
              "In Progress",
            ].includes(e.status) &&
            (event.competition !== "ladder" || e.phase === "playoffs"),
        )
        .sort(
          (a, b) =>
            (a.phase === "groups" ? 0 : 100) +
            (a.round * 10 + a.position) -
            ((b.phase === "groups" ? 0 : 100) + b.round * 10 + b.position),
        );
      if (!pending.length) fail("No unscheduled encounters");
      for (const e of pending) {
        let placed = false;
        for (
          let start = Date.parse(playWindow(e).startDate);
          start + duration <= Date.parse(playWindow(e).endDate) && !placed;
          start += 15 * 60000
        )
          for (const courtId of event.courtIds)
            if (schedule(e, start, courtId)) {
              apply(e, start, courtId);
              placed = true;
              break;
            }
        if (!placed)
          fail(
            "No conflict-free schedule fits the event window; extend dates or add courts",
          );
      }
      notifySchedule();
      return { scheduled: pending.length };
    }
    case "withdrawTeam": {
      const t = team(data.teamId);
      if (!manager) captain(t);
      c.reason();
      if (event.status === "Completed") fail("Completed events are locked");
      if (list("teamEncounters").length) {
        admin();
        if (
          list("teamEncounters").some(
            (e) => [e.teamA, e.teamB].includes(t.id) && e.status !== "Final",
          )
        )
          fail(
            "After fixtures, record all remaining encounter forfeits before withdrawing a team",
          );
      }
      edit("teams", t, { withdrawn: true, withdrawalReason: data.reason });
      if (t.registrationId) {
        const reg = find("registrations", t.registrationId);
        edit("registrations", reg, { state: "Withdrawn", reason: data.reason });
        for (const p of list("payments").filter(
          (p) => p.registrationId === reg.id && p.state === "Paid",
        ))
          edit("payments", p, {
            refundRequested: true,
            refundReason: data.reason,
          });
      }
      for (const inv of list("invitations").filter(
        (i) => i.teamId === t.id && i.status === "Pending",
      ))
        edit("invitations", inv, { status: "Revoked" });
      notifyTeam(t, "Team withdrawn", data.reason);
      return { status: "Withdrawn" };
    }
    case "forfeitEncounter": {
      admin();
      c.reason();
      const e = encounter(data.encounterId);
      lockQualification(e);
      if (e.status === "Final" || !e.teamA || !e.teamB)
        fail("Choose an active encounter");
      const winner = id.parse(data.winner);
      if (![e.teamA, e.teamB].includes(winner))
        fail("Winner must participate in this encounter");
      if (
        list("rubbers").some(
          (r) =>
            r.encounterId === e.id &&
            ["Final", "Awaiting confirmation"].includes(r.status),
        )
      )
        fail(
          "Resolve existing rubber results through disputes before recording a team forfeit",
        );
      for (let index = 0; index < kinds.length; index++) {
        const r =
          list("rubbers").find((r) => r.id === `${e.id}-rubber-${index}`) ??
          make(
            "rubbers",
            {
              encounterId: e.id,
              index,
              kind: kinds[index],
              competition: event.competition,
              teamA: e.teamA,
              teamB: e.teamB,
              playersA: [],
              playersB: [],
              participantIds: [
                ...team(e.teamA).memberIds,
                ...team(e.teamB).memberIds,
              ],
              published: true,
              version: 0,
            },
            `${e.id}-rubber-${index}`,
          );
        edit("rubbers", r, {
          status: index < rules.winsRequired ? "Final" : "Not required",
          winner: index < rules.winsRequired ? winner : null,
          outcome: "forfeit",
          version: r.version + 1,
        });
        if (index < rules.winsRequired)
          make("rubberResults", {
            encounterId: e.id,
            rubberId: r.id,
            score: { winner, sets: [], outcome: "forfeit", notes: data.reason },
            state: "Final",
            baseVersion: r.version,
            version: r.version + 1,
            submittedBy: uid,
            confirmedBy: uid,
            participantIds: r.participantIds,
            published: true,
          });
      }
      refreshEncounter(e);
      return { status: "Final" };
    }
    case "exportTeamReport": {
      admin();
      const rows = list("teams").map((t) => {
        const r = list("registrations").find((r) => r.id === t.registrationId);
        return {
          team: t.name,
          captain: t.captainId,
          registration: r?.state ?? "Roster pending",
          combinedReference: t.combinedReference ?? "",
          roster: t.roster.map((p: any) => p.displayName).join(" / "),
          withdrawn: t.withdrawn,
        };
      });
      return { csv: csv(rows) };
    }
    default:
      fail("Unknown team competition action");
  }
}
