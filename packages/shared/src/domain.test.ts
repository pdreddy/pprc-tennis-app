import { describe, it, expect } from "vitest";
import {
  elimination,
  advance,
  roundRobin,
  standings,
  validateScore,
  registrationPlacement,
  eligibility,
  canManage,
  scheduleConflict,
  withinDailyHours,
  csv,
  eventSchema,
  type Division,
  type Entity,
} from "./index";
const score = {
  winner: "a",
  sets: [
    { a: 6, b: 4 },
    { a: 6, b: 3 },
  ],
  outcome: "played" as const,
  notes: "",
};
describe("registration and permissions", () => {
  it("enforces division and event capacities then waitlists", () => {
    expect(registrationPlacement(1, 1, 2, 2, true)).toBe("Registered");
    expect(registrationPlacement(2, 2, 2, 2, true)).toBe("Waitlisted");
    expect(registrationPlacement(0, 2, 2, 2, true)).toBe("Waitlisted");
    expect(() => registrationPlacement(2, 2, 2, 2, false)).toThrow("full");
  });
  it("restricts event administrators by assignment and denies support mutations", () => {
    expect(canManage("eventAdmin", "a", { assignedAdmins: ["a"] })).toBe(true);
    expect(canManage("eventAdmin", "b", { assignedAdmins: ["a"] })).toBe(false);
    expect(canManage("platformAdmin", "a", { assignedAdmins: ["a"] })).toBe(
      false,
    );
    expect(canManage("clubAdmin", "a")).toBe(true);
  });
  it("checks age, gender and external reference eligibility", () => {
    const d = {
      minAge: 18,
      maxAge: 120,
      minRating: 4,
      maxRating: 6,
      gender: "Open",
    } as Division;
    expect(eligibility({ id: "a", clubId: "pprc" }, d)).toContain("birth");
    expect(
      eligibility(
        { id: "a", clubId: "pprc", birthDate: "not-a-date", externalRating: 5 },
        d,
      ),
    ).toContain("birth");
    expect(
      eligibility(
        { id: "a", clubId: "pprc", birthDate: "1990-01-01", externalRating: 5 },
        d,
      ),
    ).toBe(null);
    expect(
      eligibility(
        { id: "a", clubId: "pprc", birthDate: "1990-01-01", externalRating: 9 },
        d,
      ),
    ).toContain("Reference");
  });
});
describe("deterministic brackets and byes", () => {
  it.each([2, 3, 5, 8, 16, 31])(
    "advances %i unique entrants to one final winner",
    (n) => {
      const p = Array.from({ length: n }, (_, i) => `p${i}`),
        draw = elimination(p, "d", "v");
      expect(draw).toEqual(elimination(p, "d", "v"));
      expect(draw.length).toBe(2 ** Math.ceil(Math.log2(n)) - 1);
      const first = draw.filter((m) => m.round === 1);
      expect(
        first
          .flatMap((m) => [m.p1, m.p2])
          .filter(Boolean)
          .sort(),
      ).toEqual([...p].sort());
      for (const m of draw)
        if (m.status === "Scheduled" && m.p1 && m.p2) advance(draw, m, m.p1);
      expect(draw.at(-1)?.winner).toBeTruthy();
      expect(draw.filter((m) => m.status === "Final")).toHaveLength(n - 1);
    },
  );
  it("rejects duplicates and reopening after downstream scoring", () => {
    expect(() => elimination(["a", "a"], "d", "v")).toThrow();
    const d = elimination(["a", "b", "c", "d"], "d", "v");
    advance(d, d[0], d[0].p1!);
    advance(d, d[1], d[1].p1!);
    d[2].version = 1;
    expect(() => advance(d, d[0], d[0].p2!)).toThrow("Downstream");
  });
  it("generates each round-robin pairing once without player overlap", () => {
    const players = ["a", "b", "c", "d", "e"],
      matches = roundRobin(players, "d", "v");
    expect(matches).toHaveLength(10);
    expect(new Set(matches.map((m) => [m.p1, m.p2].sort().join())).size).toBe(
      10,
    );
    for (const round of new Set(matches.map((m) => m.round))) {
      const ids = matches
        .filter((m) => m.round === round)
        .flatMap((m) => [m.p1, m.p2]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("calculates wins, set/game percentages and head-to-head", () => {
    const ms = roundRobin(["a", "b", "c"], "d", "v");
    const results: Entity[] = [];
    for (const m of ms) {
      const winner = m.p1 === "a" || m.p2 === "a" ? "a" : m.p1!;
      advance(ms, m, winner);
      m.version = 1;
      const sets =
        m.p1 === winner
          ? [
              { a: 6, b: 4 },
              { a: 6, b: 3 },
            ]
          : [
              { a: 4, b: 6 },
              { a: 3, b: 6 },
            ];
      results.push({
        id: m.id,
        clubId: "pprc",
        matchId: m.id,
        version: 1,
        score: { sets },
      });
    }
    const rows = standings(["a", "b", "c"], ms, results);
    expect(rows[0].playerId).toBe("a");
    expect(rows[0].wins).toBe(2);
    expect(rows[0].setsWon).toBe(4);
    expect(rows[0].gamesWon).toBe(24);
    expect(rows[0].gamesPlayed).toBe(38);
  });
  it("flags unresolved ties and uses audited admin positions", () => {
    expect(standings(["a", "b", "c"], [], []).every((r) => r.tied)).toBe(true);
    const resolved = standings(["a", "b"], [], [], ["admin"], { a: 2, b: 1 });
    expect(resolved[0].playerId).toBe("b");
    expect(resolved[0].tied).toBe(false);
  });
  it("does not count an incomplete retirement set as a won set", () => {
    const m = roundRobin(["a", "b"], "d", "v")[0];
    advance([m], m, "a");
    m.version = 1;
    const rows = standings(
      ["a", "b"],
      [m],
      [
        {
          id: "r",
          clubId: "pprc",
          matchId: m.id,
          version: 1,
          score: { sets: [{ a: 3, b: 2 }] },
        },
      ],
    );
    expect(rows[0].wins).toBe(1);
    expect(rows[0].setsWon).toBe(0);
    expect(rows[0].gamesPlayed).toBe(5);
  });
});
describe("legal tennis scores", () => {
  it("accepts regular wins, match tiebreaks and extended set tiebreaks", () => {
    expect(() => validateScore(score, "a", "b")).not.toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [
            { a: 6, b: 4 },
            { a: 3, b: 6 },
            { a: 12, b: 10, matchTiebreak: true },
          ],
        },
        "a",
        "b",
      ),
    ).not.toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [
            { a: 7, b: 6, tiebreakA: 9, tiebreakB: 7 },
            { a: 6, b: 4 },
          ],
        },
        "a",
        "b",
      ),
    ).not.toThrow();
  });
  it.each(
    [
      [
        { a: 6, b: 5 },
        { a: 6, b: 4 },
      ],
      [
        { a: 8, b: 6 },
        { a: 6, b: 4 },
      ],
      [
        { a: 7, b: 6 },
        { a: 6, b: 4 },
      ],
      [{ a: 6, b: 4 }],
      [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
        { a: 6, b: 2 },
      ],
    ].map((sets) => [sets]),
  )("rejects impossible/unfinished games %j", (sets) => {
    expect(() => validateScore({ ...score, sets }, "a", "b")).toThrow();
  });
  it("rejects wrong winners, invalid tiebreaks and misplaced third-set replacements", () => {
    expect(() => validateScore({ ...score, winner: "b" }, "a", "b")).toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [
            { a: 7, b: 6, tiebreakA: 7, tiebreakB: 6 },
            { a: 6, b: 4 },
          ],
        },
        "a",
        "b",
      ),
    ).toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [
            { a: 10, b: 8, matchTiebreak: true },
            { a: 6, b: 4 },
          ],
        },
        "a",
        "b",
      ),
    ).toThrow();
  });
  it("requires non-playing outcome reasons and validates retirements", () => {
    expect(() =>
      validateScore({ ...score, sets: [], outcome: "walkover" }, "a", "b"),
    ).toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [],
          outcome: "default",
          notes: "Player did not arrive",
        },
        "a",
        "b",
      ),
    ).not.toThrow();
    expect(() =>
      validateScore(
        {
          ...score,
          sets: [{ a: 3, b: 2 }],
          outcome: "retirement",
          notes: "Player retired",
        },
        "a",
        "b",
      ),
    ).not.toThrow();
    expect(() =>
      validateScore(
        { ...score, outcome: "retirement", notes: "Player retired" },
        "a",
        "b",
      ),
    ).toThrow("Completed");
  });
});
describe("scheduling and safe reports", () => {
  it("detects shared courts/players including buffers", () => {
    const a = {
      p1: "a",
      p2: "b",
      courtId: "1",
      scheduledAt: "2026-10-22T14:00:00Z",
    };
    expect(
      scheduleConflict(
        a,
        { p1: "c", courtId: "1", scheduledAt: "2026-10-22T15:00:00Z" },
        90,
      ),
    ).toBe(true);
    expect(
      scheduleConflict(
        a,
        { p1: "a", courtId: "2", scheduledAt: "2026-10-22T15:00:00Z" },
        90,
      ),
    ).toBe(true);
    expect(
      scheduleConflict(
        a,
        { p1: "a", courtId: "1", scheduledAt: "2026-10-22T15:30:00Z" },
        90,
      ),
    ).toBe(false);
  });
  it("requires whole matches to fit local playing hours across DST", () => {
    expect(
      withinDailyHours("2026-10-22T14:00:00Z", "America/Chicago", 8, 21, 90),
    ).toBe(true);
    expect(
      withinDailyHours("2026-10-23T01:00:00Z", "America/Chicago", 8, 21, 90),
    ).toBe(false);
    expect(
      withinDailyHours("2026-11-02T14:00:00Z", "America/Chicago", 8, 21, 90),
    ).toBe(true);
  });
  it("neutralizes spreadsheet formulas and escapes quotes", () => {
    expect(csv([{ name: "=evil()", notes: 'a,"b"' }])).toContain("'=evil()");
    expect(csv([{ notes: 'a,"b"' }])).toContain('"a,""b"""');
  });
  it("rejects incomplete event configurations", () =>
    expect(eventSchema.safeParse({}).success).toBe(false));
});
