import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import {
  competitionRulesSchema,
  defaultKocRules,
  defaultDoublesRules,
  type CompetitionRules,
} from "@pprc/shared";

const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
let env: RulesTestEnvironment;
const admin = "competition-admin",
  organizer = "competition-organizer",
  other = "competition-other",
  support = "competition-support";
const player = (i: number) => `competition-p${i}`;
const request = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const profile = {
  displayName: "Competition player",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Club",
  externalRating: 4,
  singlesUtr: 4,
  doublesUtr: 4.5,
  handedness: "Right",
  availability: "Weekends",
  emergencyContact: "Private synthetic contact",
  visibility: "private",
  notificationPreferences: { inApp: true, push: false },
};
type Fixture = { id: string; rules: CompetitionRules; teams: any[] };
const call = (f: Fixture, uid: string, action: string, data: any = {}) =>
  execute("teamCompetition", uid, request({ eventId: f.id, action, ...data }));
const records = async (f: Fixture, c: string) =>
  (await db.collection(c).where("eventId", "==", f.id).get()).docs.map(
    (d) => ({ id: d.id, ...d.data() }) as any,
  );
const load = async (c: string, id: string) =>
  ({ id, ...(await db.doc(`${c}/${id}`).get()).data() }) as any;
const captain = async (id: string) => (await load("teams", id)).captainId;
const format = (r: CompetitionRules) =>
  r.stageFormat === "groups-playoffs" ? "round-robin-playoffs" : r.stageFormat;
