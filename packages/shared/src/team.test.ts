import { describe, it, expect } from "vitest";
import {
  validateTeam, validateLineup, teamMatchResult, singlesParticipation, teamStandings, effectiveRating, TRIACE_2,
} from "./team";
const p = (id: string, s?: number, d?: number) => ({ id, singles: s, doubles: d });
describe("TRIACE 2.0", () => {
  it("uses the higher of singles and doubles", () => {
    expect(effectiveRating(p("a", 5, 6.2))).toBe(6.2);
  });
  it("accepts a team within 12–18.5", () => {
    const r = validateTeam([p("a", 5), p("b", 4.5, 5), p("c", 3, 3.5)]);
    expect(r.total).toBe(13.5);
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBe(1);
  });
  it("rejects too low, too high, wrong size and unrated", () => {
    expect(validateTeam([p("a", 3), p("b", 3), p("c", 3)]).valid).toBe(false);
    expect(validateTeam([p("a", 7), p("b", 6), p("c", 6)]).errors.join()).toMatch(/exceeds/);
    expect(validateTeam([p("a", 5), p("b", 5)]).valid).toBe(false);
    expect(validateTeam([p("a"), p("b", 5), p("c", 8)]).errors.join()).toMatch(/no rating/);
  });
  it("max is configurable", () => {
    const rules = { ...TRIACE_2, maxCombinedRating: 20, maxCombinedConfirmed: true };
    const r = validateTeam([p("a", 7), p("b", 6), p("c", 6)], rules);
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it("validates lineups", () => {
    const roster = ["a", "b", "c"];
    expect(validateLineup({ singles: ["a", "b"], doubles: [["a", "c"], ["b", "c"]] }, roster).valid).toBe(true);
    expect(validateLineup({ singles: ["a", "a"], doubles: [["a", "c"], ["b", "c"]] }, roster).valid).toBe(false);
    expect(validateLineup({ singles: ["a", "b"], doubles: [["a", "c"], ["c", "a"]] }, roster).errors.join()).toMatch(/same doubles pair/);
    expect(validateLineup({ singles: ["a", "z"], doubles: [["a", "c"], ["b", "c"]] }, roster).valid).toBe(false);
  });
  it("first to three rubbers wins", () => {
    const r = (w: ("home" | "away")[]) =>
      teamMatchResult(w.map((x, i) => ({ kind: i < 2 ? "singles" : i < 4 ? "doubles" : "decider", winner: x }) as any));
    expect(r(["home", "home", "away", "home"])).toMatchObject({ winner: "home", home: 3, deciderNeeded: false });
    expect(r(["home", "away", "home", "away"])).toMatchObject({ winner: undefined, deciderNeeded: true });
    expect(r(["home", "away", "home", "away", "away"])).toMatchObject({ winner: "away" });
    expect(teamMatchResult([{ kind: "singles", winner: "home" }]).deciderNeeded).toBe(false);
  });
  it("enforces 40% singles participation", () => {
    const m = [
      { teamId: "t", singlesPlayers: ["a", "b"] },
      { teamId: "t", singlesPlayers: ["a", "b"] },
      { teamId: "t", singlesPlayers: ["a", "c"] },
    ];
    const rows = singlesParticipation(["a", "b", "c"], m);
    expect(rows.find((x) => x.id === "a")!.eligible).toBe(true);
    expect(rows.find((x) => x.id === "b")!.share).toBeCloseTo(1 / 3);
    expect(rows.find((x) => x.id === "b")!.eligible).toBe(false);
    expect(rows.find((x) => x.id === "c")!.eligible).toBe(false);
  });
  it("ranks teams by wins then rubber difference", () => {
    const s = teamStandings([
      { home: "A", away: "B", homeRubbers: 3, awayRubbers: 1 },
      { home: "B", away: "C", homeRubbers: 3, awayRubbers: 0 },
      { home: "C", away: "A", homeRubbers: 3, awayRubbers: 2 },
    ]);
    expect(s[0].wins).toBe(1);
    expect(s.map((x) => x.teamId)).toEqual(["A", "B", "C"]) // A and B level on wins and +1 rubber diff; ID breaks the tie;
  });
});
