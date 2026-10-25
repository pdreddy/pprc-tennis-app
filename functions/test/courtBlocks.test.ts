import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { defaultTriaceRules } from "@pprc/shared";

// Real Firestore emulator. Synthetic accounts, courts and teams only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const req = (x: any = {}) => ({ requestId: randomUUID(), ...x });
const admin = "block-admin",
  stranger = "block-stranger";
const courtA = "block-court-a",
  courtB = "block-court-b";
// Fixed future window: 08:00 Chicago (CDT) on the start day.
const startDate = "2031-03-17T13:00:00.000Z",
  endDate = "2031-03-21T13:00:00.000Z",
  scheduleAt = "2031-03-17T15:00:00.000Z";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  await db
    .doc(`memberships/${admin}`)
    .set({ clubId: "pprc", role: "clubAdmin", member: true });
  await db.doc(`users/${admin}`).set({
    id: admin,
    clubId: "pprc",
    displayName: "Block admin",
  });
  await db
    .doc(`memberships/${stranger}`)
    .set({ clubId: "pprc", role: "player", member: true });
  await execute(
    "manageClub",
    admin,
    req({
      target: "venue",
      id: "block-venue",
      value: { name: "Block venue", location: "Prosper, TX" },
      reason: "Synthetic venue for court-block tests",
    }),
  );
  for (const id of [courtA, courtB])
    await execute(
      "manageClub",
      admin,
      req({
        target: "court",
        id,
        value: {
          name: `Synthetic ${id}`,
          venueId: "block-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Synthetic court for court-block tests",
      }),
    );
}, 60000);

afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});

async function player(uid: string) {
  await db.doc(`users/${uid}`).set({
    id: uid,
    clubId: "pprc",
    displayName: uid,
    externalRating: 4.5,
    visibility: "private",
  });
  await db
    .doc(`memberships/${uid}`)
    .set({ clubId: "pprc", role: "player", member: true });
}

const act = (eid: string, uid: string, action: string, data: any = {}) =>
  execute("triace", uid, req({ eventId: eid, action, ...data }));

async function fixtureEvent(prefix: string) {
  const { eventId } = await execute(
    "createEvent",
    admin,
    req({
      event: {
        name: `Synthetic ${prefix}`,
        description: "Synthetic court-block scheduling test",
        venue: "Block venue",
        location: "Prosper, TX",
        startDate,
        endDate,
        timezone: "America/Chicago",
        visibility: "public",
        fee: 0,
        capacity: 4,
        waitlist: true,
        registrationOpen: new Date(Date.now() - 60000).toISOString(),
        registrationClose: new Date(Date.now() + 3600000).toISOString(),
        waiverRequired: true,
        refundPolicy: "Synthetic",
        sport: "Tennis",
        organizer: "PPRC",
        questions: [],
        assignedAdmins: [admin],
        courtIds: [courtA, courtB],
        competition: "triace",
        triaceRules: defaultTriaceRules,
      },
      divisions: [{ name: "Teams", format: "round-robin-playoffs", capacity: 4 }],
    }),
  );
  await execute("publishEvent", admin, req({ eventId }));
  // Four synthetic three-player teams satisfy the two-group minimum.
  const teams: { teamId: string; captain: string }[] = [];
  for (let t = 0; t < 4; t++) {
    const roster = [0, 1, 2].map((i) => `${prefix}-t${t}-p${i}`);
    for (const uid of roster) await player(uid);
    const team = await act(eventId, roster[0], "createTeam", {
      name: `${prefix} team ${t}`,
      waiver: true,
    });
    for (let i = 1; i < 3; i++) {
      const inv = await act(eventId, roster[0], "invitePlayer", {
        teamId: team.teamId,
        playerId: roster[i],
        slot: `P${i + 1}`,
      });
      await act(eventId, roster[i], "respondInvitation", {
        invitationId: inv.invitationId,
        accepted: true,
        waiver: true,
      });
    }
    await act(eventId, roster[0], "registerTeam", {
      teamId: team.teamId,
      divisionId: `${eventId}-d1`,
    });
    await act(eventId, admin, "approveTeam", {
      teamId: team.teamId,
      seed: t + 1,
      reason: "Synthetic approved seed",
    });
    teams.push({ teamId: team.teamId, captain: roster[0] });
  }
  await act(eventId, admin, "assignGroups", {
    reason: "Reviewed group assignment before fixtures",
  });
  await act(eventId, admin, "generateFixtures");
  const encounters = await db
    .collection("teamEncounters")
    .where("eventId", "==", eventId)
    .get();
  expect(encounters.size).toBeGreaterThan(0);
  return { eventId, encounterIds: encounters.docs.map((d) => d.id), teams };
}

