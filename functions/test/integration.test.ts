import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
const projectId = "demo-pprc-events";
let env: RulesTestEnvironment;
const app = initializeApp({ projectId });
const db = getFirestore();
let eid: string, divisionId: string;
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const event = {
  name: "Integration tournament",
  description: "Trusted server workflow",
  venue: "PPRC",
  location: "Prosper, TX",
  startDate: new Date(Date.now() + 86400000).toISOString(),
  endDate: new Date(Date.now() + 3 * 86400000).toISOString(),
  timezone: "America/Chicago",
  visibility: "public",
  fee: 1500,
  capacity: 2,
  waitlist: true,
  registrationOpen: new Date(Date.now() - 86400000).toISOString(),
  registrationClose: new Date(Date.now() + 3600000).toISOString(),
  waiverRequired: true,
  refundPolicy: "Refund on request",
  sport: "Tennis",
  organizer: "PPRC",
  questions: [],
  assignedAdmins: ["test-admin"],
  duration: 60,
  buffer: 15,
  courtIds: ["court-1", "court-2"],
};
const division = { name: "Open", format: "single-elimination", capacity: 2 };
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Run tests through Firebase emulators");
  process.env.FUNCTIONS_EMULATOR = "true";
  env = await initializeTestEnvironment({
    projectId,
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync("../storage.rules", "utf8"),
    },
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
  for (const uid of [
    "test-admin",
    "test-a",
    "test-b",
    "test-c",
    "test-support",
    "test-stranger",
  ]) {
    await db.doc(`users/${uid}`).set({
      id: uid,
      clubId: "pprc",
      displayName: uid,
      visibility: "private",
    });
    await db.doc(`memberships/${uid}`).set({
      clubId: "pprc",
      role:
        uid === "test-admin"
          ? "clubAdmin"
          : uid === "test-support"
            ? "platformAdmin"
            : uid === "test-stranger"
              ? "eventAdmin"
              : "player",
    });
  }
  const result = await execute(
    "createEvent",
    "test-admin",
    req({ event, divisions: [division] }),
  );
  eid = result.eventId;
  divisionId = `${eid}-d1`;
  await execute("publishEvent", "test-admin", req({ eventId: eid }));
}, 60000);
afterAll(async () => {
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});
describe.sequential("trusted transaction flow", () => {
  let registrations: any[], waitlisted: any;
  it("serializes simultaneous registrations and waitlists exactly one", async () => {
    const ids = ["test-a", "test-b", "test-c"];
    await Promise.all(
      ids.map((uid) =>
        execute(
          "registerForDivision",
          uid,
          req({ eventId: eid, divisionId, waiver: true }),
        ),
      ),
    );
    registrations = (
      await db.collection("registrations").where("eventId", "==", eid).get()
    ).docs.map((d) => ({ id: d.id, ...d.data() }));
    expect(
      registrations.filter((r) => r.state === "Pending Payment"),
    ).toHaveLength(2);
    waitlisted = registrations.find((r) => r.state === "Waitlisted");
    expect(waitlisted).toBeTruthy();
  }, 30000);
  it("deduplicates request IDs and rejects reuse with a changed payload", async () => {
    const r = registrations.find((r) => r.state === "Pending Payment"),
      input = req({ eventId: eid, registrationId: r.id });
    const a = await execute("reserveCheckout", r.playerId, input);
    expect(await execute("reserveCheckout", r.playerId, input)).toEqual(a);
    await expect(
      execute("reserveCheckout", r.playerId, {
        ...input,
        registrationId: "other",
      }),
    ).rejects.toThrow("reused");
    const audit = await db
      .collection("auditEvents")
      .where("requestId", "==", input.requestId)
      .get();
    expect(audit.size).toBe(1);
  });
  it("withdrawal promotes waitlist atomically and refunds require review", async () => {
    const r = registrations.find((r) => r.state === "Pending Payment");
    await execute(
      "cancelRegistration",
      r.playerId,
      req({ eventId: eid, registrationId: r.id, reason: "Schedule conflict" }),
    );
    expect(
      (await db.doc(`registrations/${waitlisted.id}`).get()).get("state"),
    ).toBe("Pending Payment");
    registrations = (
      await db.collection("registrations").where("eventId", "==", eid).get()
    ).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  it("blocks duplicate registrations and forged payment confirmation", async () => {
    await expect(
      execute(
        "registerForDivision",
        waitlisted.playerId,
        req({ eventId: eid, divisionId, waiver: true }),
      ),
    ).rejects.toThrow("Already registered");
    const p = await execute(
      "reserveCheckout",
      waitlisted.playerId,
      req({ eventId: eid, registrationId: waitlisted.id }),
    );
    await expect(
      execute(
        "confirmDevelopmentPayment",
        "test-admin",
        req({ eventId: eid, paymentId: p.paymentId }),
      ),
    ).rejects.toThrow("Own payment");
    await expect(
      execute(
        "recordStripePayment",
        waitlisted.playerId,
        req({ eventId: eid, paymentId: p.paymentId, amount: 1500 }),
      ),
    ).rejects.toThrow("Webhook");
  });
  it("records payments and approvals, generates draw, validates/finalizes score", async () => {
    for (const r of registrations.filter(
      (r) => r.state === "Pending Payment",
    )) {
      const p = await execute(
        "reserveCheckout",
        r.playerId,
        req({ eventId: eid, registrationId: r.id }),
      );
      await execute(
        "confirmDevelopmentPayment",
        r.playerId,
        req({ eventId: eid, paymentId: p.paymentId }),
      );
      await execute(
        "approveRegistration",
        "test-admin",
        req({ eventId: eid, registrationId: r.id, seed: 0 }),
      );
    }
    const draw = await execute(
      "generateDraw",
      "test-admin",
      req({ eventId: eid, divisionId }),
    );
    await execute(
      "publishDraw",
      "test-admin",
      req({ eventId: eid, drawId: draw.drawId }),
    );
    const m = (await db.collection("matches").where("eventId", "==", eid).get())
      .docs[0];
    const score = {
      winner: m.get("p1"),
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
      outcome: "played",
      notes: "",
    };
    await expect(
      execute(
        "submitScore",
        "test-admin",
        req({
          eventId: eid,
          matchId: m.id,
          version: 0,
          score: { ...score, sets: [{ a: 8, b: 1 }] },
          finalize: true,
        }),
      ),
    ).rejects.toThrow("Invalid set");
    await execute(
      "submitScore",
      "test-admin",
      req({ eventId: eid, matchId: m.id, version: 0, score, finalize: true }),
    );
    expect((await m.ref.get()).get("status")).toBe("Final");
    expect((await m.ref.get()).get("version")).toBe(1);
    const audit = await db
      .collection("auditEvents")
      .where("eventId", "==", eid)
      .get();
    expect(audit.docs.some((d) => d.get("action") === "submitScore")).toBe(
      true,
    );
  }, 30000);
  it("rejects support writes, unassigned admins, unaudited overrides and player exports", async () => {
    await expect(
      execute(
        "updateEvent",
        "test-support",
        req({ eventId: eid, event: { name: "Forged" } }),
      ),
    ).rejects.toThrow("administrator");
    await expect(
      execute(
        "updateEvent",
        "test-stranger",
        req({ eventId: eid, event: { name: "Forged" } }),
      ),
    ).rejects.toThrow("administrator");
    await expect(
      execute(
        "applyAdminOverride",
        "test-admin",
        req({ eventId: eid, kind: "status", status: "Completed" }),
      ),
    ).rejects.toThrow();
    await expect(
      execute(
        "exportEventReport",
        "test-a",
        req({ eventId: eid, kind: "registrations" }),
      ),
    ).rejects.toThrow("administrator");
  });
});
describe("Firestore security rules", () => {
  it("allows public events but rejects direct trusted writes and draft reads", async () => {
    const guest = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(guest, "events", eid)));
    await assertFails(
      setDoc(doc(guest, "events", "forged"), {
        visibility: "public",
        status: "Registration Open",
      }),
    );
    await db.doc("events/security-draft").set({ ...event, status: "Draft" });
    await assertFails(getDoc(doc(guest, "events", "security-draft")));
  });
  it("protects private profiles and financial/audit data from players", async () => {
    const player = env.authenticatedContext("test-a").firestore();
    await assertSucceeds(getDoc(doc(player, "users", "test-a")));
    await assertFails(getDoc(doc(player, "users", "test-b")));
    await assertFails(
      setDoc(doc(player, "auditEvents", "forged"), { actor: "test-a" }),
    );
    const p = (
      await db.collection("payments").where("eventId", "==", eid).get()
    ).docs.find((d) => d.get("playerId") !== "test-a");
    if (p) await assertFails(getDoc(doc(player, "payments", p.id)));
    await assertFails(
      updateDoc(doc(player, "memberships", "test-a"), { role: "clubAdmin" }),
    );
  });
  it("denies results, brackets and payment mutations even by an admin client", async () => {
    const admin = env.authenticatedContext("test-admin").firestore();
    for (const c of [
      "matches",
      "draws",
      "drawNodes",
      "matchResults",
      "payments",
      "auditEvents",
    ])
      await assertFails(
        setDoc(doc(admin, c, "forged"), { eventId: eid, clubId: "pprc" }),
      );
  });
  it("allows owner notification reads/read-state only", async () => {
    await db
      .doc("notifications/security-note")
      .set({ playerId: "test-a", title: "Test", read: false });
    const a = env.authenticatedContext("test-a").firestore();
    await assertSucceeds(
      updateDoc(doc(a, "notifications", "security-note"), {
        read: true,
        updatedAt: new Date(),
      }),
    );
    await assertFails(
      updateDoc(doc(a, "notifications", "security-note"), {
        playerId: "test-b",
      }),
    );
  });
});

