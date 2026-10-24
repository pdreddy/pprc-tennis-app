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
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
let env: RulesTestEnvironment, privateEvent: string;
const req = (d: any = {}) => ({ requestId: randomUUID(), ...d });
const apply = (uid: string, d: any = {}) =>
  execute("requestClubMembership", uid, req({ clubId: "pprc", ...d }));
const review = (
  playerId: string,
  decision = "Approved",
  uid = "club-test-admin",
) =>
  execute(
    "reviewClubMembership",
    uid,
    req({
      clubId: "pprc",
      playerId,
      decision,
      reason: "Reviewed synthetic application",
    }),
  );
const profile = {
  displayName: "New Club Player",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Competitive",
  externalRating: 4.5,
  singlesUtr: 4.4,
  doublesUtr: 4.7,
  ratingSource: "Player provided",
  handedness: "Right",
  availability: "Weekends",
  emergencyContact: "Private contact",
  visibility: "public",
  birthDate: "1995-05-15",
  gender: "Other",
  notificationPreferences: { inApp: true, push: false },
};
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local synthetic emulators required");
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
    "club-test-admin",
    "club-test-admin2",
    "club-test-organizer",
    "club-test-support",
  ])
    await db
      .doc(`memberships/${uid}`)
      .set({
        clubId: "pprc",
        member: true,
        role: uid.includes("support")
          ? "platformAdmin"
          : uid.includes("organizer")
            ? "eventAdmin"
            : "clubAdmin",
      });
  await db
    .doc("clubs/pprc")
    .set({
      id: "pprc",
      clubId: "pprc",
      name: "PPRC",
      timezone: "America/Chicago",
      acceptingMembershipRequests: true,
    });
  for (const uid of [
    "club-new",
    "club-rejected",
    "club-race",
    "club-closed",
    "club-private",
  ])
    await execute(
      "saveProfile",
      uid,
      req({
        profile: {
          ...profile,
          displayName: uid,
          ...(uid === "club-private" ? { visibility: "private" } : {}),
        },
      }),
    );
  const event = {
    name: "Members-only onboarding event",
    description: "Synthetic membership gate",
    venue: "PPRC",
    location: "Prosper",
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    timezone: "America/Chicago",
    visibility: "private",
    fee: 500,
    capacity: 2,
    waitlist: true,
    registrationOpen: new Date(Date.now() - 60000).toISOString(),
    registrationClose: new Date(Date.now() + 3600000).toISOString(),
    waiverRequired: true,
    refundPolicy: "Synthetic",
    sport: "Tennis",
    organizer: "PPRC",
    questions: [],
    assignedAdmins: ["club-test-admin"],
    courtIds: [],
  };
  privateEvent = (
    await execute(
      "createEvent",
      "club-test-admin",
      req({
        event,
        divisions: [
          { name: "Members", format: "single-elimination", capacity: 2 },
        ],
      }),
    )
  ).eventId;
  await execute(
    "publishEvent",
    "club-test-admin",
    req({ eventId: privateEvent }),
  );
}, 60000);
afterAll(async () => {
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});
describe.sequential("club onboarding and membership", () => {
  it("requires a profile, rejects role/identity spoofing, and denies private events before approval", async () => {
    await expect(apply("club-no-profile")).rejects.toThrow("profile");
    for (const changes of [
      { role: "clubAdmin" },
      { playerId: "someone-else" },
      { clubId: "foreign" },
    ])
      await expect(apply("club-new", changes)).rejects.toThrow();
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "events",
          privateEvent,
        ),
      ),
    );
    await assertFails(
      setDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "memberships",
          "club-new",
        ),
        { clubId: "pprc", member: true, role: "clubAdmin" },
      ),
    );
  });
  it("persists an owned request, deduplicates retries and notifies only trusted club admins", async () => {
    const admins = await db
      .collection("memberships")
      .where("clubId", "==", "pprc")
      .where("role", "==", "clubAdmin")
      .get();
    const expectedRecipients = admins.docs.map((d) => d.id).sort();
    const input = req({
      clubId: "pprc",
      message: "Please review my application",
    });
    const result = await execute("requestClubMembership", "club-new", input);
    expect(result.status).toBe("Pending");
    expect(await execute("requestClubMembership", "club-new", input)).toEqual(
      result,
    );
    await apply("club-new");
    const request = await db.doc("membershipRequests/club-new").get();
    expect(request.get("attempt")).toBe(1);
    const notices = await db
      .collection("notifications")
      .where("type", "==", "membership-request")
      .get();
    expect(
      notices.docs
        .filter((n) => n.get("body").includes("club-new"))
        .map((n) => n.get("playerId"))
        .sort(),
    ).toEqual(expectedRecipients);
    await assertSucceeds(
      getDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "membershipRequests",
          "club-new",
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("club-rejected").firestore(),
          "membershipRequests",
          "club-new",
        ),
      ),
    );
    await assertFails(
      setDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "membershipRequests",
          "club-new",
        ),
        { status: "Approved" },
      ),
    );
  });
  it("requires club-admin review and grants only player membership with a private decision notification", async () => {
    for (const uid of ["club-new", "club-test-organizer", "club-test-support"])
      await expect(review("club-new", "Approved", uid)).rejects.toMatchObject({
        code: "permission-denied",
      });
    await review("club-new");
    const m = await db.doc("memberships/club-new").get();
    expect(m.get("role")).toBe("player");
    expect(m.get("member")).toBe(true);
    const p = await db.doc("publicProfiles/club-new").get();
    expect(p.get("memberClubId")).toBe("pprc");
    expect(p.data()).not.toHaveProperty("emergencyContact");
    expect(p.data()).not.toHaveProperty("birthDate");
    const notice = await db
      .collection("notifications")
      .where("playerId", "==", "club-new")
      .where("type", "==", "membership-decision")
      .get();
    expect(notice.docs[0].get("href")).toBe("/clubs/pprc");
    await assertSucceeds(
      getDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "events",
          privateEvent,
        ),
      ),
    );
    const registration = await execute(
      "registerForDivision",
      "club-new",
      req({
        eventId: privateEvent,
        divisionId: `${privateEvent}-d1`,
        waiver: true,
      }),
    );
    expect(registration.state).toBe("Pending Payment");
  });
  it("keeps directory membership through rating verification and removes all public fields on privacy opt-out", async () => {
    await execute(
      "manageClub",
      "club-test-admin",
      req({
        target: "rating",
        id: "club-new",
        rating: 4.8,
        singlesUtr: 4.7,
        doublesUtr: 4.9,
        reason: "Verified synthetic reference",
      }),
    );
    expect(
      (await db.doc("publicProfiles/club-new").get()).get("memberClubId"),
    ).toBe("pprc");
    await execute(
      "saveProfile",
      "club-new",
      req({
        profile: {
          ...profile,
          externalRating: 4.8,
          singlesUtr: 4.7,
          doublesUtr: 4.9,
          visibility: "private",
        },
      }),
    );
    expect((await db.doc("publicProfiles/club-new").get()).exists).toBe(false);
    await execute("saveProfile", "club-new", req({ profile }));
    expect(
      (await db.doc("publicProfiles/club-new").get()).get("memberClubId"),
    ).toBe("pprc");
  });
  it("removes revoked membership from the projection and denies members-only events again", async () => {
    await execute(
      "manageClub",
      "club-test-admin",
      req({
        target: "membership",
        id: "club-new",
        role: "player",
        member: false,
        reason: "Synthetic membership revocation",
      }),
    );
    expect(
      (await db.doc("publicProfiles/club-new").get()).get("memberClubId"),
    ).toBeNull();
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("club-new").firestore(),
          "events",
          privateEvent,
        ),
      ),
    );
  });
  it("supports rejection, resubmission and owner withdrawal without granting a membership", async () => {
    await apply("club-rejected");
    await review("club-rejected", "Rejected");
    expect((await db.doc("memberships/club-rejected").get()).exists).toBe(
      false,
    );
    await apply("club-rejected");
    expect(
      (await db.doc("membershipRequests/club-rejected").get()).get("attempt"),
    ).toBe(2);
    await execute(
      "withdrawClubMembershipRequest",
      "club-rejected",
      req({ clubId: "pprc" }),
    );
    expect(
      (await db.doc("membershipRequests/club-rejected").get()).get("status"),
    ).toBe("Withdrawn");
    await expect(review("club-rejected")).rejects.toThrow("pending");
  });
  it("serializes conflicting reviews and retains one immutable decision audit", async () => {
    await apply("club-race");
    const results = await Promise.allSettled([
      review("club-race", "Approved"),
      review("club-race", "Rejected", "club-test-admin2"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const request = await db.doc("membershipRequests/club-race").get(),
      membership = await db.doc("memberships/club-race").get();
    expect(membership.exists).toBe(request.get("status") === "Approved");
    const audit = await db
      .collection("auditEvents")
      .where("action", "==", "reviewClubMembership")
      .get();
    expect(
      audit.docs.filter((a) => a.get("before.id") === "club-race"),
    ).toHaveLength(1);
  });
  it("approves private applicants without publishing them and rejects foreign-club overwrites", async () => {
    await apply("club-private");
    await review("club-private");
    expect((await db.doc("publicProfiles/club-private").get()).exists).toBe(
      false,
    );
    await db
      .doc("memberships/club-foreign")
      .set({ clubId: "foreign", role: "clubAdmin", member: true });
    await execute("saveProfile", "club-foreign", req({ profile }));
    await expect(apply("club-foreign")).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect((await db.doc("memberships/club-foreign").get()).get("clubId")).toBe(
      "foreign",
    );
  });
  it("enforces the club's request policy through the trusted admin setting", async () => {
    await execute(
      "manageClub",
      "club-test-admin",
      req({
        target: "club",
        value: {
          name: "PPRC",
          timezone: "America/Chicago",
          location: "Prosper",
          contactEmail: "club@example.test",
          acceptingMembershipRequests: false,
        },
        reason: "Temporarily close applications",
      }),
    );
    await expect(apply("club-closed")).rejects.toThrow("not accepting");
    await execute(
      "manageClub",
      "club-test-admin",
      req({
        target: "club",
        value: {
          name: "PPRC updated",
          timezone: "America/Chicago",
          location: "Prosper",
          contactEmail: "club@example.test",
        },
        reason: "Older client updates club details",
      }),
    );
    expect(
      (await db.doc("clubs/pprc").get()).get("acceptingMembershipRequests"),
    ).toBe(false);
    await execute(
      "manageClub",
      "club-test-admin",
      req({
        target: "club",
        value: {
          name: "PPRC",
          timezone: "America/Chicago",
          location: "Prosper",
          contactEmail: "club@example.test",
          acceptingMembershipRequests: true,
        },
        reason: "Reopen synthetic applications",
      }),
    );
    expect((await apply("club-closed")).status).toBe("Pending");
  });
});
