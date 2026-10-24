import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "./engine.js";

export async function runEventMaintenance() {
  const db = getFirestore();
  const events = await db
    .collection("events")
    .where("status", "in", [
      "Published",
      "Registration Open",
      "Registration Closed",
      "Check-In",
      "In Progress",
    ])
    .get();
  for (const doc of events.docs) {
    const event = doc.data(),
      now = Date.now();
    let status = event.status;
    if (status === "Published" && now >= Date.parse(event.registrationOpen))
      status = "Registration Open";
    if (
      status === "Registration Open" &&
      now > Date.parse(event.registrationClose)
    )
      status = "Registration Closed";
    if (status !== event.status)
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (fresh.get("status") !== event.status) return;
        tx.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
        tx.create(db.collection("auditEvents").doc(), {
          actor: "system",
          action: "eventDeadline",
          clubId: "pprc",
          eventId: doc.id,
          entityType: "event",
          entityId: doc.id,
          before: { status: event.status },
          after: { status },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: "system",
        });
      });
    await execute(
      "expireReservations",
      "system",
      { eventId: doc.id, requestId: randomUUID() },
      true,
    );
    const matches = await db
      .collection("matches")
      .where("eventId", "==", doc.id)
      .get();
    for (const match of matches.docs) {
      const m = match.data(),
        t = Date.parse(m.scheduledAt ?? "");
      if (t < now || t > now + 30 * 60000 || m.status === "Final") continue;
      for (const playerId of [m.p1, m.p2].filter(Boolean)) {
        const ref = db.doc(
          `notifications/reminder-${match.id}-${playerId}-${t}`,
        );
        await db.runTransaction(async (tx) => {
          if ((await tx.get(ref)).exists) return;
          tx.create(ref, {
            id: ref.id,
            clubId: "pprc",
            eventId: doc.id,
            playerId,
            title: "Your match starts soon",
            body: `${event.name}: check your court assignment.`,
            type: "match-reminder",
            read: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: "system",
          });
        });
      }
    }
    const encounters = await db
      .collection("teamEncounters")
      .where("eventId", "==", doc.id)
      .get();
    const teams = await db
      .collection("teams")
      .where("eventId", "==", doc.id)
      .get();
    for (const encounter of encounters.docs) {
      const e = encounter.data(),
        t = Date.parse(e.scheduledAt ?? "");
      if (
        !Number.isFinite(t) ||
        t < now ||
        t > now + 30 * 60000 ||
        e.status === "Final"
      )
        continue;
      const players = new Set(
        teams.docs
          .filter((team) => [e.teamA, e.teamB].includes(team.id))
          .flatMap((team) => team.get("memberIds") as string[]),
      );
      for (const playerId of players) {
        const ref = db.doc(
          `notifications/team-reminder-${encounter.id}-${playerId}-${t}`,
        );
        await db.runTransaction(async (tx) => {
          if ((await tx.get(ref)).exists) return;
          tx.create(ref, {
            id: ref.id,
            clubId: "pprc",
            eventId: doc.id,
            playerId,
            title: "Your team encounter starts soon",
            body: `${event.name}: review your lineup and court assignment.`,
            type: "team-reminder",
            read: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: "system",
          });
        });
      }
    }
  }
}