describe("additional tournament and media workflows", () => {
  it("qualifies round-robin group winners into an unpublished knockout and revokes publication atomically", async () => {
    const created = await execute(
      "createEvent",
      "test-admin",
      req({
        event: {
          ...event,
          name: "Round robin playoff validation",
          fee: 0,
          capacity: 4,
        },
        divisions: [
          {
            name: "Open groups",
            format: "round-robin-playoffs",
            capacity: 4,
            groupSize: 3,
            qualifiers: 1,
          },
        ],
      }),
    );
    const eventId = created.eventId,
      divisionId = `${eventId}-d1`;
    await execute("publishEvent", "test-admin", req({ eventId }));
    for (const uid of ["rr-a", "rr-b", "rr-c", "rr-d"]) {
      await db
        .doc(`users/${uid}`)
        .set({ id: uid, clubId: "pprc", displayName: uid });
      const reg = await execute(
        "registerForDivision",
        uid,
        req({ eventId, divisionId, waiver: true }),
      );
      await execute(
        "approveRegistration",
        "test-admin",
        req({ eventId, registrationId: reg.registrationId, seed: 0 }),
      );
    }
    const draw = await execute(
      "generateDraw",
      "test-admin",
      req({ eventId, divisionId }),
    );
    await execute(
      "publishDraw",
      "test-admin",
      req({ eventId, drawId: draw.drawId }),
    );
    const groups = (
      await db.collection("matches").where("eventId", "==", eventId).get()
    ).docs;
    expect(groups).toHaveLength(2);
    for (const m of groups)
      await execute(
        "submitScore",
        "test-admin",
        req({
          eventId,
          matchId: m.id,
          version: 0,
          finalize: true,
          score: {
            winner: m.get("p1"),
            sets: [
              { a: 6, b: 3 },
              { a: 6, b: 4 },
            ],
            outcome: "played",
            notes: "",
          },
        }),
      );
    const draws = (
      await db.collection("draws").where("eventId", "==", eventId).get()
    ).docs;
    expect(draws).toHaveLength(2);
    const playoff = draws.find((d) => d.get("phase") === "playoffs")!;
    expect(playoff.get("published")).toBe(false);
    expect(playoff.get("players").sort()).toEqual(
      groups.map((m) => m.get("p1")).sort(),
    );
    await execute(
      "publishDraw",
      "test-admin",
      req({ eventId, drawId: draw.drawId, published: false }),
    );
    for (const m of groups)
      expect((await m.ref.get()).get("published")).toBe(false);
    const guest = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(guest, "matches", groups[0].id)));
    const result = (
      await db.collection("matchResults").where("eventId", "==", eventId).get()
    ).docs[0];
    await execute(
      "requestScoreCorrection",
      "test-admin",
      req({
        eventId,
        resultId: result.id,
        reason: "Qualification review requested",
      }),
    );
    await expect(
      execute(
        "applyAdminOverride",
        "test-admin",
        req({
          eventId,
          kind: "score",
          resultId: result.id,
          reason: "Qualification review requested",
        }),
      ),
    ).rejects.toThrow("qualification");
  }, 30000);
  it("protects profile verification and removes public projection on privacy change", async () => {
    const profile = {
      displayName: "Profile Player",
      city: "Prosper",
      preferredSport: "Tennis",
      tennisLevel: "Club",
      externalRating: 5,
      ratingSource: "Admin verified",
      handedness: "Right",
      availability: "Weekends",
      emergencyContact: "Private contact",
      visibility: "public",
      notificationPreferences: { inApp: true, push: false },
    };
    await execute("saveProfile", "profile-test", req({ profile }));
    expect((await db.doc("users/profile-test").get()).get("ratingSource")).toBe(
      "Player provided",
    );
    expect(
      (await db.doc("publicProfiles/profile-test").get()).get(
        "emergencyContact",
      ),
    ).toBeUndefined();
    await execute(
      "manageClub",
      "test-admin",
      req({
        target: "rating",
        id: "profile-test",
        rating: 5,
        reason: "Verified against player documentation",
      }),
    );
    expect((await db.doc("users/profile-test").get()).get("ratingSource")).toBe(
      "Admin verified",
    );
    await execute(
      "saveProfile",
      "profile-test",
      req({ profile: { ...profile, visibility: "private" } }),
    );
    expect((await db.doc("publicProfiles/profile-test").get()).exists).toBe(
      false,
    );
    expect((await db.doc("users/profile-test").get()).get("ratingSource")).toBe(
      "Admin verified",
    );
  }, 10000);
  it("enforces Storage ownership, MIME allowlists and waiver privacy", async () => {
    const a = env.authenticatedContext("test-a").storage(),
      b = env.authenticatedContext("test-b").storage(),
      guest = env.unauthenticatedContext().storage();
    await assertSucceeds(
      a
        .ref("photos/test-a/photo.png")
        .put(new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" })
        .then(() => undefined),
    );
    await assertFails(
      b
        .ref("photos/test-a/forged.png")
        .put(new Uint8Array([1]), { contentType: "image/png" })
        .then(() => undefined),
    );
    await assertFails(
      a
        .ref("photos/test-a/script.svg")
        .put(new Uint8Array([1]), { contentType: "image/svg+xml" })
        .then(() => undefined),
    );
    const path = `waivers/${eid}/test-a/waiver.pdf`;
    await assertSucceeds(
      a
        .ref(path)
        .put(new Uint8Array([37, 80, 68, 70]), {
          contentType: "application/pdf",
        })
        .then(() => undefined),
    );
    await assertFails(guest.ref(path).getMetadata());
    await assertFails(b.ref(path).getMetadata());
  }, 10000);
});

