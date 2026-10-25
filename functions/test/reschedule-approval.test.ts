import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";

// Real Firestore emulator. Synthetic accounts and courts only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const admin = "rapp-admin",
  a = "rapp-a",
  b = "rapp-b";
const courts = ["rapp-court-1", "rapp-court-2"];
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const profile = {
  displayName: "Synthetic approval player",
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
  for (const uid of [a, b]) {
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
      id: "rapp-venue",
      value: { name: "Approval venue", location: "Prosper, TX" },
      reason: "Synthetic venue for reschedule approval",
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
          venueId: "rapp-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Synthetic court for reschedule approval",
      }),
    );
}, 60000);

afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});

it("holds an accepted reschedule until the organizer approves it", async () => {
  const { eventId } = await execute(
    "createEvent",
    admin,
    req({
      event: {
        name: "Synthetic approval singles",
        description: "Synthetic approval test",
        venue: "Approval venue",
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
  await execute(
    "setReschedulePolicy",
    admin,
    req({
      eventId,
      enabled: true,
      reason: "Organizer approval for this season",
    }),
  );
  let seed = 1;
  for (const uid of [a, b]) {
    const reg = await execute(
      "registerForDivision",
      uid,
      req({ eventId, divisionId: `${eventId}-d1`, waiver: true }),
    );
    await execute(
      "approveRegistration",
      admin,
      req({
        eventId,
        registrationId: reg.registrationId,
        seed: seed++,
        reason: "Synthetic seeding for approval test",
      }),
    );
  }
  await execute(
    "generateDraw",
    admin,
    req({ eventId, divisionId: `${eventId}-d1` }),
  );
  const matchId = (
    await db.collection("matches").where("eventId", "==", eventId).get()
  ).docs[0].id;
  await execute("generateSchedule", admin, req({ eventId }));
  const current = (await db.doc(`matches/${matchId}`).get()).data()!;
  const other = courts.find((c) => c !== current.courtId)!;
  const asked = await execute(
    "requestReschedule",
    a,
    req({
      eventId,
      matchId,
      courtId: other,
      scheduledAt: current.scheduledAt,
      reason: "Synthetic approval request",
    }),
  );
  const accepted = await execute(
    "respondReschedule",
    b,
    req({ eventId, requestId: asked.requestId, accept: true }),
  );
  expect(accepted.status).toBe("Awaiting organizer");
  // Not moved yet.
  expect((await db.doc(`matches/${matchId}`).get()).get("courtId")).toBe(
    current.courtId,
  );
  const decided = await execute(
    "decideReschedule",
    admin,
    req({
      eventId,
      requestId: asked.requestId,
      approve: true,
      reason: "Organizer approved the swap",
    }),
  );
  expect(decided.status).toBe("Applied");
  expect((await db.doc(`matches/${matchId}`).get()).get("courtId")).toBe(other);
  // Reminder timing: with the default two-hour window nothing is due after
  // 90 minutes; after the organizer shortens it to one hour, each player gets one.
  await db
    .doc(`matches/${matchId}`)
    .update({
      scheduledAt: new Date(Date.now() - 90 * 60000).toISOString(),
      status: "Scheduled",
    });
  await db.doc(`events/${eventId}`).update({ status: "In Progress" });
  const { runEventMaintenance } = await import("../src/maintenance");
  await runEventMaintenance();
  const before = await db
    .collection("notifications")
    .where("eventId", "==", eventId)
    .where("type", "==", "score-due")
    .get();
  expect(before.size).toBe(0);
  await execute(
    "setReminderPolicy",
    admin,
    req({
      eventId,
      upcomingMinutes: 30,
      overdueHours: 1,
      reason: "Shorter score window this week",
    }),
  );
  await runEventMaintenance();
  await runEventMaintenance();
  const after = await db
    .collection("notifications")
    .where("eventId", "==", eventId)
    .where("type", "==", "score-due")
    .get();
  expect(after.size).toBe(2);
}, 180000);
