import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";

// Real Firestore emulator. Synthetic accounts and courts only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const admin = "avsched-admin",
  picky = "avsched-picky",
  open = "avsched-open";
const courts = ["avsched-court-1", "avsched-court-2"];
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const profile = {
  displayName: "Synthetic scheduling player",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Club",
  externalRating: 4,
  singlesUtr: 4,
  doublesUtr: 4.5,
  handedness: "Right",
  availability: "Synthetic",
  emergencyContact: "Private synthetic contact",
  visibility: "private",
  notificationPreferences: { inApp: true, push: false },
};

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  await db
    .doc(`memberships/${admin}`)
    .set({ clubId: "pprc", role: "clubAdmin", member: true });
  await db
    .doc(`users/${admin}`)
    .set({ id: admin, clubId: "pprc", displayName: admin });
  for (const uid of [picky, open]) {
    await execute(
      "saveProfile",
      uid,
      req({ profile: { ...profile, displayName: uid } }),
    );
    await db
      .doc(`memberships/${uid}`)
      .set({ clubId: "pprc", role: "player", member: true });
  }
  await execute(
    "manageClub",
    admin,
    req({
      target: "venue",
      id: "avsched-venue",
      value: { name: "Scheduling venue", location: "Prosper, TX" },
      reason: "Synthetic venue for availability scheduling",
    }),
  );
  for (const id of courts)
    await execute(
      "manageClub",
      admin,
      req({
        target: "court",
        id,
        value: {
          name: id,
          venueId: "avsched-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Synthetic court for availability scheduling",
      }),
    );
}, 60000);

afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});

describe("player availability in scheduling", () => {
  it("places a match only inside a player's preferred Monday evening and refuses other slots on reschedule", async () => {
    // Monday 17 March 2031 is Chicago CDT (UTC-5). Preferred: Mondays 18:00–20:00.
    await db.doc(`availability/${picky}`).set({
      id: picky,
      playerId: picky,
      clubId: "pprc",
      weekdays: [1],
      windows: [{ start: "18:00", end: "20:00" }],
      unavailableDates: [],
      notes: "",
    });
    const { eventId } = await execute(
      "createEvent",
      admin,
      req({
        event: {
          name: "Synthetic availability singles",
          description: "Synthetic scheduling test",
          venue: "Scheduling venue",
          location: "Prosper, TX",
          startDate: "2031-03-17T13:00:00.000Z",
          endDate: "2031-03-21T13:00:00.000Z",
          timezone: "America/Chicago",
          visibility: "public",
          fee: 0,
          capacity: 2,
          waitlist: false,
          registrationOpen: new Date(Date.now() - 60000).toISOString(),
          registrationClose: new Date(Date.now() + 3600000).toISOString(),
          waiverRequired: false,
          refundPolicy: "Synthetic",
          sport: "Tennis",
          organizer: "PPRC",
          questions: [],
          assignedAdmins: [admin],
          courtIds: courts,
        },
        divisions: [
          { name: "Singles", format: "single-elimination", capacity: 2 },
        ],
      }),
    );
    await execute("publishEvent", admin, req({ eventId }));
    let seed = 1;
    for (const uid of [picky, open]) {
      const reg = await execute(
        "registerForDivision",
        uid,
        req({
          eventId,
          divisionId: `${eventId}-d1`,
          waiver: true,
        }),
      );
      await execute(
        "approveRegistration",
        admin,
        req({
          eventId,
          registrationId: reg.registrationId,
          seed: seed++,
          reason: "Synthetic seeding for availability test",
        }),
      );
    }
    await execute(
      "generateDraw",
      admin,
      req({ eventId, divisionId: `${eventId}-d1` }),
    );
    const match = (
      await db.collection("matches").where("eventId", "==", eventId).get()
    ).docs[0];
    expect([match.get("p1"), match.get("p2")]).toContain(picky);

    await execute("generateSchedule", admin, req({ eventId }));
    const placed = (await db.doc(`matches/${match.id}`).get()).data()!;
    // Slot grid is 90 minutes from the event start; the first grid slot inside
    // 18:00–20:00 Monday that fits a 75-minute match is 18:30 Chicago.
    expect(placed.scheduledAt).toBe("2031-03-17T23:30:00.000Z");

    // A Tuesday slot is outside the player's preferred day.
    await expect(
      execute(
        "rescheduleMatch",
        admin,
        req({
          eventId,
          matchId: match.id,
          courtId: courts[0],
          scheduledAt: "2031-03-18T23:30:00.000Z",
          reason: "Attempt Tuesday",
        }),
      ),
    ).rejects.toThrow("unavailable");

    // The same Monday slot on another court is allowed.
    await execute(
      "rescheduleMatch",
      admin,
      req({
        eventId,
        matchId: match.id,
        courtId: courts[1],
        scheduledAt: "2031-03-17T23:30:00.000Z",
        reason: "Court move within preference",
      }),
    );
    expect((await db.doc(`matches/${match.id}`).get()).get("courtId")).toBe(
      courts[1],
    );
  }, 120000);
});
