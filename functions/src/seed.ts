import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  elimination,
  advance,
  defaultTriaceRules,
  eventSchema,
  divisionSchema,
  publicPlayerProfile,
  type Entity,
} from "@pprc/shared";
if (
  process.env.GCLOUD_PROJECT &&
  !process.env.GCLOUD_PROJECT.startsWith("demo-")
)
  throw Error("Seed is restricted to demo projects");
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
initializeApp({ projectId: "demo-pprc-events" });
const db = getFirestore(),
  auth = getAuth(),
  now = FieldValue.serverTimestamp();
const names = [
  "Jordan Lee",
  "Avery Morgan",
  "Riley Khan",
  "Taylor Brooks",
  "Cameron Ellis",
  "Morgan Davis",
  "Casey Wilson",
  "Alex Chen",
  "Sam Rivera",
  "Jamie Patel",
  "Quinn Walker",
  "Drew Nelson",
  "Skyler Reed",
  "Robin Foster",
  "Blake Turner",
  "Reese Martin",
  "Parker Shah",
  "Finley Reyes",
  "Arden Kim",
  "Hayden Price",
  "Emery Brown",
  "Sage Carter",
  "Dakota Ross",
  "Rowan Bell",
];
const base = (id: string, fields: any) => ({
  id,
  clubId: "pprc",
  createdAt: now,
  updatedAt: now,
  createdBy: "seed",
  ...fields,
});
for (let i = 0; i < 28; i++) {
  const uid =
    i < 24
      ? `player${i + 1}`
      : ["admin", "event-admin", "support", "other-admin"][i - 24];
  const displayName =
    i < 24
      ? names[i]
      : [
          "Club Administrator",
          "Tournament Director",
          "Platform Support",
          "Unassigned Admin",
        ][i - 24];
  try {
    await auth.createUser({
      uid,
      email: `${uid}@pprc.test`,
      password: "PprcDemo2026!",
      displayName,
      emailVerified: true,
    });
  } catch (e) {
    if (
      (e as { code: string }).code !== "auth/uid-already-exists" &&
      (e as { code: string }).code !== "auth/email-already-exists"
    )
      throw e;
  }
  if (!(await db.doc(`users/${uid}`).get()).exists)
    await db.doc(`users/${uid}`).set(
      base(uid, {
        displayName,
        city: "Prosper, TX",
        preferredSport: "Tennis",
        tennisLevel: "Club competitive",
        externalRating: 4 + i * 0.15,
        singlesUtr: i < 24 ? 4.2 + (i % 3) * 0.2 : 5,
        doublesUtr: i < 24 ? 4.5 + (i % 3) * 0.2 : 5,
        ratingSource: "Player provided",
        ratingVerifiedAt: null,
        handedness: "Right",
        availability: "Weekends",
        emergencyContact: "",
        visibility: "public",
        notificationPreferences: { inApp: true, push: false },
        birthDate: "1995-05-15",
        gender: i % 2 ? "Female" : "Male",
      }),
    );
  if (!(await db.doc(`memberships/${uid}`).get()).exists)
    await db.doc(`memberships/${uid}`).set(
      base(uid, {
        playerId: uid,
        role:
          uid === "admin"
            ? "clubAdmin"
            : uid === "event-admin" || uid === "other-admin"
              ? "eventAdmin"
              : uid === "support"
                ? "platformAdmin"
                : "player",
        member: true,
      }),
    );
  const current = (await db.doc(`users/${uid}`).get()).data()!;
  const membership = (await db.doc(`memberships/${uid}`).get()).data();
  const projection = publicPlayerProfile(
    { id: uid, ...current } as Entity,
    membership,
  );
  if (projection)
    await db.doc(`publicProfiles/${uid}`).set(base(uid, projection));
  else await db.doc(`publicProfiles/${uid}`).delete();
}
if (!(await db.doc("clubs/pprc").get()).exists)
  await db.doc("clubs/pprc").set(
    base("pprc", {
      name: "Prosper Premier Racquet Club",
      timezone: "America/Chicago",
    }),
  );
if (!(await db.doc("venues/pprc-main").get()).exists)
  await db
    .doc("venues/pprc-main")
    .set(
      base("pprc-main", { name: "PPRC Main Courts", location: "Prosper, TX" }),
    );
for (let i = 1; i <= 4; i++)
  if (!(await db.doc(`courts/court-${i}`).get()).exists)
    await db.doc(`courts/court-${i}`).set(
      base(`court-${i}`, {
        name: `Court ${i}`,
        venueId: "pprc-main",
        surface: "Hard",
        active: true,
      }),
    );
