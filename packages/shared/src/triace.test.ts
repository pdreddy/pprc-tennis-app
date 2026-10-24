import { describe, it, expect } from "vitest";
import {
  defaultTriaceRules as rules,
  triaceRulesSchema,
  validateTeamLineup,
  ratingSnapshot,
  validateTeamRating,
  validateRubberScore,
  singlesParticipation,
  teamStandings,
  type Team,
  type Entity,
} from "./index";
const team: Team = {
  id: "alpha",
  clubId: "pprc",
  name: "Alpha",
  captainId: "a",
  memberIds: ["a", "b", "c"],
  withdrawn: false,
  roster: [
    { slot: "P1", playerId: "a", displayName: "A" },
    { slot: "P2", playerId: "b", displayName: "B" },
    { slot: "P3", playerId: "c", displayName: "C" },
  ],
};
const lineup = {
  singles: ["a", "b"],
  doubles: [{ players: ["a", "b"] }, { players: ["b", "c"] }],
  tiebreak: ["c"],
};
const rubber: Entity = {
  id: "r",
  clubId: "pprc",
  teamA: "alpha",
  teamB: "beta",
  kind: "singles",
};
describe("TRIACE policy, references and lineups", () => {
  it("keeps the unconfirmed 18.5 maximum and policy choices explicit", () => {
    expect(rules.combinedMaximum).toBe(18.5);
    expect(rules.maximumPolicyConfirmed).toBe(false);
    expect(rules.participationBasis).toBe("encounters");
  });
  it("rejects inverted bounds and impossible qualifier counts", () => {
    expect(() =>
      triaceRulesSchema.parse({ combinedMinimum: 19, combinedMaximum: 18 }),
    ).toThrow();
    expect(() =>
      triaceRulesSchema.parse({ groupCount: 3, qualifiersPerGroup: 2 }),
    ).toThrow();
  });
  it("uses the higher singles or doubles reference without calculating a rating", () => {
    const s = ratingSnapshot({
      id: "a",
      clubId: "pprc",
      singlesUtr: 4,
      doublesUtr: 5,
      ratingSource: "Admin verified",
    });
    expect(s.reference).toBe(5);
    expect(s.verified).toBe(true);
  });
  it("supports old player documents with a single reference", () => {
    const s = ratingSnapshot({ id: "a", clubId: "pprc", externalRating: 4 });
    expect(s.singles).toBe(4);
    expect(s.doubles).toBe(4);
  });
  it("rejects missing or non-finite reference values", () => {
    for (const externalRating of [undefined, NaN, Infinity, -1, 21])
      expect(() =>
        ratingSnapshot({ id: "a", clubId: "pprc", externalRating }),
      ).toThrow();
  });
  it("accepts inclusive combined boundaries and rejects above-maximum rosters", () => {
    const snapshots = ["a", "b", "c"].map((id) =>
      ratingSnapshot({ id, clubId: "pprc", externalRating: 4 }),
    );
    expect(validateTeamRating(snapshots, rules)).toBe(12);
    snapshots[2].reference = 10.5;
    expect(validateTeamRating(snapshots, rules)).toBe(18.5);
    snapshots[2].reference = 10.501;
    expect(() => validateTeamRating(snapshots, rules)).toThrow("outside");
  });
  it("requires three distinct roster references", () => {
    const s = ratingSnapshot({ id: "a", clubId: "pprc", externalRating: 5 });
    expect(() => validateTeamRating([s, s, s], rules)).toThrow("distinct");
  });
  it("validates an authorized three-player lineup", () =>
    expect(validateTeamLineup(team, lineup, rules)).toEqual(lineup));
  it("rejects a non-roster player", () =>
    expect(() =>
      validateTeamLineup(
        team,
        { ...lineup, singles: ["a", "outsider"] },
        rules,
      ),
    ).toThrow("unauthorized"));
  it("enforces configurable singles and doubles combinations", () => {
    expect(() =>
      validateTeamLineup(team, { ...lineup, singles: ["a", "a"] }, rules),
    ).toThrow("distinct");
    expect(() =>
      validateTeamLineup(
        team,
        {
          ...lineup,
          doubles: [{ players: ["a", "b"] }, { players: ["b", "a"] }],
        },
        rules,
      ),
    ).toThrow("distinct");
    expect(() =>
      validateTeamLineup(
        team,
        {
          ...lineup,
          doubles: [{ players: ["a", "a"] }, { players: ["b", "c"] }],
        },
        rules,
      ),
    ).toThrow("distinct");
  });
  it("supports a doubles deciding tiebreak only when configured", () => {
    expect(() =>
      validateTeamLineup(team, { ...lineup, tiebreak: ["a", "c"] }, rules),
    ).toThrow("tiebreak");
    expect(
      validateTeamLineup(
        team,
        { ...lineup, tiebreak: ["a", "c"] },
        { ...rules, tiebreakPlayers: 2 },
      ).tiebreak,
    ).toHaveLength(2);
  });
});
describe("TRIACE rubber scoring", () => {
  it("accepts a completed single-set rubber", () =>
    expect(
      validateRubberScore(
        { winner: "alpha", sets: [{ a: 6, b: 3 }] },
        rubber,
        rules,
      ).winner,
    ).toBe("alpha"));
  it("rejects a score that disagrees with its winner", () =>
    expect(() =>
      validateRubberScore(
        { winner: "beta", sets: [{ a: 6, b: 3 }] },
        rubber,
        rules,
      ),
    ).toThrow("agree"));
  it("requires the super tiebreak to reach ten and win by two", () => {
    for (const [a, b] of [
      [9, 7],
      [10, 9],
      [13, 10],
    ])
      expect(() =>
        validateRubberScore(
          { winner: "alpha", sets: [{ a, b }] },
          { ...rubber, kind: "tiebreak" },
          rules,
        ),
      ).toThrow("10");
    expect(
      validateRubberScore(
        { winner: "alpha", sets: [{ a: 12, b: 10 }] },
        { ...rubber, kind: "tiebreak" },
        rules,
      ).winner,
    ).toBe("alpha");
  });
  it("validates best-of-three and refuses extra sets", () => {
    expect(
      validateRubberScore(
        {
          winner: "alpha",
          sets: [
            { a: 6, b: 3 },
            { a: 4, b: 6 },
            { a: 7, b: 5 },
          ],
        },
        rubber,
        { ...rules, rubberScoring: "best-of-three" },
      ).winner,
    ).toBe("alpha");
    expect(() =>
      validateRubberScore(
        {
          winner: "alpha",
          sets: [
            { a: 6, b: 3 },
            { a: 6, b: 3 },
          ],
        },
        rubber,
        rules,
      ),
    ).toThrow("completion");
  });
  it("records forfeits without inventing sporting points", () => {
    expect(() =>
      validateRubberScore(
        { winner: "alpha", sets: [], outcome: "forfeit" },
        rubber,
        rules,
      ),
    ).toThrow("reason");
    expect(
      validateRubberScore(
        {
          winner: "alpha",
          sets: [],
          outcome: "forfeit",
          notes: "Opponent absent",
        },
        rubber,
        rules,
      ).sets,
    ).toEqual([]);
  });
});
describe("TRIACE qualification", () => {
  const encounters = [
    {
      id: "e1",
      clubId: "pprc",
      phase: "groups",
      status: "Final",
      teamA: "alpha",
      teamB: "beta",
      winner: "alpha",
      winsA: 3,
      winsB: 2,
    },
    {
      id: "e2",
      clubId: "pprc",
      phase: "groups",
      status: "Final",
      teamA: "gamma",
      teamB: "alpha",
      winner: "gamma",
      winsA: 3,
      winsB: 1,
    },
  ] as Entity[];
  const rubbers = [
    {
      id: "r1",
      clubId: "pprc",
      encounterId: "e1",
      kind: "singles",
      status: "Final",
      playersA: ["a"],
      playersB: ["z"],
      outcome: "played",
    },
  ] as Entity[];
  it("counts confirmed singles appearances against completed group encounters", () => {
    expect(
      singlesParticipation("a", "alpha", encounters, rubbers, rules),
    ).toMatchObject({
      appearances: 1,
      opportunities: 2,
      percent: 50,
      eligible: true,
    });
    expect(
      singlesParticipation("c", "alpha", encounters, rubbers, rules).eligible,
    ).toBe(false);
  });
  it("makes the alternative denominator configurable", () =>
    expect(
      singlesParticipation("a", "alpha", encounters, rubbers, {
        ...rules,
        participationBasis: "singles-opportunities",
      }),
    ).toMatchObject({ percent: 25, eligible: false }));
  it("does not count unconfirmed, playoff or forfeited rubbers by default", () => {
    expect(
      singlesParticipation(
        "a",
        "alpha",
        encounters,
        [
          ...rubbers.map((r) => ({ ...r, outcome: "forfeit" })),
          { ...rubbers[0], id: "r2", status: "Awaiting confirmation" },
        ],
        rules,
      ).appearances,
    ).toBe(0);
    expect(
      singlesParticipation(
        "a",
        "alpha",
        encounters,
        rubbers.map((r) => ({ ...r, outcome: "forfeit" })),
        { ...rules, forfeitCountsForParticipation: true },
      ).appearances,
    ).toBe(1);
  });
  it("never qualifies a player without completed group play", () =>
    expect(singlesParticipation("a", "alpha", [], [], rules).eligible).toBe(
      false,
    ));
  it("marks sporting ties and uses explicit resolutions", () => {
    const ties = teamStandings(["alpha", "beta"], []);
    expect(ties.every((r) => r.tied)).toBe(true);
    expect(
      teamStandings(["alpha", "beta"], [], { beta: 1, alpha: 2 })[0],
    ).toMatchObject({ teamId: "beta", tied: false });
  });
  it("orders wins then rubber difference", () => {
    const rows = teamStandings(["alpha", "beta", "gamma"], encounters);
    expect(rows.map((r) => r.teamId)).toEqual(["gamma", "alpha", "beta"]);
  });
});
