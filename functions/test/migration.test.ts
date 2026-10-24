import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { spawnSync } from "node:child_process";
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
function migrate(...args: string[]) {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "src/migrate.ts",
      "--public-profiles",
      ...args,
    ],
    { encoding: "utf8", env: process.env },
  );
  if (r.status !== 0) throw Error(r.stderr || r.stdout);
  return r.stdout;
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local synthetic emulators required");
  await db
    .doc("users/projection-old")
    .set({
      id: "projection-old",
      clubId: "pprc",
      displayName: "Projection legacy player",
      city: "Prosper",
      visibility: "public",
      externalRating: 4.8,
      singlesUtr: 4.7,
      doublesUtr: 5,
      emergencyContact: "Never publish",
    });
  await db
    .doc("memberships/projection-old")
    .set({ clubId: "pprc", member: true, role: "player" });
  await db
    .doc("publicProfiles/projection-old")
    .set({
      id: "projection-old",
      clubId: "pprc",
      displayName: "Old name",
      email: "private@example.test",
    });
  await db
    .doc("users/projection-private")
    .set({
      id: "projection-private",
      clubId: "pprc",
      displayName: "Private player",
      visibility: "private",
    });
  await db
    .doc("publicProfiles/projection-private")
    .set({
      id: "projection-private",
      clubId: "pprc",
      displayName: "Stale private name",
    });
  await db
    .doc("publicProfiles/projection-orphan")
    .set({
      id: "projection-orphan",
      clubId: "pprc",
      displayName: "Deleted player",
    });
}, 30000);
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});
it("dry-runs the actual projection migration without modifying legacy rows", () => {
  expect(migrate("--dry-run")).toContain("Dry run public profiles:");
}, 30000);
it("backfills approved member discovery while removing private/orphaned fields and rows", async () => {
  expect(
    (await db.doc("publicProfiles/projection-old").get()).get("displayName"),
  ).toBe("Old name");
  migrate("--apply");
  const p = await db.doc("publicProfiles/projection-old").get();
  expect(p.get("memberClubId")).toBe("pprc");
  expect(p.get("displayName")).toBe("Projection legacy player");
  expect(p.data()).not.toHaveProperty("email");
  expect(p.data()).not.toHaveProperty("emergencyContact");
  expect((await db.doc("publicProfiles/projection-private").get()).exists).toBe(
    false,
  );
  expect((await db.doc("publicProfiles/projection-orphan").get()).exists).toBe(
    false,
  );
}, 30000);
it("reapplies idempotently and records immutable migration audit events", async () => {
  expect(migrate("--apply")).toContain(
    "Applied public profiles: 0 projection(s)",
  );
  const audit = await db
    .collection("auditEvents")
    .where("action", "==", "migratePublicProfileProjection")
    .get();
  expect(audit.docs.some((a) => a.get("entityId") === "projection-old")).toBe(
    true,
  );
  expect(
    (await db.doc("users/projection-old").get()).get("emergencyContact"),
  ).toBe("Never publish");
}, 30000);
