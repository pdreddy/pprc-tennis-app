import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";

// Real Firestore emulator. Synthetic players only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
let env: RulesTestEnvironment;
const owner = "avail-owner",
  rival = "avail-rival",
  noProfile = "avail-no-profile";
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const availability = {
  weekdays: [1, 3],
  windows: [{ start: "18:00", end: "20:00" }],
  unavailableDates: ["2031-03-17"],
  notes: "Synthetic evenings",
};

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  for (const uid of [owner, rival]) {
    await db
      .doc(`users/${uid}`)
      .set({ id: uid, clubId: "pprc", displayName: uid });
    await db
      .doc(`memberships/${uid}`)
      .set({ clubId: "pprc", role: "player", member: true });
  }
  await db
    .doc(`memberships/avail-admin`)
    .set({ clubId: "pprc", role: "clubAdmin", member: true });
  env = await initializeTestEnvironment({
    projectId: "demo-pprc-events",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
}, 60000);

afterAll(async () => {
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});

describe("player availability", () => {
  it("saves a normalized availability record for the signed-in player", async () => {
    await execute("saveAvailability", owner, req({ availability }));
    const saved = (await db.doc(`availability/${owner}`).get()).data()!;
    expect(saved.playerId).toBe(owner);
    expect(saved.weekdays).toEqual([1, 3]);
    expect(saved.windows).toEqual([{ start: "18:00", end: "20:00" }]);
  });

  it("rejects invalid windows and players without a profile", async () => {
    await expect(
      execute(
        "saveAvailability",
        owner,
        req({
          availability: {
            ...availability,
            windows: [{ start: "20:00", end: "18:00" }],
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      execute("saveAvailability", noProfile, req({ availability })),
    ).rejects.toThrow("Create a profile first");
  });

  it("lets only the owner and club administrators read availability", async () => {
    const ownerDb = env.authenticatedContext(owner).firestore();
    const rivalDb = env.authenticatedContext(rival).firestore();
    const adminDb = env.authenticatedContext("avail-admin").firestore();
    await assertSucceeds(getDoc(doc(ownerDb, `availability/${owner}`)));
    await assertFails(getDoc(doc(rivalDb, `availability/${owner}`)));
    await assertSucceeds(getDoc(doc(adminDb, `availability/${owner}`)));
  });

  it("denies clients any write, including the owner", async () => {
    const ownerDb = env.authenticatedContext(owner).firestore();
    await assertFails(
      setDoc(doc(ownerDb, `availability/${owner}`), {
        playerId: owner,
        weekdays: [0],
      }),
    );
  });
});
