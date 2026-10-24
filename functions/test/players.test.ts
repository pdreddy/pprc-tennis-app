import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { getMyPerformance } from "../src/players";
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore(),
  req = (d: any = {}) => ({ requestId: randomUUID(), ...d });
let eid: string, matchId: string, resultId: string;
const profile = {
  displayName: "Performance owner",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Club competitive",
  externalRating: 4.5,
  singlesUtr: 4.4,
  doublesUtr: 4.7,
  handedness: "Right",
  availability: "Weekends",
  emergencyContact: "Never expose this contact",
  visibility: "private",
  notificationPreferences: { inApp: true, push: false },
};
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Use synthetic local emulators");
  process.env.FUNCTIONS_EMULATOR = "true";
  for (const uid of [
    "performance-admin",
    "performance-owner",
    "performance-opponent",
  ]) {
    await execute(
      "saveProfile",
      uid,
      req({ profile: { ...profile, displayName: uid } }),
    );
    await db
      .doc(`memberships/${uid}`)
      .set({
        clubId: "pprc",
        role: uid === "performance-admin" ? "clubAdmin" : "player",
        member: true,
      });
  }
  const event = {
    name: "Private performance fixture",
    description: "Synthetic confirmed-result test",
    venue: "PPRC",
    location: "Prosper",
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    timezone: "America/Chicago",
    visibility: "private",
    fee: 0,
    capacity: 2,
    waitlist: false,
    registrationOpen: new Date(Date.now() - 60000).toISOString(),
    registrationClose: new Date(Date.now() + 3600000).toISOString(),
    waiverRequired: false,
    refundPolicy: "Synthetic",
    organizer: "PPRC",
    assignedAdmins: ["performance-admin"],
    courtIds: [],
  };
  eid = (
    await execute(
      "createEvent",
      "performance-admin",
      req({
        event,
        divisions: [
          { name: "Singles", format: "single-elimination", capacity: 2 },
        ],
      }),
    )
  ).eventId;
  await execute("publishEvent", "performance-admin", req({ eventId: eid }));
  let seed = 1;
  for (const uid of ["performance-owner", "performance-opponent"]) {
    const reg = await execute(
      "registerForDivision",
      uid,
      req({ eventId: eid, divisionId: `${eid}-d1`, waiver: true }),
    );
    await execute(
      "approveRegistration",
      "performance-admin",
      req({
        eventId: eid,
        registrationId: reg.registrationId,
        seed: seed++,
        reason: "Initial performance fixture seeding",
      }),
    );
  }
  await execute(
    "generateDraw",
    "performance-admin",
    req({ eventId: eid, divisionId: `${eid}-d1` }),
  );
  const matches = await db
    .collection("matches")
    .where("eventId", "==", eid)
    .get();
  matchId = matches.docs[0].id;
  resultId = (
    await execute(
      "submitScore",
      "performance-owner",
      req({
        eventId: eid,
        matchId,
        version: 0,
        score: {
          winner: "performance-owner",
          sets: [
            { a: 6, b: 2 },
            { a: 6, b: 3 },
          ],
          outcome: "played",
          notes: "",
        },
        finalize: false,
      }),
    )
  ).resultId;
}, 60000);
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});
describe.sequential("owner-scoped player performance", () => {
  it("requires Firebase authentication at the callable and rejects target/player payload spoofing", async () => {
    const r = await fetch(
      "http://127.0.0.1:5001/demo-pprc-events/us-central1/getMyPerformance",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: {} }),
      },
    );
    expect(r.status).toBe(401);
    await expect(
      getMyPerformance("performance-owner", {
        requestId: randomUUID(),
        playerId: "performance-opponent",
      }),
    ).rejects.toThrow();
  });
  it("excludes pending/unconfirmed results while showing authorized reference values", async () => {
    const p = await getMyPerformance("performance-owner", {});
    expect(p.summary.total).toBe(0);
    expect(p.summary.winPercentage).toBeNull();
    expect(p.references).toMatchObject({
      singles: 4.4,
      doubles: 4.7,
      source: "Player provided",
    });
  });
  it("includes the owner's confirmed private result without publishing private profile data", async () => {
    await execute(
      "finalizeScore",
      "performance-opponent",
      req({ eventId: eid, resultId }),
    );
    const p = await getMyPerformance("performance-owner", {});
    expect(p.summary).toMatchObject({
      total: 1,
      wins: 1,
      losses: 0,
      winPercentage: 100,
    });
    expect(p.history[0]).toMatchObject({
      eventId: eid,
      matchId,
      won: true,
      source: "individual",
    });
    expect(JSON.stringify(p)).not.toContain("Never expose this contact");
    expect(
      (await db.doc("publicProfiles/performance-owner").get()).exists,
    ).toBe(false);
  });
  it("removes superseded results and reports the final corrected version exactly once", async () => {
    await execute(
      "requestScoreCorrection",
      "performance-owner",
      req({
        eventId: eid,
        resultId,
        reason: "Recorded winner needs correction",
      }),
    );
    await execute(
      "applyAdminOverride",
      "performance-admin",
      req({
        eventId: eid,
        kind: "score",
        resultId,
        reason: "Both players confirmed correction",
      }),
    );
    expect(
      (await getMyPerformance("performance-owner", {})).summary.total,
    ).toBe(0);
    const corrected = await execute(
      "submitScore",
      "performance-owner",
      req({
        eventId: eid,
        matchId,
        version: 1,
        score: {
          winner: "performance-opponent",
          sets: [
            { a: 2, b: 6 },
            { a: 3, b: 6 },
          ],
          outcome: "played",
          notes: "Corrected result",
        },
        finalize: false,
      }),
    );
    await execute(
      "finalizeScore",
      "performance-opponent",
      req({ eventId: eid, resultId: corrected.resultId }),
    );
    const p = await getMyPerformance("performance-owner", {});
    expect(p.summary).toMatchObject({ total: 1, wins: 0, losses: 1 });
    expect(p.history[0].version).toBe(2);
  });
  it("counts only rubbers actually assigned to the player rather than all team participation records", async () => {
    const make = (id: string, fields: any) =>
      db
        .doc(`rubbers/${id}`)
        .set({
          id,
          clubId: "pprc",
          eventId: eid,
          teamA: "performance-team-a",
          teamB: "performance-team-b",
          participantIds: [
            "performance-owner",
            "performance-opponent",
            "performance-mate",
          ],
          kind: "doubles",
          status: "Final",
          version: 1,
          createdAt: FieldValue.serverTimestamp(),
          outcome: "played",
          winner: "performance-team-a",
          ...fields,
        });
    await make("performance-assigned", {
      playersA: ["performance-owner", "performance-mate"],
      playersB: ["performance-opponent", "other"],
      score: {
        winner: "performance-team-a",
        sets: [{ a: 6, b: 3 }],
        outcome: "played",
      },
    });
    await make("performance-not-assigned", {
      playersA: ["performance-mate", "other-mate"],
      playersB: ["performance-opponent", "other"],
    });
    const p = await getMyPerformance("performance-owner", {});
    expect(p.summary.total).toBe(2);
    expect(p.summary.breakdown.find((r) => r.kind === "doubles")).toMatchObject(
      { total: 1, wins: 1 },
    );
    expect(
      p.history.some((r) => r.matchId === "performance-not-assigned"),
    ).toBe(false);
  });
  it("returns only the authenticated player's persisted reference snapshots with provenance", async () => {
    for (const [id, playerId] of [
      ["performance-own-ref", "performance-owner"],
      ["performance-other-ref", "performance-opponent"],
    ])
      await db
        .doc(`ratingSnapshots/${id}`)
        .set({
          id,
          clubId: "pprc",
          eventId: eid,
          playerId,
          singles: 4.3,
          doubles: 4.6,
          reference: 4.6,
          source: "Player provided",
          verified: false,
          capturedAt: "2026-10-24T12:00:00Z",
        });
    const p = await getMyPerformance("performance-owner", {});
    expect(p.referenceHistory).toHaveLength(1);
    expect(p.referenceHistory[0]).toMatchObject({
      id: "performance-own-ref",
      singles: 4.3,
      doubles: 4.6,
      verified: false,
    });
  });
  it("requires a completed profile instead of manufacturing a player performance record", async () => {
    await expect(
      getMyPerformance("performance-missing", {}),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
