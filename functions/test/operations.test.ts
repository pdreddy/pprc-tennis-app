import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { runEventMaintenance } from "../src/maintenance";
import { defaultTriaceRules } from "@pprc/shared";
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const req = (x: any = {}) => ({ requestId: randomUUID(), ...x });
let sequence = 0;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  await db
    .doc("memberships/operations-admin")
    .set({ clubId: "pprc", role: "clubAdmin", member: true });
  await db.doc("users/operations-admin").set({
    id: "operations-admin",
    clubId: "pprc",
    displayName: "Operations admin",
  });
}, 30000);
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});
async function newEvent(capacity = 4) {
  const event = {
    name: `Synthetic operations ${sequence++}`,
    description: "Synthetic concurrency and policy test",
    venue: "PPRC",
    location: "Synthetic",
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 4 * 86400000).toISOString(),
    timezone: "America/Chicago",
    visibility: "public",
    fee: 0,
    capacity,
    waitlist: true,
    registrationOpen: new Date(Date.now() - 60000).toISOString(),
    registrationClose: new Date(Date.now() + 3600000).toISOString(),
    waiverRequired: true,
    refundPolicy: "Synthetic",
    sport: "Tennis",
    organizer: "PPRC",
    questions: [],
    assignedAdmins: ["operations-admin"],
    courtIds: [],
    competition: "triace",
    triaceRules: defaultTriaceRules,
  };
  const { eventId } = await execute(
    "createEvent",
    "operations-admin",
    req({
      event,
      divisions: [{ name: "Teams", format: "round-robin-playoffs", capacity }],
    }),
  );
  await execute("publishEvent", "operations-admin", req({ eventId }));
  return eventId as string;
}
async function player(uid: string, rating = 4.5) {
  await db.doc(`users/${uid}`).set({
    id: uid,
    clubId: "pprc",
    displayName: uid,
    externalRating: rating,
    visibility: "private",
  });
  await db
    .doc(`memberships/${uid}`)
    .set({ clubId: "pprc", role: "player", member: true });
}
const act = (eid: string, uid: string, action: string, data: any = {}) =>
  execute("triace", uid, req({ eventId: eid, action, ...data }));
