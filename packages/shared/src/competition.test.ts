import { describe, it, expect } from "vitest";
import {
  competitionRulesSchema,
  competitionRules,
  defaultKocRules,
  defaultDoublesRules,
  validateCompetitionLineup,
  competitionRatingSnapshot,
  validateCompetitionRating,
  validateCompetitionScore,
  competitionStandings,
  defaultTriaceRules,
  singlesParticipation,
  type Team,
  type Entity,
} from "./index";
const team = (size: number): Team => ({
  id: "a",
  clubId: "pprc",
  name: "A",
  captainId: "p1",
  memberIds: Array.from({ length: size }, (_, i) => `p${i + 1}`),
  roster: Array.from({ length: size }, (_, i) => ({
    slot: `P${i + 1}` as Team["roster"][number]["slot"],
    playerId: `p${i + 1}`,
    displayName: `Player ${i + 1}`,
  })),
  withdrawn: false,
});
const rubber: Entity = {
  id: "rubber",
  clubId: "pprc",
  teamA: "a",
  teamB: "b",
  kind: "doubles",
};
describe("shared configurable team competition policy", () => {
  it("retains TRIACE's five-rubber/three-player policy and pending maximum", () => {
    const rules = competitionRules({
      id: "e",
      clubId: "pprc",
      competition: "triace",
      triaceRules: defaultTriaceRules,
    });
    expect(rules).toMatchObject({
      teamSize: 3,
      singlesRubbers: 2,
      doublesRubbers: 2,
      decidingTiebreak: true,
      winsRequired: 3,
      combinedMinimum: 12,
      combinedMaximum: 18.5,
      policyConfirmed: false,
      encounterConfirmation: "lineups",
    });
  });
  it("requires organizer review of KOC and doubles presets", () => {
    expect(defaultKocRules.policyConfirmed).toBe(false);
    expect(defaultDoublesRules).toMatchObject({
      teamSize: 2,
      doublesRubbers: 1,
      singlesRubbers: 0,
      winsRequired: 1,
      stageFormat: "round-robin",
    });
  });
  it("rejects infeasible or unknown policy properties", () => {
    for (const changes of [
      { singlesRubbers: 1 },
      { winsRequired: 1 },
      { teamSize: 1 },
      { maxRubbersPerPlayer: 1, teamSize: 2, allowedDoublesPairs: ["P1+P2"] },
      { allowedDoublesPairs: ["P1+P5"] },
      { stageFormat: "round-robin", groupCount: 2 },
      { stageFormat: "groups-playoffs", groupCount: 3, qualifiersPerGroup: 1 },
      { standingsTieBreaks: ["wins", "wins"] },
      { unknownPolicy: true },
    ])
      expect(() =>
        competitionRulesSchema.parse({ ...defaultKocRules, ...changes }),
      ).toThrow();
  });
  it("cannot turn the doubles entry into a different roster or encounter", () => {
    expect(() =>
      competitionRules({
        id: "e",
        clubId: "pprc",
        competition: "doubles",
        teamRules: { ...defaultDoublesRules, teamSize: 3 },
      }),
    ).toThrow("fixed pair");
  });
  it("supports four-player KOC and rejects non-roster, repeated and overused assignments", () => {
    const lineup = {
      singles: ["p1", "p2"],
      doubles: [{ players: ["p3", "p4"] }],
      tiebreak: [],
    };
    expect(validateCompetitionLineup(team(4), lineup, defaultKocRules)).toEqual(
      lineup,
    );
    expect(() =>
      validateCompetitionLineup(
        team(4),
        { ...lineup, singles: ["p1", "outside"] },
        defaultKocRules,
      ),
    ).toThrow("unauthorized");
    expect(() =>
      validateCompetitionLineup(
        team(4),
        { ...lineup, singles: ["p1", "p1"] },
        defaultKocRules,
      ),
    ).toThrow("distinct");
    const limited = { ...defaultKocRules, maxRubbersPerPlayer: 1 };
    expect(() =>
      validateCompetitionLineup(
        team(4),
        { ...lineup, doubles: [{ players: ["p1", "p3"] }] },
        limited,
      ),
    ).toThrow("appearance");
  });
  it("validates a fixed doubles pair without requiring singles or deciding assignments", () => {
    expect(
      validateCompetitionLineup(
        team(2),
        { singles: [], doubles: [{ players: ["p1", "p2"] }], tiebreak: [] },
        defaultDoublesRules,
      ).singles,
    ).toEqual([]);
  });
  it("uses configured trusted references and verifies inclusive combined bounds", () => {
    const rules = competitionRulesSchema.parse({
      ...defaultDoublesRules,
      referenceMetric: "doubles",
      requireVerified: true,
      combinedMinimum: 10,
      combinedMaximum: 10,
    });
    const profiles = ["p1", "p2"].map((id) => ({
      id,
      clubId: "pprc",
      singlesUtr: 3,
      doublesUtr: 5,
      ratingSource: "Admin verified",
    }));
    const snapshots = profiles.map((p) => competitionRatingSnapshot(p, rules));
    expect(validateCompetitionRating(snapshots, rules)).toBe(10);
    expect(() =>
      competitionRatingSnapshot(
        { ...profiles[0], ratingSource: "Player provided" },
        rules,
      ),
    ).toThrow("verified");
    expect(() =>
      validateCompetitionRating(
        [snapshots[0], { ...snapshots[1], reference: 5.0001 }],
        rules,
      ),
    ).toThrow("outside");
  });
  it("records unknown references as null only when every reference bound is disabled", () => {
    expect(() =>
      competitionRulesSchema.parse({ requireReferences: false }),
    ).toThrow("bounds");
    const rules = competitionRulesSchema.parse({
      ...defaultDoublesRules,
      requireReferences: false,
      combinedMinimum: 0,
      combinedMaximum: null,
    });
    const snapshots = ["p1", "p2"].map((id) =>
      competitionRatingSnapshot({ id, clubId: "pprc" }, rules),
    );
    expect(snapshots[0].reference).toBeNull();
    expect(validateCompetitionRating(snapshots, rules)).toBeNull();
  });
  it("supports short sets and rejects points past their configured tiebreak", () => {
    const rules = competitionRulesSchema.parse({
      ...defaultDoublesRules,
      rubberScoring: "one-set",
      setGames: 4,
      setTiebreakAt: 3,
    });
    expect(
      validateCompetitionScore(
        { winner: "a", sets: [{ a: 4, b: 3 }] },
        rubber,
        rules,
      ).winner,
    ).toBe("a");
    expect(() =>
      validateCompetitionScore(
        { winner: "a", sets: [{ a: 5, b: 3 }] },
        rubber,
        rules,
      ),
    ).toThrow("after");
  });
  it("supports capped points with exact finishing scores", () => {
    const rules = competitionRulesSchema.parse({
      ...defaultDoublesRules,
      rubberScoring: "one-set",
      pointsOnly: true,
      pointsTarget: 7,
      pointsCap: 9,
      finalSetTiebreak: false,
    });
    for (const [a, b] of [
      [7, 4],
      [8, 6],
      [9, 8],
    ])
      expect(
        validateCompetitionScore(
          { winner: "a", sets: [{ a, b }] },
          rubber,
          rules,
        ).winner,
      ).toBe("a");
    for (const [a, b] of [
      [7, 6],
      [8, 3],
      [9, 3],
      [10, 8],
    ])
      expect(() =>
        validateCompetitionScore(
          { winner: "a", sets: [{ a, b }] },
          rubber,
          rules,
        ),
      ).toThrow();
  });
  it("allows a ten-point deciding set in configured doubles and preserves winner validation", () => {
    const score = {
      winner: "a",
      sets: [
        { a: 6, b: 3 },
        { a: 4, b: 6 },
        { a: 10, b: 8, matchTiebreak: true },
      ],
    };
    expect(
      validateCompetitionScore(score, rubber, defaultDoublesRules),
    ).toEqual({ ...score, outcome: "played", notes: "" });
    expect(() =>
      validateCompetitionScore(
        { ...score, winner: "b" },
        rubber,
        defaultDoublesRules,
      ),
    ).toThrow("winner");
    expect(() =>
      validateCompetitionScore(
        { ...score, sets: [{ a: 10, b: 8, matchTiebreak: true }] },
        rubber,
        defaultDoublesRules,
      ),
    ).toThrow("third set");
  });
  it("records exceptional outcomes with reasons and no fabricated games", () => {
    expect(
      validateCompetitionScore(
        { winner: "b", sets: [], outcome: "forfeit", notes: "Opponent absent" },
        rubber,
        defaultDoublesRules,
      ).outcome,
    ).toBe("forfeit");
    expect(() =>
      validateCompetitionScore(
        {
          winner: "b",
          sets: [{ a: 0, b: 6 }],
          outcome: "forfeit",
          notes: "Absent",
        },
        rubber,
        defaultDoublesRules,
      ),
    ).toThrow("invented");
  });
  it("reuses confirmed encounter totals and respects configured head-to-head/tie resolution", () => {
    const games = [
      {
        id: "m",
        clubId: "pprc",
        teamA: "a",
        teamB: "b",
        status: "Final",
        winner: "b",
        winsA: 0,
        winsB: 1,
      },
    ];
    const rules = {
      ...defaultDoublesRules,
      standingsTieBreaks: ["head-to-head" as const],
    };
    expect(competitionStandings(["a", "b"], games, rules)[0].teamId).toBe("b");
    expect(
      competitionStandings(["a", "b"], [], rules).every((r) => r.tied),
    ).toBe(true);
    expect(
      competitionStandings(["a", "b"], [], rules, { a: 2, b: 1 })[0],
    ).toMatchObject({ teamId: "b", tied: false });
  });
  it("uses configured singles opportunities and treats a zero participation policy explicitly", () => {
    const encounter = {
      id: "m",
      clubId: "pprc",
      teamA: "a",
      teamB: "b",
      phase: "groups",
      status: "Final",
    };
    const rules = {
      ...defaultTriaceRules,
      participationBasis: "singles-opportunities" as const,
      singlesRubbers: 1,
    };
    const result = singlesParticipation(
      "p1",
      "a",
      [encounter],
      [
        {
          id: "r",
          clubId: "pprc",
          encounterId: "m",
          kind: "singles",
          status: "Final",
          playersA: ["p1"],
          playersB: ["q1"],
          outcome: "played",
        },
      ],
      rules,
    );
    expect(result).toMatchObject({
      opportunities: 1,
      percent: 100,
      eligible: true,
    });
    expect(
      singlesParticipation("p1", "a", [], [], defaultDoublesRules).eligible,
    ).toBe(true);
  });
});
