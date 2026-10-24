import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2),
  index = args.indexOf("--project"),
  projectId = index < 0 ? "demo-pprc-events" : args[index + 1];
const apply = args.includes("--apply"),
  emulator = projectId?.startsWith("demo-");
if (apply && args.includes("--dry-run"))
  throw Error("Choose --dry-run or --apply");
const staging = JSON.parse(readFileSync("../.firebaserc", "utf8")).projects
  .staging;
if (!projectId || (!emulator && projectId !== staging))
  throw Error(
    "Target must be a demo project or the configured staging project",
  );
if (emulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
} else {
  if (process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Unset emulator bindings before real staging migration");
  if (
    apply &&
    (!args.includes("--approve-staging") ||
      process.env.PPRC_ALLOW_STAGING_WRITE !== projectId)
  )
    throw Error(
      "Staging writes require --approve-staging and PPRC_ALLOW_STAGING_WRITE=projectId",
    );
}
initializeApp({ projectId });
const db = getFirestore();
let count = 0;
const events = await db
  .collection("events")
  .where("clubId", "==", "pprc")
  .get();
for (const e of events.docs) {
  if (e.get("schemaVersion") !== undefined) continue;
  const competition = e.get("competition") ?? "individual";
  if (!["individual", "triace"].includes(competition))
    throw Error(`Unknown competition in ${e.id}; migration stopped`);
  count++;
  console.log(
    `${apply ? "Applying" : "Would migrate"} events/${e.id}: add schemaVersion and compatibility competition`,
  );
  if (apply)
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(e.ref);
      if (fresh.get("schemaVersion") !== undefined) return;
      tx.update(e.ref, {
        schemaVersion: competition === "triace" ? 2 : 1,
        competition,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(db.collection("auditEvents").doc(), {
        clubId: "pprc",
        eventId: e.id,
        actor: "migration-v2",
        action: "migrateEventSchema",
        entityType: "event",
        entityId: e.id,
        before: { schemaVersion: null },
        after: { schemaVersion: competition === "triace" ? 2 : 1, competition },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: "migration-v2",
      });
    });
}
console.log(
  `${apply ? "Applied" : "Dry run"}: ${count} event(s). Existing sporting records, profiles and payments unchanged.`,
);
await db.terminate();