const blockIds = async (courtId: string) =>
  (
    await db.collection("courtBlocks").where("courtId", "==", courtId).get()
  ).docs.map((d) => d.id);

// Returns only the block created by this call.
async function blockCourt(courtId: string, reason = "Resurfacing") {
  const before = await blockIds(courtId);
  await execute(
    "manageClub",
    admin,
    req({
      target: "courtBlock",
      action: "add",
      value: { courtId, start: startDate, end: endDate, reason },
      reason: "Scheduled court maintenance",
    }),
  );
  return (await blockIds(courtId)).filter((id) => !before.includes(id));
}

async function unblock(blockId: string) {
  await execute(
    "manageClub",
    admin,
    req({
      target: "courtBlock",
      action: "remove",
      blockId,
      reason: "Maintenance finished",
    }),
  );
}

describe("court maintenance blocks", () => {
  it("keeps every generated fixture off a court blocked for the whole event", async () => {
    const { eventId, encounterIds } = await fixtureEvent("block-sched");
    const [blockId] = await blockCourt(courtA);
    expect(blockId).toBeTruthy();
    await act(eventId, admin, "generateTeamSchedule", {
      reason: "Generate around maintenance",
    });
    for (const id of encounterIds) {
      const encounter = (await db.doc(`teamEncounters/${id}`).get()).data()!;
      expect(encounter.scheduledAt).toBeTruthy();
      expect(encounter.courtId).toBe(courtB);
    }
    await unblock(blockId);
  }, 60000);

  it("rejects a scheduled slot on a blocked court and accepts it once the block is removed", async () => {
    const { eventId, encounterIds } = await fixtureEvent("block-move");
    const [blockId] = await blockCourt(courtA, "Net replacement");
    expect(blockId).toBeTruthy();
    const encounterId = encounterIds[0];
    await expect(
      act(eventId, admin, "scheduleEncounter", {
        encounterId,
        scheduledAt: scheduleAt,
        courtId: courtA,
        reason: "Attempt blocked court",
      }),
    ).rejects.toThrow("scheduling conflict");
    // Removal is an audited write with its own reason.
    await unblock(blockId);
    expect((await db.doc(`courtBlocks/${blockId}`).get()).exists).toBe(false);
    await act(eventId, admin, "scheduleEncounter", {
      encounterId,
      scheduledAt: scheduleAt,
      courtId: courtA,
      reason: "Court reopened",
    });
    const moved = (await db.doc(`teamEncounters/${encounterId}`).get()).data()!;
    expect(moved.courtId).toBe(courtA);
  }, 60000);

  it("denies unauthorized, inverted and foreign-court block requests", async () => {
    await expect(
      execute(
        "manageClub",
        stranger,
        req({
          target: "courtBlock",
          action: "add",
          value: { courtId: courtA, start: startDate, end: endDate, reason: "Forged" },
          reason: "Unauthorized attempt",
        }),
      ),
    ).rejects.toThrow("Club administrator");
    await expect(
      execute(
        "manageClub",
        admin,
        req({
          target: "courtBlock",
          action: "add",
          value: { courtId: courtA, start: endDate, end: startDate, reason: "Inverted" },
          reason: "Invalid window",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      execute(
        "manageClub",
        admin,
        req({
          target: "courtBlock",
          action: "add",
          value: {
            courtId: "block-missing-court",
            start: startDate,
            end: endDate,
            reason: "Missing court",
          },
          reason: "Unknown court",
        }),
      ),
    ).rejects.toThrow("active PPRC court");
  }, 60000);

  it("keeps blocks when the court record itself is edited", async () => {
    const [blockId] = await blockCourt(courtB, "Drainage repair");
    expect(blockId).toBeTruthy();
    await execute(
      "manageClub",
      admin,
      req({
        target: "court",
        id: courtB,
        value: {
          name: "Synthetic court renamed",
          venueId: "block-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Rename court",
      }),
    );
    expect((await db.doc(`courtBlocks/${blockId}`).get()).exists).toBe(true);
    await unblock(blockId);
  }, 60000);
});
