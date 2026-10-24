import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "./engine.js";
import { defaultTriaceRules } from "@pprc/shared";
const args = process.argv.slice(2),
  command = args[0],
  project = args[args.indexOf("--project") + 1],
  uid = args[args.indexOf("--uid") + 1],
  staging = JSON.parse(readFileSync("../.firebaserc", "utf8")).projects.staging;
if (
  project !== staging ||
  !args.includes("--approve-staging") ||
  process.env.PPRC_ALLOW_STAGING_WRITE !== project ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw Error(
    "Approved isolated staging target required; no emulator account import is supported",
  );
initializeApp({ projectId: project });
const db = getFirestore();
await getAuth().getUser(uid);
if (command === "bootstrap")
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`memberships/${uid}`),
      snap = await tx.get(ref);
    if (snap.exists)
      throw Error(
        "Membership already exists. Use the audited club role workflow instead of overwriting it.",
      );
    const now = FieldValue.serverTimestamp();
    tx.create(ref, {
      id: uid,
      playerId: uid,
      clubId: "pprc",
      role: "clubAdmin",
      member: true,
      createdBy: "staging-bootstrap",
      createdAt: now,
      updatedAt: now,
    });
    tx.create(db.collection("auditEvents").doc(), {
      clubId: "pprc",
      eventId: "",
      actor: "staging-bootstrap",
      action: "bootstrapAdmin",
      entityId: uid,
      entityType: "membership",
      before: null,
      after: { role: "clubAdmin" },
      reason: "Explicit isolated staging bootstrap",
      createdBy: "staging-bootstrap",
      createdAt: now,
      updatedAt: now,
    });
  });
else if (command === "fixtures") {
  const now = Date.now();
  await execute("createEvent", uid, {
    requestId: randomUUID(),
    event: {
      name: "STAGING · Synthetic TRIACE rehearsal",
      description:
        "Synthetic event configuration only. No real players, emulator passwords, payments or waivers were imported. Register staging test identities through the application.",
      venue: "Staging rehearsal venue",
      location: "Synthetic staging",
      startDate: new Date(now + 7 * 86400000).toISOString(),
      endDate: new Date(now + 10 * 86400000).toISOString(),
      timezone: "America/Chicago",
      visibility: "private",
      fee: 0,
      capacity: 8,
      waitlist: true,
      registrationOpen: new Date(now - 60000).toISOString(),
      registrationClose: new Date(now + 6 * 86400000).toISOString(),
      waiverRequired: true,
      refundPolicy: "Synthetic rehearsal only",
      sport: "Tennis",
      organizer: "PPRC staging",
      questions: [],
      assignedAdmins: [uid],
      courtIds: [],
      duration: 120,
      buffer: 15,
      competition: "triace",
      triaceRules: defaultTriaceRules,
    },
    divisions: [
      {
        name: "Synthetic TRIACE teams",
        format: "round-robin-playoffs",
        capacity: 8,
      },
    ],
  });
} else throw Error("Choose bootstrap or fixtures");
console.log(
  `Approved staging ${command} complete. No emulator Auth accounts, passwords, payment records or push tokens copied.`,
);
await db.terminate();
