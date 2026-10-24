import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { performanceSummary, type PerformanceRecord } from "@pprc/shared";
const timestamp = (value: any) =>
  value?.toDate instanceof Function
    ? value.toDate().toISOString()
    : typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : "";
/** Read-only, owner-scoped aggregation of persisted final results; never a rating. */
export async function getMyPerformance(uid: string, raw: unknown) {
  z.object({ requestId: z.string().uuid().optional() })
    .strict()
    .parse(raw ?? {});
  const db = getFirestore(),
    limit = 500;
  const [profile, individual, a, b, references] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db
      .collection("matchResults")
      .where("participants", "array-contains", uid)
      .where("state", "==", "Final")
      .orderBy("createdAt", "desc")
      .limit(limit + 1)
      .get(),
    db
      .collection("rubbers")
      .where("playersA", "array-contains", uid)
      .where("status", "==", "Final")
      .orderBy("createdAt", "desc")
      .limit(limit + 1)
      .get(),
    db
      .collection("rubbers")
      .where("playersB", "array-contains", uid)
      .where("status", "==", "Final")
      .orderBy("createdAt", "desc")
      .limit(limit + 1)
      .get(),
    db
      .collection("ratingSnapshots")
      .where("playerId", "==", uid)
      .orderBy("capturedAt", "desc")
      .limit(101)
      .get(),
  ]);
  if (!profile.exists)
    throw new HttpsError(
      "failed-precondition",
      "Complete your player profile to view performance",
    );
  const records: PerformanceRecord[] = [];
  for (const doc of individual.docs) {
    const r = doc.data();
    if (!r.score || !r.participants.includes(r.score.winner)) continue;
    records.push({
      id: `individual-${doc.id}`,
      eventId: r.eventId,
      matchId: r.matchId,
      source: "individual",
      kind: "singles",
      won: r.score.winner === uid,
      outcome: r.score.outcome,
      recordedAt: timestamp(r.createdAt),
      version: r.version ?? 1,
      opponentIds: r.participants.filter((p: string) => p !== uid),
    });
  }
  const rubbers = [
    ...new Map([...a.docs, ...b.docs].map((doc) => [doc.id, doc])).values(),
  ];
  for (const doc of rubbers) {
    const r = doc.data(),
      side = r.playersA.includes(uid) ? "A" : "B";
    if (![r.teamA, r.teamB].includes(r.winner)) continue;
    records.push({
      id: `rubber-${doc.id}`,
      eventId: r.eventId,
      matchId: doc.id,
      source: "team-rubber",
      kind: r.kind,
      won: r.winner === (side === "A" ? r.teamA : r.teamB),
      outcome: r.outcome ?? r.score?.outcome ?? "played",
      recordedAt: timestamp(r.createdAt),
      version: r.version ?? 1,
      opponentIds: side === "A" ? r.playersB : r.playersA,
    });
  }
  records.sort(
    (a, b) =>
      b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id),
  );
  const history = records.slice(0, limit),
    p = profile.data()!;
  return {
    playerId: uid,
    summary: performanceSummary(history),
    history,
    coverage: {
      limit,
      truncated:
        individual.size > limit ||
        a.size > limit ||
        b.size > limit ||
        records.length > limit,
      order: "record-created-at",
    },
    references: {
      singles: p.singlesUtr ?? p.externalRating ?? null,
      doubles: p.doublesUtr ?? p.externalRating ?? null,
      external: p.externalRating ?? null,
      source: p.ratingSource ?? "Player provided",
      verifiedAt: timestamp(p.ratingVerifiedAt),
    },
    referenceHistory: references.docs.slice(0, 100).map((doc) => {
      const r = doc.data();
      return {
        id: doc.id,
        eventId: r.eventId,
        singles: r.singles,
        doubles: r.doubles,
        reference: r.reference,
        source: r.source,
        verified: r.verified,
        capturedAt: r.capturedAt,
      };
    }),
    referenceHistoryTruncated: references.size > 100,
  };
}