async function createRoster(eid: string, prefix: string, rating = 4.5) {
  const roster = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];
  for (const uid of roster) await player(uid, rating);
  const team = await act(eid, roster[0], "createTeam", {
    name: prefix,
    waiver: true,
  });
  for (let i = 1; i < 3; i++) {
    const inv = await act(eid, roster[0], "invitePlayer", {
      teamId: team.teamId,
      playerId: roster[i],
      slot: `P${i + 1}`,
    });
    await act(eid, roster[i], "respondInvitation", {
      invitationId: inv.invitationId,
      accepted: true,
      waiver: true,
    });
  }
  return { ...team, captain: roster[0], roster };
}
it("serializes simultaneous invitation acceptance so a player cannot join two teams", async () => {
  const eid = await newEvent();
  for (const uid of ["race-cap-a", "race-cap-b", "race-invitee"])
    await player(uid);
  const teams = await Promise.all(
    ["race-cap-a", "race-cap-b"].map((uid, i) =>
      act(eid, uid, "createTeam", { name: `Race team ${i}`, waiver: true }),
    ),
  );
  const invites = await Promise.all(
    teams.map((t, i) =>
      act(eid, `race-cap-${i ? "b" : "a"}`, "invitePlayer", {
        teamId: t.teamId,
        playerId: "race-invitee",
        slot: "P2",
      }),
    ),
  );
  const results = await Promise.allSettled(
    invites.map((i) =>
      act(eid, "race-invitee", "respondInvitation", {
        invitationId: i.invitationId,
        accepted: true,
        waiver: true,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const enrolled = await db
    .collection("teams")
    .where("eventId", "==", eid)
    .where("memberIds", "array-contains", "race-invitee")
    .get();
  expect(enrolled.size).toBe(1);
}, 60000);
it("supports declined and revoked invitations without occupying a roster slot", async () => {
  const eid = await newEvent();
  for (const uid of ["inv-cap", "inv-player"]) await player(uid);
  const team = await act(eid, "inv-cap", "createTeam", {
    name: "Invitation controls",
    waiver: true,
  });
  const invite = await act(eid, "inv-cap", "invitePlayer", {
    teamId: team.teamId,
    playerId: "inv-player",
    slot: "P2",
  });
  await act(eid, "inv-player", "respondInvitation", {
    invitationId: invite.invitationId,
    accepted: false,
  });
  const next = await act(eid, "inv-cap", "invitePlayer", {
    teamId: team.teamId,
    playerId: "inv-player",
    slot: "P2",
  });
  await expect(
    act(eid, "inv-player", "revokeInvitation", {
      invitationId: next.invitationId,
    }),
  ).rejects.toThrow("captain");
  await act(eid, "inv-cap", "revokeInvitation", {
    invitationId: next.invitationId,
  });
  expect(
    (await db.doc(`invitations/${next.invitationId}`).get()).get("status"),
  ).toBe("Revoked");
}, 60000);
it("serializes team capacity, promotes the waitlist after withdrawal and preserves idempotency", async () => {
  const eid = await newEvent(2),
    teams = [];
  for (let i = 0; i < 3; i++)
    teams.push(await createRoster(eid, `capacity-${i}`));
  const results = await Promise.all(
    teams.map((t) =>
      act(eid, t.captain, "registerTeam", {
        teamId: t.teamId,
        divisionId: `${eid}-d1`,
      }),
    ),
  );
  expect(results.filter((r) => r.state === "Registered")).toHaveLength(2);
  expect(results.filter((r) => r.state === "Waitlisted")).toHaveLength(1);
  const index = results.findIndex((r) => r.state === "Registered"),
    waiting = results.find((r) => r.state === "Waitlisted")!;
  await act(eid, teams[index].captain, "withdrawTeam", {
    teamId: teams[index].teamId,
    reason: "Synthetic captain withdrawal",
  });
  expect(
    (await db.doc(`registrations/${waiting.registrationId}`).get()).get(
      "state",
    ),
  ).toBe("Registered");
  await player("idempotent-captain");
  const input = req({
    eventId: eid,
    action: "createTeam",
    name: "Idempotent team",
    waiver: true,
  });
  const a = await execute("triace", "idempotent-captain", input),
    b = await execute("triace", "idempotent-captain", input);
  expect(a).toEqual(b);
  await expect(
    execute("triace", "idempotent-captain", { ...input, name: "Changed team" }),
  ).rejects.toThrow("reused");
}, 120000);
it("enforces combined reference boundaries on the trusted registration path", async () => {
  const eid = await newEvent(),
    low = await createRoster(eid, "below-reference", 3.9),
    high = await createRoster(eid, "above-reference", 6.2);
  for (const t of [low, high])
    await expect(
      act(eid, t.captain, "registerTeam", {
        teamId: t.teamId,
        divisionId: `${eid}-d1`,
      }),
    ).rejects.toThrow("outside");
}, 60000);
it("enforces 40% participation before playoff creation and cancels rubbers after a three-win clinch", async () => {
  const eid = await newEvent(),
    teams = [];
  for (let i = 0; i < 4; i++) {
    const t = await createRoster(eid, `eligibility-${i}`);
    teams.push(t);
    await act(eid, t.captain, "registerTeam", {
      teamId: t.teamId,
      divisionId: `${eid}-d1`,
    });
    await act(eid, "operations-admin", "approveTeam", {
      teamId: t.teamId,
      seed: i + 1,
      reason: "Synthetic approved seed",
    });
  }
  await act(eid, "operations-admin", "assignGroups");
  await expect(act(eid, "operations-admin", "assignGroups")).rejects.toThrow();
  await act(eid, "operations-admin", "assignGroups", {
    reason: "Reviewed group assignment before fixtures",
  });
  await act(eid, "operations-admin", "generateFixtures");
  const games = await db
    .collection("teamEncounters")
    .where("eventId", "==", eid)
    .get();
  for (const game of games.docs) {
    const e = game.data();
    for (const teamId of [e.teamA, e.teamB]) {
      const t = teams.find((t) => t.teamId === teamId)!;
      await act(eid, t.captain, "submitLineup", {
        teamId,
        encounterId: game.id,
        lineup: {
          singles: t.roster.slice(0, 2),
          doubles: [
            { players: t.roster.slice(0, 2) },
            { players: t.roster.slice(1) },
          ],
          tiebreak: [t.roster[2]],
        },
      });
    }
    const a = teams.find((t) => t.teamId === e.teamA)!,
      b = teams.find((t) => t.teamId === e.teamB)!;
    for (let index = 0; index < 3; index++) {
      const input = req({
        eventId: eid,
        action: "submitRubberScore",
        rubberId: `${game.id}-rubber-${index}`,
        baseVersion: 0,
        score: {
          winner: a.teamId,
          sets: [{ a: 6, b: 2 }],
          outcome: "played",
          notes: "",
        },
      });
      const result = await execute("triace", a.captain, input);
      expect(await execute("triace", a.captain, input)).toEqual(result);
      await act(eid, b.captain, "confirmRubberScore", {
        resultId: result.resultId,
      });
    }
    expect(
      (await db.doc(`rubbers/${game.id}-rubber-3`).get()).get("status"),
    ).toBe("Not required");
  }
  await expect(
    act(eid, "operations-admin", "generateTeamPlayoffs"),
  ).rejects.toThrow("participation");
}, 120000);
it("records administrative encounter forfeits without fabricated participation", async () => {
  const eid = await newEvent(),
    teams = [];
  for (let i = 0; i < 4; i++) {
    const t = await createRoster(eid, `forfeit-${i}`);
    teams.push(t);
    await act(eid, t.captain, "registerTeam", {
      teamId: t.teamId,
      divisionId: `${eid}-d1`,
    });
    await act(eid, "operations-admin", "approveTeam", {
      teamId: t.teamId,
      seed: i + 1,
      reason: "Synthetic approved seed",
    });
  }
  await act(eid, "operations-admin", "assignGroups");
  await act(eid, "operations-admin", "generateFixtures");
  const e = (
    await db.collection("teamEncounters").where("eventId", "==", eid).get()
  ).docs[0];
  await act(eid, "operations-admin", "forfeitEncounter", {
    encounterId: e.id,
    winner: e.get("teamA"),
    reason: "Opponent team absent at fixture",
  });
  expect((await e.ref.get()).get("winsA")).toBe(3);
  const results = await db
    .collection("rubberResults")
    .where("encounterId", "==", e.id)
    .get();
  expect(results.size).toBe(3);
  expect(results.docs.every((r) => r.get("score.sets").length === 0)).toBe(
    true,
  );
}, 120000);
it("deduplicates scheduled individual and team reminders in real Firestore", async () => {
  const eid = await newEvent(),
    start = new Date(Date.now() + 10 * 60000).toISOString();
  await db.doc(`events/${eid}`).update({ status: "Check-In" });
  await db.doc(`matches/${eid}-reminder`).set({
    id: `${eid}-reminder`,
    clubId: "pprc",
    eventId: eid,
    p1: "reminder-a",
    p2: "reminder-b",
    scheduledAt: start,
    status: "Scheduled",
  });
  await db.doc(`teams/${eid}-a`).set({
    eventId: eid,
    memberIds: ["reminder-c", "reminder-d", "reminder-e"],
  });
  await db.doc(`teams/${eid}-b`).set({
    eventId: eid,
    memberIds: ["reminder-f", "reminder-g", "reminder-h"],
  });
  await db.doc(`teamEncounters/${eid}-reminder`).set({
    id: `${eid}-reminder`,
    clubId: "pprc",
    eventId: eid,
    teamA: `${eid}-a`,
    teamB: `${eid}-b`,
    scheduledAt: start,
    status: "Ready",
  });
  await runEventMaintenance();
  await runEventMaintenance();
  const notifications = await db
    .collection("notifications")
    .where("eventId", "==", eid)
    .get();
  expect(
    notifications.docs.filter((n) => n.get("type") === "match-reminder"),
  ).toHaveLength(2);
  expect(
    notifications.docs.filter((n) => n.get("type") === "team-reminder"),
  ).toHaveLength(6);
}, 60000);