async function create(
  kind: "koc" | "doubles",
  capacity: number,
  changes: Partial<CompetitionRules> = {},
  publish = true,
): Promise<Fixture> {
  const preset = kind === "doubles" ? defaultDoublesRules : defaultKocRules;
  const rules = competitionRulesSchema.parse({
    ...preset,
    allowedDoublesPairs: undefined,
    winsRequired: undefined,
    policyConfirmed: true,
    ...changes,
  });
  const iso = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString();
  const event = {
    name: `Synthetic ${kind} ${randomUUID().slice(0, 8)}`,
    description: "Shared engine lifecycle",
    competition: kind,
    teamRules: rules,
    venue: "PPRC",
    location: "Prosper",
    startDate: iso(8),
    endDate: iso(11),
    timezone: "UTC",
    visibility: "private",
    fee: 0,
    capacity,
    waitlist: true,
    registrationOpen: iso(-1),
    registrationClose: iso(7),
    waiverRequired: true,
    refundPolicy: "Synthetic only",
    organizer: "PPRC",
    assignedAdmins: [organizer],
    courtIds: ["competition-court1", "competition-court2"],
    duration: 60,
    buffer: 0,
    dailyStartHour: 0,
    dailyEndHour: 24,
  };
  const result = await execute(
    "createEvent",
    admin,
    request({
      event,
      divisions: [{ name: "Teams", format: format(rules), capacity }],
    }),
  );
  const fixture = { id: result.eventId, rules, teams: [] };
  if (publish)
    await execute("publishEvent", admin, request({ eventId: fixture.id }));
  return fixture;
}
async function roster(f: Fixture, index: number, inspectFourth = false) {
  const start = index * f.rules.teamSize,
    uid = player(start);
  const made = await call(f, uid, "createTeam", {
    name: `Squad ${index + 1}`,
    waiver: true,
  });
  for (let n = 1; n < f.rules.teamSize; n++) {
    const invitation = await call(f, uid, "invitePlayer", {
      teamId: made.teamId,
      playerId: player(start + n),
      slot: `P${n + 1}`,
    });
    if (inspectFourth && n === 3) {
      await expect(
        call(f, uid, "registerTeam", {
          teamId: made.teamId,
          divisionId: `${f.id}-d1`,
        }),
      ).rejects.toThrow("confirmed");
      await expect(
        call(f, player(23), "respondInvitation", {
          invitationId: invitation.invitationId,
          accepted: true,
          waiver: true,
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    await call(f, player(start + n), "respondInvitation", {
      invitationId: invitation.invitationId,
      accepted: true,
      waiver: true,
    });
  }
  const team = await load("teams", made.teamId);
  f.teams.push(team);
  return team;
}
async function registerApprove(f: Fixture, t: any, index: number) {
  const r = await call(f, t.captainId, "registerTeam", {
    teamId: t.id,
    divisionId: `${f.id}-d1`,
    ratingSnapshots: [{ reference: 0 }],
    combinedReference: 0,
  });
  await call(f, organizer, "approveTeam", {
    teamId: t.id,
    seed: index + 1,
    reason: "Reviewed synthetic roster and references",
  });
  return load("registrations", r.registrationId);
}
async function entrants(f: Fixture, count: number) {
  for (let i = 0; i < count; i++)
    await registerApprove(f, await roster(f, i), i);
}
async function fixtures(f: Fixture) {
  if (f.rules.stageFormat !== "single-elimination")
    await call(f, organizer, "assignGroups");
  await call(f, organizer, "generateFixtures");
  return records(f, "teamEncounters");
}
const lineup = (f: Fixture, t: any) => ({
  singles: t.roster
    .slice(0, f.rules.singlesRubbers)
    .map((p: any) => p.playerId),
  doubles: Array.from({ length: f.rules.doublesRubbers }, () => ({
    players: t.roster.slice(-2).map((p: any) => p.playerId),
  })),
  tiebreak: f.rules.decidingTiebreak
    ? t.roster.slice(-f.rules.tiebreakPlayers).map((p: any) => p.playerId)
    : [],
});
async function ready(f: Fixture, e: any) {
  for (const id of [e.teamA, e.teamB]) {
    const t = await load("teams", id);
    await call(f, t.captainId, "submitLineup", {
      teamId: id,
      encounterId: e.id,
      lineup: lineup(f, t),
    });
  }
  if (f.rules.encounterConfirmation === "explicit")
    for (const id of [e.teamA, e.teamB])
      await call(f, await captain(id), "confirmEncounter", {
        teamId: id,
        encounterId: e.id,
      });
}
function score(f: Fixture, r: any, winner: string) {
  const hi =
    r.kind === "tiebreak"
      ? f.rules.decidingTiebreakTarget
      : f.rules.pointsOnly
        ? f.rules.pointsTarget
        : f.rules.setGames;
  const set =
    winner === r.teamA
      ? { a: hi, b: Math.max(0, hi - 3) }
      : { a: Math.max(0, hi - 3), b: hi };
  return {
    winner,
    sets: Array.from(
      {
        length:
          r.kind === "tiebreak" || f.rules.rubberScoring === "one-set" ? 1 : 2,
      },
      () => ({ ...set }),
    ),
    outcome: "played",
  };
}
async function finishRubber(f: Fixture, r: any, winner: string) {
  const res = await call(f, await captain(r.teamA), "submitRubberScore", {
    rubberId: r.id,
    baseVersion: r.version,
    score: score(f, r, winner),
  });
  await call(f, await captain(r.teamB), "confirmRubberScore", {
    resultId: res.resultId,
  });
  return res.resultId;
}
async function play(f: Fixture, e: any, winner: string) {
  await ready(f, e);
  for (const r of (await records(f, "rubbers"))
    .filter((r) => r.encounterId === e.id)
    .sort((a, b) => a.index - b.index)) {
    if ((await load("rubbers", r.id)).status === "Scheduled")
      await finishRubber(f, r, winner);
  }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Synthetic local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  env = await initializeTestEnvironment({
    projectId: "demo-pprc-events",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
  for (const uid of [
    admin,
    organizer,
    other,
    support,
    ...Array.from({ length: 24 }, (_, i) => player(i)),
  ]) {
    await execute(
      "saveProfile",
      uid,
      request({ profile: { ...profile, displayName: uid } }),
    );
    await db
      .doc(`memberships/${uid}`)
      .set({
        clubId: "pprc",
        member: true,
        role:
          uid === admin
            ? "clubAdmin"
            : [organizer, other].includes(uid)
              ? "eventAdmin"
              : uid === support
                ? "platformAdmin"
                : "player",
      });
  }
  for (const id of ["competition-court1", "competition-court2"])
    await db
      .doc(`courts/${id}`)
      .set({ id, clubId: "pprc", active: true, name: id });
}, 60000);
afterAll(async () => {
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});
let koc: Fixture, first: any;
describe.sequential(
  "KOC and doubles through the shared Firebase competition engine",
  () => {
    it("requires authenticated callables and an explicit, authorized KOC policy before publication", async () => {
      const r = await fetch(
        "http://127.0.0.1:5001/demo-pprc-events/us-central1/teamCompetition",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: {} }),
        },
      );
      expect(r.status).toBe(401);
      koc = await create("koc", 4, { policyConfirmed: false }, false);
      await expect(
        execute("publishEvent", admin, request({ eventId: koc.id })),
      ).rejects.toThrow("confirm");
      for (const uid of [other, support, player(0)])
        await expect(
          call(koc, uid, "configure", {
            rules: { ...koc.rules, policyConfirmed: true },
            reason: "Unprivileged policy attempt",
          }),
        ).rejects.toMatchObject({ code: "permission-denied" });
      koc.rules = { ...koc.rules, policyConfirmed: true };
      await call(koc, organizer, "configure", {
        rules: koc.rules,
        reason: "Organizer reviewed KOC policy",
      });
      await execute("publishEvent", organizer, request({ eventId: koc.id }));
    });
    it("persists four-player consented rosters, rejects unauthorized invitations and waits for P4", async () => {
      for (let i = 0; i < 4; i++) await roster(koc, i, i === 0);
      await expect(
        call(koc, player(4), "invitePlayer", {
          teamId: koc.teams[0].id,
          playerId: player(20),
          slot: "P4",
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(
        (await load("teams", koc.teams[0].id)).roster.map((p: any) => p.slot),
      ).toEqual(["P1", "P2", "P3", "P4"]);
      await assertFails(
        getDoc(
          doc(
            env.authenticatedContext(player(20)).firestore(),
            "teams",
            koc.teams[0].id,
          ),
        ),
      );
      await assertFails(
        setDoc(
          doc(
            env.authenticatedContext(player(4)).firestore(),
            "teams",
            koc.teams[0].id,
          ),
          { captainId: player(4) },
        ),
      );
    });
    it("ignores browser-supplied eligibility values and preserves server snapshots after reference edits", async () => {
      for (let i = 0; i < 4; i++) {
        const reg = await registerApprove(koc, koc.teams[i], i);
        expect(reg.combinedReference).toBe(18);
        expect(reg.ratingSnapshots).toHaveLength(4);
      }
      const before = await records(koc, "ratingSnapshots");
      await execute(
        "saveProfile",
        player(0),
        request({
          profile: {
            ...profile,
            displayName: player(0),
            singlesUtr: 6,
            doublesUtr: 6,
          },
        }),
      );
      expect(await records(koc, "ratingSnapshots")).toEqual(before);
      await expect(
        call(koc, organizer, "configure", {
          rules: koc.rules,
          reason: "Attempt late rule change",
        }),
      ).rejects.toThrow("locked");
    });
    it("uses common group fixtures and court scheduling with private lineups and explicit opposing confirmation", async () => {
      const games = await fixtures(koc);
      expect(games).toHaveLength(6);
      await call(koc, organizer, "generateTeamSchedule");
      first = games[0];
      const a = await load("teams", first.teamA),
        b = await load("teams", first.teamB);
      await call(koc, a.captainId, "submitLineup", {
        teamId: a.id,
        encounterId: first.id,
        lineup: lineup(koc, a),
      });
      await assertFails(
        getDoc(
          doc(
            env.authenticatedContext(b.captainId).firestore(),
            "lineups",
            `${first.id}-${a.id}`,
          ),
        ),
      );
      await call(koc, b.captainId, "submitLineup", {
        teamId: b.id,
        encounterId: first.id,
        lineup: lineup(koc, b),
      });
      await assertSucceeds(
        getDoc(
          doc(
            env.authenticatedContext(b.captainId).firestore(),
            "lineups",
            `${first.id}-${a.id}`,
          ),
        ),
      );
      const r = (await records(koc, "rubbers")).find(
        (r) => r.encounterId === first.id,
      )!;
      await expect(
        call(koc, a.captainId, "submitRubberScore", {
          rubberId: r.id,
          baseVersion: 0,
          score: score(koc, r, a.id),
        }),
      ).rejects.toThrow("captains");
      for (const t of [a, b])
        await call(koc, t.captainId, "confirmEncounter", {
          teamId: t.id,
          encounterId: first.id,
        });
      expect(
        (await load("teamEncounters", first.id)).confirmedTeamIds.sort(),
      ).toEqual([a.id, b.id].sort());
    });
    it("serializes score confirmation, retains disputes and rebuilds standings after a correction", async () => {
      const preferred = koc.teams.find((t) =>
        [first.teamA, first.teamB].includes(t.id),
      )!.id;
      const rs = (await records(koc, "rubbers"))
          .filter((r) => r.encounterId === first.id)
          .sort((a, b) => a.index - b.index),
        uid = await captain(first.teamA),
        opponent = await captain(first.teamB);
      const submitted = await call(koc, uid, "submitRubberScore", {
        rubberId: rs[0].id,
        baseVersion: 0,
        score: score(koc, rs[0], preferred),
      });
      await expect(
        call(koc, uid, "confirmRubberScore", { resultId: submitted.resultId }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      const raced = await Promise.allSettled([
        call(koc, opponent, "confirmRubberScore", {
          resultId: submitted.resultId,
        }),
        call(koc, opponent, "confirmRubberScore", {
          resultId: submitted.resultId,
        }),
      ]);
      expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await load("rubbers", rs[0].id)).version).toBe(1);
      await finishRubber(koc, rs[1], preferred);
      expect((await load("teamEncounters", first.id)).status).toBe("Final");
      const dispute = await call(koc, uid, "disputeRubber", {
        resultId: submitted.resultId,
        reason: "Both teams reviewed recorded winner",
      });
      await expect(
        call(koc, player(20), "resolveDispute", {
          disputeId: dispute.disputeId,
          resolution: "uphold",
          reason: "Unauthorized review attempt",
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      const corrected = preferred === first.teamA ? first.teamB : first.teamA;
      await call(koc, organizer, "resolveDispute", {
        disputeId: dispute.disputeId,
        resolution: "correct",
        score: score(koc, rs[0], corrected),
        reason: "Organizer applied agreed correction",
      });
      expect((await load("rubberResults", submitted.resultId)).state).toBe(
        "Superseded",
      );
      expect((await load("teamEncounters", first.id)).status).toBe(
        "In Progress",
      );
      await finishRubber(koc, rs[2], preferred);
      expect((await load("teamEncounters", first.id)).winner).toBe(preferred);
    });
    it("qualifies exactly once, plays the final and persists champion plus runner-up", async () => {
      for (const e of (await records(koc, "teamEncounters")).filter(
        (e) => e.id !== first.id,
      )) {
        const winner = koc.teams.find((t) =>
          [e.teamA, e.teamB].includes(t.id),
        )!.id;
        await call(koc, organizer, "forfeitEncounter", {
          encounterId: e.id,
          winner,
          reason: "Synthetic opponent absence recorded",
        });
      }
      const rows = (await records(koc, "teamGroups"))[0].standings;
      expect(rows.map((r: any) => r.wins)).toEqual([3, 2, 1, 0]);
      const race = await Promise.allSettled([
        call(koc, organizer, "generateTeamPlayoffs"),
        call(koc, organizer, "generateTeamPlayoffs"),
      ]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const finals = (await records(koc, "teamEncounters")).filter(
        (e) => e.phase === "playoffs",
      );
      expect(finals).toHaveLength(1);
      await play(koc, finals[0], koc.teams[0].id);
      const event = await load("events", koc.id);
      expect(event).toMatchObject({
        status: "Completed",
        championTeamId: koc.teams[0].id,
        runnerUpTeamId: koc.teams[1].id,
      });
    });
    it("completes doubles round robin, suspends a disputed title and retains corrected result history", async () => {
      const f = await create("doubles", 3);
      await entrants(f, 3);
      const games = await fixtures(f);
      for (const e of games)
        await play(
          f,
          e,
          f.teams.find((t) => [e.teamA, e.teamB].includes(t.id))!.id,
        );
      expect((await load("events", f.id)).championTeamId).toBe(f.teams[0].id);
      const target = games.find(
        (e) =>
          [e.teamA, e.teamB].includes(f.teams[0].id) &&
          [e.teamA, e.teamB].includes(f.teams[1].id),
      );
      const result = (await records(f, "rubberResults")).find(
          (r) => r.encounterId === target.id,
        ),
        r = await load("rubbers", result.rubberId),
        winner = f.teams[1].id;
      const dispute = await call(f, await captain(r.teamA), "disputeRubber", {
        resultId: result.id,
        reason: "Correct synthetic doubles record",
      });
      expect((await load("events", f.id)).championTeamId).toBeNull();
      await call(f, organizer, "resolveDispute", {
        disputeId: dispute.disputeId,
        resolution: "correct",
        score: score(f, r, winner),
        reason: "Both teams confirmed corrected match winner",
      });
      expect((await load("rubberResults", result.id)).state).toBe("Superseded");
      const g = (await records(f, "teamGroups"))[0];
      if (g.standings[0].tied)
        await call(f, organizer, "resolveTeamTies", {
          groupId: g.id,
          teamIds: g.teamIds,
          reason: "Reviewed tied season results explicitly",
        });
      const event = await load("events", f.id);
      expect(event.status).toBe("Completed");
      expect(event.championTeamId).toBe(f.teams[1].id);
      expect(event.runnerUpTeamId).toBe(f.teams[0].id);
    });
    it("generates doubles knockout byes and advances verified pair results without duplicate finals", async () => {
      const f = await create("doubles", 3, {
        stageFormat: "single-elimination",
        rubberScoring: "one-set",
      });
      await entrants(f, 3);
      const games = await fixtures(f);
      expect(games.filter((e) => e.status === "Bye")).toHaveLength(1);
      expect(games.find((e) => e.status === "Bye")!.winner).toBe(f.teams[0].id);
      for (const e of games
        .filter((e) => e.status !== "Bye")
        .sort((a, b) => a.round - b.round)) {
        const fresh = await load("teamEncounters", e.id);
        await play(
          f,
          fresh,
          f.teams.find((t) => [fresh.teamA, fresh.teamB].includes(t.id))!.id,
        );
      }
      expect(await load("events", f.id)).toMatchObject({
        championTeamId: f.teams[0].id,
        runnerUpTeamId: f.teams[1].id,
        status: "Completed",
      });
      expect(
        (await records(f, "teamEncounters")).filter((e) => !e.nextId),
      ).toHaveLength(1);
    });
    it("runs doubles group-stage playoffs through the same semifinal and final engine", async () => {
      const f = await create("doubles", 4, {
        stageFormat: "groups-playoffs",
        groupCount: 2,
        qualifiersPerGroup: 2,
        rubberScoring: "one-set",
      });
      await entrants(f, 4);
      const groups = await fixtures(f);
      for (const e of groups)
        await play(
          f,
          e,
          f.teams.find((t) => [e.teamA, e.teamB].includes(t.id))!.id,
        );
      await call(f, organizer, "generateTeamPlayoffs");
      for (const e of (await records(f, "teamEncounters"))
        .filter((e) => e.phase === "playoffs")
        .sort((a, b) => a.round - b.round || a.position - b.position)) {
        const fresh = await load("teamEncounters", e.id);
        await play(
          f,
          fresh,
          f.teams.find((t) => [fresh.teamA, fresh.teamB].includes(t.id))!.id,
        );
      }
      expect((await load("events", f.id)).championTeamId).toBe(f.teams[0].id);
      expect(
        (await records(f, "teamEncounters")).filter(
          (e) => e.phase === "playoffs",
        ),
      ).toHaveLength(3);
    });
    it("finalizes whole-encounter forfeits even when normal play-all-rubbers policy is selected", async () => {
      const f = await create("koc", 2, {
        stageFormat: "round-robin",
        stopAtClinch: false,
      });
      await entrants(f, 2);
      const [e] = await fixtures(f);
      await call(f, organizer, "forfeitEncounter", {
        encounterId: e.id,
        winner: e.teamA,
        reason: "Whole encounter conceded by opponent",
      });
      expect((await load("teamEncounters", e.id)).status).toBe("Final");
      const results = await records(f, "rubberResults");
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.score.sets.length === 0)).toBe(true);
    });
    it("enforces verified references, membership and deadlines, with an audited organizer extension", async () => {
      const f = await create("koc", 2, {
        requireVerified: true,
        membersOnly: true,
        lineupDeadlineMinutes: 60,
        resultDeadlineHours: 1,
      });
      for (let i = 0; i < 2; i++) await roster(f, i);
      await expect(
        call(f, player(0), "registerTeam", {
          teamId: f.teams[0].id,
          divisionId: `${f.id}-d1`,
        }),
      ).rejects.toThrow("verified");
      for (let i = 0; i < 8; i++)
        await execute(
          "manageClub",
          admin,
          request({
            target: "rating",
            id: player(i),
            rating: 4.5,
            singlesUtr: 4.5,
            doublesUtr: 4.5,
            reason: "Verified synthetic reference document",
          }),
        );
      await execute(
        "manageClub",
        admin,
        request({
          target: "membership",
          id: player(3),
          role: "player",
          member: false,
          reason: "Synthetic membership policy test",
        }),
      );
      await expect(
        call(f, player(0), "registerTeam", {
          teamId: f.teams[0].id,
          divisionId: `${f.id}-d1`,
        }),
      ).rejects.toThrow("membership");
      await execute(
        "manageClub",
        admin,
        request({
          target: "membership",
          id: player(3),
          role: "player",
          member: true,
          reason: "Restore synthetic approved membership",
        }),
      );
      for (let i = 0; i < 2; i++) await registerApprove(f, f.teams[i], i);
      const [e] = await fixtures(f);
      await execute(
        "updateEvent",
        admin,
        request({
          eventId: f.id,
          event: {
            startDate: new Date(Date.now() - 3 * 86400000).toISOString(),
            endDate: new Date(Date.now() + 3 * 86400000).toISOString(),
            registrationOpen: new Date(Date.now() - 5 * 86400000).toISOString(),
            registrationClose: new Date(
              Date.now() - 4 * 86400000,
            ).toISOString(),
          },
          reason: "Reschedule synthetic historical test window",
        }),
      );
      const schedule = async (future: boolean) => {
        const at = new Date(Date.now() + (future ? 86400000 : -86400000));
        at.setUTCHours(12, 0, 0, 0);
        return call(f, organizer, "scheduleEncounter", {
          encounterId: e.id,
          scheduledAt: at.toISOString(),
          courtId: "competition-court1",
          reason: "Audited synthetic match-time adjustment",
        });
      };
      await schedule(true);
      await call(f, f.teams[0].captainId, "submitLineup", {
        encounterId: e.id,
        teamId: f.teams[0].id,
        lineup: lineup(f, f.teams[0]),
      });
      await schedule(false);
      await expect(
        call(f, f.teams[1].captainId, "submitLineup", {
          encounterId: e.id,
          teamId: f.teams[1].id,
          lineup: lineup(f, f.teams[1]),
        }),
      ).rejects.toThrow("deadline");
      await schedule(true);
      await call(f, f.teams[1].captainId, "submitLineup", {
        encounterId: e.id,
        teamId: f.teams[1].id,
        lineup: lineup(f, f.teams[1]),
      });
      for (const t of f.teams)
        await call(f, t.captainId, "confirmEncounter", {
          encounterId: e.id,
          teamId: t.id,
        });
      await schedule(false);
      const r = (await records(f, "rubbers"))[0];
      await expect(
        call(f, await captain(e.teamA), "submitRubberScore", {
          rubberId: r.id,
          baseVersion: 0,
          score: score(f, r, e.teamA),
        }),
      ).rejects.toThrow("deadline");
      await call(f, organizer, "extendScoreDeadline", {
        encounterId: e.id,
        scoreDeadline: new Date(Date.now() + 3600000).toISOString(),
        reason: "Approve late entry for synthetic test",
      });
      await finishRubber(f, r, e.teamA);
    });
    it("denies foreign-club event, roster, reference and membership access through APIs and security rules", async () => {
      const foreign = {
        ...(await load("events", koc.id)),
        id: "competition-foreign-event",
        clubId: "foreign",
        visibility: "private",
        assignedAdmins: [organizer],
      };
      await db.doc(`events/${foreign.id}`).set(foreign);
      for (const uid of [admin, organizer, support, player(0)]) {
        await expect(
          execute(
            "teamCompetition",
            uid,
            request({ eventId: foreign.id, action: "exportTeamReport" }),
          ),
        ).rejects.toMatchObject({ code: "permission-denied" });
        await assertFails(
          getDoc(
            doc(
              env.authenticatedContext(uid).firestore(),
              "events",
              foreign.id,
            ),
          ),
        );
      }
      await db
        .doc("memberships/competition-foreign-member")
        .set({ clubId: "foreign", member: true, role: "clubAdmin" });
      await expect(
        execute(
          "manageClub",
          admin,
          request({
            target: "membership",
            id: "competition-foreign-member",
            role: "player",
            member: true,
            reason: "Attempt foreign-club overwrite",
          }),
        ),
      ).rejects.toMatchObject({ code: "permission-denied" });
      const snapshot = (await records(koc, "ratingSnapshots"))[0];
      await assertFails(
        setDoc(
          doc(
            env.authenticatedContext(player(0)).firestore(),
            "ratingSnapshots",
            snapshot.id,
          ),
          { reference: 0 },
        ),
      );
      await assertFails(
        getDoc(
          doc(
            env.authenticatedContext(admin).firestore(),
            "memberships",
            "competition-foreign-member",
          ),
        ),
      );
    });
  },
);