for (const [id, name, status, format, offset, fee] of [
  [
    "prosper-open",
    "Prosper Open Weekend",
    "Registration Open",
    "single-elimination",
    14,
    4500,
  ],
  [
    "sunset-round-robin",
    "Sunset Social Round Robin",
    "Registration Open",
    "round-robin-playoffs",
    21,
    2500,
  ],
  [
    "fall-championship",
    "Fall Club Championship",
    "Completed",
    "single-elimination",
    -14,
    3500,
  ],
] as const) {
  if ((await db.doc(`events/${id}`).get()).exists) continue;
  const start = new Date(Date.now() + offset * 86400000);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 86400000);
  const close = new Date(start.getTime() - 2 * 86400000);
  const event = base(id, {
    name,
    description:
      "Good competition, great people, and a full weekend on court. Join the Prosper community for an original PPRC tennis event, with thoughtfully matched divisions and a welcoming atmosphere. Bring your game; we will take care of the details.",
    venue: "Prosper Premier Racquet Club",
    location: "Prosper, TX",
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    timezone: "America/Chicago",
    status,
    visibility: "public",
    fee,
    capacity: 16,
    waitlist: true,
    registrationOpen: new Date(Date.now() - 40 * 86400000).toISOString(),
    registrationClose: close.toISOString(),
    waiverRequired: true,
    refundPolicy:
      "Full refund requested 72 hours before play. Later withdrawals reviewed by the event team.",
    sport: "Tennis",
    organizer: "PPRC Events Team",
    questions: ["Any scheduling constraints?"],
    assignedAdmins: ["admin", "event-admin"],
    duration: 75,
    buffer: 15,
    courtIds: ["court-1", "court-2", "court-3", "court-4"],
    blackouts: [],
    eventType: format === "single-elimination" ? "Tournament" : "Round robin",
    divisionSummary: "Open singles · All levels",
    genderCategory: "Open",
    ageGroup: "Adult",
    formatLabel: format === "single-elimination" ? "Singles" : "Round robin",
  });
  await db.doc(`events/${id}`).set(event);
  const divisionId = `${id}-singles`;
  await db.doc(`divisions/${divisionId}`).set(
    base(divisionId, {
      eventId: id,
      name: "Open singles",
      format,
      capacity: 16,
      minRating: 0,
      maxRating: 20,
      minAge: 18,
      maxAge: 120,
      gender: "Open",
      scoring: "match-tiebreak",
      groupSize: 4,
      qualifiers: 2,
      tieBreakOrder: [
        "wins",
        "head-to-head",
        "set-percentage",
        "game-percentage",
        "admin",
      ],
    }),
  );
  if (status === "Completed") {
    const players = Array.from({ length: 8 }, (_, i) => `player${i + 1}`),
      drawId = `${divisionId}-draw`;
    const matches = elimination(players, drawId, divisionId);
    for (const m of matches) {
      m.eventId = id;
      m.published = true;
      if (m.p1 && m.p2) {
        advance(matches, m, m.p1);
        m.version = 1;
        await db.doc(`matchResults/${m.id}-result`).set(
          base(`${m.id}-result`, {
            eventId: id,
            divisionId,
            matchId: m.id,
            drawId,
            published: true,
            state: "Final",
            version: 1,
            baseVersion: 0,
            submittedBy: "admin",
            participants: [m.p1, m.p2],
            reportingStatus: "Not Required",
            score: {
              winner: m.p1,
              sets: [
                { a: 6, b: 3 },
                { a: 6, b: 4 },
              ],
              outcome: "played",
              notes: "",
            },
          }),
        );
      }
      await db.doc(`matches/${m.id}`).set(base(m.id, m));
      await db.doc(`drawNodes/${m.id}`).set(
        base(m.id, {
          eventId: id,
          divisionId,
          drawId,
          matchId: m.id,
          published: true,
          round: m.round,
          position: m.position,
        }),
      );
    }
    await db.doc(`draws/${drawId}`).set(
      base(drawId, {
        eventId: id,
        divisionId,
        phase: "knockout",
        players,
        published: true,
      }),
    );
    for (const [i, p] of players.entries())
      await db.doc(`registrations/${id}-${p}`).set(
        base(`${id}-${p}`, {
          eventId: id,
          divisionId,
          playerId: p,
          displayName: names[i],
          externalRating: 4 + i * 0.15,
          state: "Approved",
          seed: i + 1,
          checkIn: "Checked In",
          order: Date.now() + i,
          waiver: true,
          answers: {},
        }),
      );
  }
}
if (!(await db.doc("events/triace-cup").get()).exists) {
  const start = new Date(Date.now() + 21 * 86400000);
  start.setUTCHours(14, 0, 0, 0);
  const e = eventSchema.parse({
    name: "TRIACE 2.0 Champions Cup",
    description:
      "Three players. Five rubbers. One champion. Captain your squad through group play, semifinals and a championship final.",
    venue: "Prosper Premier Racquet Club",
    location: "Prosper, TX",
    startDate: start.toISOString(),
    endDate: new Date(start.getTime() + 3 * 86400000).toISOString(),
    timezone: "America/Chicago",
    visibility: "public",
    fee: 0,
    capacity: 8,
    waitlist: true,
    registrationOpen: new Date(Date.now() - 86400000).toISOString(),
    registrationClose: new Date(Date.now() + 19 * 86400000).toISOString(),
    waiverRequired: true,
    refundPolicy:
      "Each player acknowledges participation and sporting conduct. Withdrawal before fixtures opens a place; later withdrawals require organizer review.",
    sport: "Tennis",
    organizer: "PPRC Sports",
    questions: [],
    assignedAdmins: ["admin", "event-admin"],
    duration: 120,
    buffer: 15,
    courtIds: ["court-1", "court-2", "court-3", "court-4"],
    competition: "triace",
    triaceRules: defaultTriaceRules,
  });
  await db.doc("events/triace-cup").set(
    base("triace-cup", {
      ...e,
      status: "Registration Open",
      registeredCount: 0,
      waitlistCount: 0,
      waiverVersion: 1,
      schemaVersion: 2,
      divisionFilters: [{ minRating: 0, maxRating: 20 }],
    }),
  );
  await db.doc("divisions/triace-cup-teams").set(
    base("triace-cup-teams", {
      ...divisionSchema.parse({
        name: "TRIACE teams",
        format: "round-robin-playoffs",
        capacity: 8,
      }),
      eventId: "triace-cup",
    }),
  );
}
console.log(
  "PPRC demo seed ready: 24 players, 4 courts, 4 events including TRIACE. Existing event data preserved.",
);
await db.terminate();
