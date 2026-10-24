import type { Entity } from "./index";
export interface PerformanceRecord {
  id: string;
  eventId: string;
  matchId: string;
  source: "individual" | "team-rubber";
  kind: "singles" | "doubles" | "tiebreak";
  won: boolean;
  outcome: string;
  recordedAt: string;
  version: number;
  opponentIds: string[];
}
export function performanceSummary(records: PerformanceRecord[]) {
  const wins = records.filter((r) => r.won).length;
  const breakdown = (["singles", "doubles", "tiebreak"] as const).map(
    (kind) => {
      const rows = records.filter((r) => r.kind === kind);
      return {
        kind,
        total: rows.length,
        wins: rows.filter((r) => r.won).length,
        losses: rows.filter((r) => !r.won).length,
      };
    },
  );
  const activity = new Map<string, number>();
  for (const r of records)
    if (/^\d{4}-\d{2}/.test(r.recordedAt)) {
      const month = r.recordedAt.slice(0, 7);
      activity.set(month, (activity.get(month) ?? 0) + 1);
    }
  return {
    total: records.length,
    wins,
    losses: records.length - wins,
    winPercentage: records.length
      ? Math.round((wins / records.length) * 1000) / 10
      : null,
    played: records.filter((r) => ["played", "retirement"].includes(r.outcome))
      .length,
    breakdown,
    activity: [...activity]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total })),
  };
}
export function referenceLeaderboard(
  players: Entity[],
  metric: "singles" | "doubles",
) {
  const rows = players
    .filter((p) => p.visibility !== "private")
    .map((p) => ({
      playerId: p.id,
      displayName: p.displayName,
      city: p.city ?? "",
      reference:
        (metric === "singles" ? p.singlesUtr : p.doublesUtr) ??
        p.externalRating,
      source: p.ratingSource ?? "Player provided",
    }))
    .filter(
      (p) =>
        typeof p.reference === "number" &&
        Number.isFinite(p.reference) &&
        p.reference >= 0 &&
        p.reference <= 20,
    )
    .sort(
      (a, b) =>
        b.reference - a.reference ||
        String(a.displayName).localeCompare(String(b.displayName)) ||
        a.playerId.localeCompare(b.playerId),
    );
  return rows.map((row, i) => ({
    ...row,
    rank:
      i && row.reference === rows[i - 1].reference
        ? rows.findIndex((p) => p.reference === row.reference) + 1
        : i + 1,
  }));
}
