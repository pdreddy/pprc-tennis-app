import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { runEventMaintenance } from "../src/maintenance";

// Real Firestore emulator. Synthetic accounts and courts only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const admin = "resched-admin",
  picky = "resched-picky",
  open = "resched-open";
const courts = ["resched-court-1", "resched-court-2"];
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const profile = {
  displayName: "Synthetic rescheduling player",
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
      id: "resched-venue",
      value: { name: "Rescheduling venue", location: "Prosper, TX" },
      reason: "Synthetic venue for rescheduling",
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
          venueId: "resched-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Synthetic court for rescheduling",
      }),
    );
}, 60000);

afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});

it("handles requests, opponent responses, stale proposals and overdue-score reminders", async () => {
  // Picky player is available only on Monday evenings (Chicago).
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
        name: "Synthetic rescheduling singles",
        description: "Synthetic rescheduling test",
        venue: "Rescheduling venue",
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
        reason: "Synthetic seeding for rescheduling test",
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
  const start = (await db.doc(`matches/${matchId}`).get()).data()!;
  expect(start.scheduledAt).toBe("2031-03-17T23:30:00.000Z");
  const other = courts.find((c) => c !== start.courtId)!;
  const ask = (uid: string, courtId: string, scheduledAt: string) =>
    execute(
      "requestReschedule",
      uid,
      req({
        eventId,
        matchId,
        courtId,
        scheduledAt,
        reason: "Synthetic request reason",
      }),
    );

  // Refused: the picky player is not available on Tuesday.
  await expect(ask(open, other, "2031-03-18T23:30:00.000Z")).rejects.toThrow(
    "unavailable",
  );
  // Refused: only participants may ask.
  await expect(ask(admin, other, "2031-03-17T23:30:00.000Z")).rejects.toThrow(
    "participant",
  );

  // Accepted path: open player asks for the other court at the same Monday time.
  const first = await ask(open, other, "2031-03-17T23:30:00.000Z");
  expect(first.status).toBe("Pending");
  await expect(
    ask(picky, courts[0], "2031-03-17T23:30:00.000Z"),
  ).rejects.toThrow("already pending");
  // The requester cannot approve their own request.
  await expect(
    execute(
      "respondReschedule",
      open,
      req({ eventId, requestId: first.requestId, accept: true }),
    ),
  ).rejects.toThrow("opponent");
  const applied = await execute(
    "respondReschedule",
    picky,
    req({ eventId, requestId: first.requestId, accept: true }),
  );
  expect(applied.status).toBe("Applied");
  expect((await db.doc(`matches/${matchId}`).get()).get("courtId")).toBe(other);

  // Stale path: a request made before the organizer moves the match is not applied.
  const stale = await ask(open, start.courtId, "2031-03-17T23:30:00.000Z");
  await execute(
    "rescheduleMatch",
    admin,
    req({
      eventId,
      matchId,
      courtId: start.courtId,
      scheduledAt: "2031-03-17T23:30:00.000Z",
      reason: "Organizer moved the match first",
    }),
  );
  const late = await execute(
    "respondReschedule",
    picky,
    req({ eventId, requestId: stale.requestId, accept: true }),
  );
  expect(late.status).toBe("Stale");
  expect((await db.doc(`matches/${matchId}`).get()).get("courtId")).toBe(
    start.courtId,
  );

  // Declined path.
  const declined = await ask(open, other, "2031-03-17T23:30:00.000Z");
  expect(
    (
      await execute(
        "respondReschedule",
        picky,
        req({ eventId, requestId: declined.requestId, accept: false }),
      )
    ).status,
  ).toBe("Declined");

  // Overdue score reminder: one per player, however many times maintenance runs.
  await db
    .doc(`matches/${matchId}`)
    .update({ scheduledAt: new Date(Date.now() - 3 * 3600000).toISOString() });
  await db.doc(`events/${eventId}`).update({ status: "In Progress" });
  await runEventMaintenance();
  await runEventMaintenance();
  const due = await db
    .collection("notifications")
    .where("eventId", "==", eventId)
    .where("type", "==", "score-due")
    .get();
  expect(due.size).toBe(2);
}, 180000);
