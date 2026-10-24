import { it, expect } from "vitest";
import {
  performanceSummary,
  referenceLeaderboard,
  type PerformanceRecord,
} from "./players";
const record = (data: Partial<PerformanceRecord>): PerformanceRecord => ({
  id: "r",
  eventId: "event",
  matchId: "match",
  source: "individual",
  kind: "singles",
  won: true,
  outcome: "played",
  recordedAt: "2026-10-01T12:00:00Z",
  version: 1,
  opponentIds: ["other"],
  ...data,
});
it("summarizes actual results while distinguishing played contests from exceptional outcomes", () => {
  const summary = performanceSummary([
    record({}),
    record({ id: "2", won: false, outcome: "walkover" }),
    record({ id: "3", kind: "doubles", outcome: "retirement" }),
    record({ id: "4", kind: "tiebreak", outcome: "forfeit" }),
  ]);
  expect(summary).toMatchObject({
    total: 4,
    wins: 3,
    losses: 1,
    played: 2,
    winPercentage: 75,
  });
  expect(summary.breakdown.find((r) => r.kind === "singles")).toMatchObject({
    total: 2,
    wins: 1,
    losses: 1,
  });
});
it("does not imply a performance percentage without confirmed records", () =>
  expect(performanceSummary([])).toMatchObject({
    total: 0,
    wins: 0,
    losses: 0,
    winPercentage: null,
    activity: [],
  }));
it("groups recorded activity by actual result timestamps", () =>
  expect(
    performanceSummary([
      record({ recordedAt: "2026-09-10T12:00:00Z" }),
      record({ id: "2", recordedAt: "2026-10-10T12:00:00Z" }),
      record({ id: "3", recordedAt: "2026-10-12T12:00:00Z" }),
    ]).activity,
  ).toEqual([
    { month: "2026-09", total: 1 },
    { month: "2026-10", total: 2 },
  ]));
it("ranks authorized reference values with shared competition ranks for ties", () => {
  const rows = referenceLeaderboard(
    [
      { id: "a", clubId: "pprc", displayName: "A", singlesUtr: 5.2 },
      { id: "b", clubId: "pprc", displayName: "B", singlesUtr: 5.2 },
      { id: "c", clubId: "pprc", displayName: "C", externalRating: 4.5 },
    ],
    "singles",
  );
  expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  expect(rows[2].reference).toBe(4.5);
});
it("uses the selected singles/doubles reference and excludes private, missing or invalid values", () => {
  const rows = referenceLeaderboard(
    [
      {
        id: "a",
        clubId: "pprc",
        displayName: "A",
        singlesUtr: 4,
        doublesUtr: 6,
      },
      { id: "b", clubId: "pprc", visibility: "private", doublesUtr: 8 },
      { id: "c", clubId: "pprc" },
      { id: "d", clubId: "pprc", doublesUtr: NaN },
    ],
    "doubles",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    playerId: "a",
    reference: 6,
    source: "Player provided",
  });
});