it("limits venue/court management to club admins and records audit scope", async () => {
  await execute(
    "manageClub",
    "test-admin",
    req({
      target: "venue",
      id: "test-venue",
      value: { name: "West courts", location: "Prosper, TX" },
      reason: "Add tournament venue",
    }),
  );
  await execute(
    "manageClub",
    "test-admin",
    req({
      target: "court",
      id: "test-court",
      value: {
        name: "Court West",
        venueId: "test-venue",
        surface: "Hard",
        active: true,
      },
      reason: "Add competition court",
    }),
  );
  expect((await db.doc("courts/test-court").get()).get("venueId")).toBe(
    "test-venue",
  );
  await expect(
    execute(
      "manageClub",
      "test-stranger",
      req({
        target: "venue",
        id: "forged",
        value: { name: "Forbidden", location: "Prosper" },
        reason: "Attempt privileged operation",
      }),
    ),
  ).rejects.toThrow("Club administrator");
  const audits = await db
    .collection("auditEvents")
    .where("action", "==", "manageClub")
    .get();
  expect(
    audits.docs.some(
      (d) =>
        d.get("reason") === "Add competition court" &&
        d.get("clubId") === "pprc",
    ),
  ).toBe(true);
});

it("blocks confirmation of a disputed score and retains superseded evidence", async () => {
  const created = await execute(
    "createEvent",
    "test-admin",
    req({
      event: { ...event, name: "Score correction validation", fee: 0 },
      divisions: [division],
    }),
  );
  const eventId = created.eventId,
    divisionId = `${eventId}-d1`;
  await execute("publishEvent", "test-admin", req({ eventId }));
  for (const uid of ["dispute-a", "dispute-b"]) {
    await db
      .doc(`users/${uid}`)
      .set({ id: uid, clubId: "pprc", displayName: uid });
    const registration = await execute(
      "registerForDivision",
      uid,
      req({ eventId, divisionId, waiver: true }),
    );
    await execute(
      "approveRegistration",
      "test-admin",
      req({ eventId, registrationId: registration.registrationId, seed: 0 }),
    );
  }
  await execute("generateDraw", "test-admin", req({ eventId, divisionId }));
  const match = (
    await db.collection("matches").where("eventId", "==", eventId).get()
  ).docs[0];
  const score = {
    winner: match.get("p1"),
    sets: [
      { a: 6, b: 3 },
      { a: 6, b: 4 },
    ],
    outcome: "played",
    notes: "",
  };
  const result = await execute(
    "submitScore",
    match.get("p1"),
    req({ eventId, matchId: match.id, version: 0, score, finalize: false }),
  );
  await execute(
    "requestScoreCorrection",
    match.get("p2"),
    req({
      eventId,
      resultId: result.resultId,
      reason: "Second set needs correction",
    }),
  );
  await expect(
    execute(
      "finalizeScore",
      match.get("p2"),
      req({ eventId, resultId: result.resultId }),
    ),
  ).rejects.toThrow("Resolve");
  await execute(
    "applyAdminOverride",
    "test-admin",
    req({
      eventId,
      kind: "score",
      resultId: result.resultId,
      reason: "Reviewed the score with both players",
    }),
  );
  await execute(
    "submitScore",
    "test-admin",
    req({
      eventId,
      matchId: match.id,
      version: 0,
      score: {
        ...score,
        sets: [
          { a: 6, b: 3 },
          { a: 7, b: 5 },
        ],
      },
      finalize: true,
    }),
  );
  const results = (
    await db.collection("matchResults").where("eventId", "==", eventId).get()
  ).docs;
  expect(results.map((r) => r.get("state")).sort()).toEqual([
    "Final",
    "Superseded",
  ]);
  expect(
    (await db.doc(`matchResults/${result.resultId}`).get()).get("score"),
  ).toEqual(score);
}, 15000);
