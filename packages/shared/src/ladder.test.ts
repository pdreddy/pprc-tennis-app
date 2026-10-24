import { describe, it, expect } from "vitest";
import {
  defaultLadderRules as rules,
  ladderRulesSchema,
  ladderWeekClose,
  ladderWeek,
  nextLadderMonday,
  ladderCalendar,
  replayLadder,
  pointsChampionCandidates,
  validateLadderChallenge,
  type LadderAction,
  type LadderMatch,
} from "./index";
const order = ["a", "b", "c", "d", "e", "f"];
const action = (
  sequence: number,
  kind: LadderAction["kind"],
  fields: any = {},
): LadderAction => ({
  id: `action-${sequence}`,
  clubId: "pprc",
  sequence,
  kind,
  ...fields,
});
const match = (
  id: string,
  winner = "d",
  changes: Partial<LadderMatch> = {},
): LadderMatch => ({
  id,
  winner,
  teamA: "d",
  teamB: "a",
  challengerId: "d",
  defenderId: "a",
  wasUpward: true,
  outcome: "played",
  confirmed: true,
  reportedWeek: 1,
  reportedAt: Date.parse("2026-10-20T12:00:00Z"),
  walkoverMovementApproved: false,
  ...changes,
});
const history = [
  action(1, "result", { rubberId: "one" }),
  action(2, "result", { rubberId: "two" }),
];
const two = [
  match("one"),
  match("two", "d", {
    teamA: "b",
    teamB: "d",
    challengerId: "b",
    defenderId: "d",
  }),
];
const standing = (rows: ReturnType<typeof replayLadder>, id: string) =>
  rows.find((r) => r.teamId === id)!;
const start = "2026-10-19T00:00:00Z",
  freezeAt = Date.parse("2026-12-13T23:59:59.999Z");
const challenge = (changes: any = {}) =>
  validateLadderChallenge({
    challengerId: "d",
    defenderId: "a",
    standings: replayLadder(order, [], [], rules),
    active: [],
    matches: [],
    rules,
    now: Date.parse("2026-10-20T12:00:00Z"),
    start,
    freezeAt,
    timezone: "UTC",
    ...changes,
  });
describe("authorized PPRC ladder policy and deterministic result replay", () => {
  it("keeps the supplied points, deadlines, fixed-pair choice and playoffs-off defaults explicit", () => {
    expect(rules).toMatchObject({
      winPoints: 3,
      lossPoints: 1,
      walkoverPoints: 3,
      streakBonus: 1,
      upsetBonus: 1,
      challengeBonus: 1,
      defenseBonus: 1,
      responseHours: 48,
      completionDays: 5,
      normalReach: 3,
      streakReach: 5,
      rematchDays: 14,
      maximumMeetings: 2,
      earlyWeeks: 4,
      earlyMaximumMeetings: 1,
      playoffQualifiers: 0,
    });
  });
  it("rejects inconsistent or browser-invented policy properties", () => {
    for (const input of [
      { normalReach: 5, streakReach: 3 },
      { maximumMeetings: 1, earlyMaximumMeetings: 2 },
      { requireReferences: false, requireVerified: true },
      { calculatedUtr: 99 },
    ])
      expect(() => ladderRulesSchema.parse(input)).toThrow();
  });
  it("closes Sunday 11:59 PM in Chicago across daylight-saving changes", () => {
    const localStart = "2026-10-19T05:00:00Z";
    expect(
      new Date(ladderWeekClose(localStart, "America/Chicago", 1)).toISOString(),
    ).toBe("2026-10-26T04:59:59.999Z");
    expect(
      new Date(ladderWeekClose(localStart, "America/Chicago", 2)).toISOString(),
    ).toBe("2026-11-02T05:59:59.999Z");
    expect(
      ladderCalendar(localStart, "2026-11-02T05:59:00Z", "America/Chicago")
        .weeks,
    ).toBe(2);
  });
  it("validates Monday/Sunday boundaries and computes the next local Monday", () => {
    expect(() =>
      ladderCalendar("2026-10-20T00:00:00Z", "2026-11-01T23:59:00Z", "UTC"),
    ).toThrow("Monday");
    expect(() => ladderCalendar(start, "2026-11-02T23:59:00Z", "UTC")).toThrow(
      "Sunday",
    );
    expect(
      new Date(
        nextLadderMonday(Date.parse("2026-10-24T18:00:00Z"), "America/Chicago"),
      ).toISOString(),
    ).toBe("2026-10-26T05:00:00.000Z");
    expect(ladderWeek(Date.parse("2026-10-26T00:00:00Z"), start, "UTC")).toBe(
      2,
    );
  });
  it("awards win, upset and upward challenge points and performs a full position swap", () => {
    const rows = replayLadder(order, [history[0]], [two[0]], rules);
    expect(standing(rows, "d")).toMatchObject({
      points: 5,
      wins: 1,
      streak: 1,
      upwardWins: 1,
      position: 1,
    });
    expect(standing(rows, "a")).toMatchObject({
      points: 1,
      losses: 1,
      position: 4,
    });
    expect(rows.map((r) => r.teamId)).toEqual(["d", "b", "c", "a", "e", "f"]);
  });
  it("awards a second-win streak and successful-defense bonus without moving a higher-ranked winner", () => {
    const rows = replayLadder(order, history, two, rules);
    expect(standing(rows, "d")).toMatchObject({
      points: 10,
      wins: 2,
      streak: 2,
      defenses: 1,
      position: 1,
    });
  });
  it("breaks a played losing streak only on a confirmed completed loss", () => {
    const rows = replayLadder(
      order,
      [...history, action(3, "result", { rubberId: "three" })],
      [
        ...two,
        match("three", "b", {
          teamA: "b",
          teamB: "d",
          challengerId: "b",
          defenderId: "d",
        }),
      ],
      rules,
    );
    expect(standing(rows, "d")).toMatchObject({
      streak: 0,
      losses: 1,
      points: 11,
    });
  });
  it("preserves streaks and gives zero for unconfirmed or no-contest results", () => {
    for (const extra of [
      match("three", "a", { confirmed: false }),
      match("three", "a", { outcome: "no-contest" }),
      match("three", "a", { outcome: "retirement" }),
    ]) {
      const rows = replayLadder(
        order,
        [...history, action(3, "result", { rubberId: "three" })],
        [...two, extra],
        rules,
      );
      expect(standing(rows, "d")).toMatchObject({
        points: 10,
        streak: 2,
        wins: 2,
      });
    }
  });
  it("awards exactly three walkover points with no bonus, loss point or streak reset", () => {
    const rows = replayLadder(
      order,
      [...history, action(3, "result", { rubberId: "walk" })],
      [...two, match("walk", "a", { outcome: "walkover" })],
      rules,
    );
    expect(standing(rows, "a").points).toBe(4);
    expect(standing(rows, "d")).toMatchObject({
      points: 10,
      streak: 2,
      noShows: 1,
      position: 1,
    });
  });
  it("moves a walkover winner only with the organizer's recorded movement approval", () => {
    const unapproved = replayLadder(
        order,
        [history[0]],
        [match("one", "d", { outcome: "walkover" })],
        rules,
      ),
      approved = replayLadder(
        order,
        [history[0]],
        [
          match("one", "d", {
            outcome: "walkover",
            walkoverMovementApproved: true,
          }),
        ],
        rules,
      );
    expect(standing(unapproved, "d").position).toBe(4);
    expect(standing(approved, "d")).toMatchObject({
      position: 1,
      points: 3,
      streak: 0,
      upwardWins: 0,
    });
  });
  it("applies a free first decline, later deductions and a three-position strike drop with reset", () => {
    const actions = [1, 2, 3].map((n) => action(n, "decline", { teamId: "b" })),
      rows = replayLadder(order, actions, [], rules);
    expect(standing(rows, "b")).toMatchObject({
      points: -4,
      declines: 3,
      strikes: 0,
      position: 5,
    });
  });
  it("replays a waived decline without erasing the original action or retaining its position penalty", () => {
    const original = [1, 2, 3].map((n) =>
      action(n, "decline", { teamId: "b" }),
    );
    const rows = replayLadder(
      order,
      [
        ...original,
        action(4, "waive-decline", { targetId: "action-3", teamId: "b" }),
      ],
      [],
      rules,
    );
    expect(standing(rows, "b")).toMatchObject({
      points: -2,
      declines: 2,
      strikes: 1,
      position: 2,
    });
    expect(original).toHaveLength(3);
  });
  it("can waive a strike while retaining the decline's points deduction", () => {
    const actions = [1, 2, 3].map((n) => action(n, "decline", { teamId: "b" }));
    const rows = replayLadder(
      order,
      [
        ...actions,
        action(4, "waive-strike", { targetId: "action-3", teamId: "b" }),
      ],
      [],
      rules,
    );
    expect(standing(rows, "b")).toMatchObject({
      points: -4,
      strikes: 1,
      position: 2,
    });
  });
  it("drops an inactive entrant after two closed weeks while confirmed played matches reset activity", () => {
    const acts = [
      action(1, "week-close", { week: 1 }),
      action(2, "result", { rubberId: "b-c" }),
      action(3, "result", { rubberId: "d-b" }),
      action(4, "week-close", { week: 2 }),
    ];
    const games = [
      match("b-c", "b", {
        teamA: "b",
        teamB: "c",
        challengerId: "c",
        defenderId: "b",
        reportedWeek: 2,
      }),
      match("d-b", "d", {
        teamA: "d",
        teamB: "b",
        challengerId: "d",
        defenderId: "b",
        reportedWeek: 2,
      }),
    ];
    const rows = replayLadder(["a", "b", "c", "d"], acts, games, rules);
    expect(standing(rows, "a")).toMatchObject({
      position: 4,
      played: 0,
      lastInactivityWeek: 2,
    });
    expect(standing(rows, "b").lastPlayedWeek).toBe(2);
    const exempt = replayLadder(
      ["a", "b", "c", "d"],
      [
        ...acts,
        action(5, "exemption", { teamId: "a", fromWeek: 1, throughWeek: 2 }),
      ],
      games,
      rules,
    );
    expect(standing(exempt, "a")).toMatchObject({ position: 1, played: 0 });
  });
  it("preserves relative order when simultaneous inactivity penalties affect everyone", () => {
    const rows = replayLadder(
      order,
      [action(1, "week-close", { week: 2 })],
      [],
      rules,
    );
    expect(rows.map((s) => s.teamId)).toEqual(order);
    expect(rows.every((s) => s.lastInactivityWeek === 2)).toBe(true);
  });
  it("recomputes a corrected winner once at the original report sequence", () => {
    const rows = replayLadder(order, [history[0]], [match("one", "a")], rules);
    expect(standing(rows, "a")).toMatchObject({
      position: 1,
      wins: 1,
      points: 4,
    });
    expect(standing(rows, "d")).toMatchObject({
      position: 4,
      wins: 0,
      points: 1,
    });
    expect(rows.reduce((n, s) => n + s.wins, 0)).toBe(1);
  });
  it("rejects duplicate entrants, sequences and result actions", () => {
    expect(() => replayLadder(["a", "a"], [], [], rules)).toThrow("duplicate");
    expect(() =>
      replayLadder(order, [history[0], history[0]], two, rules),
    ).toThrow("sequence");
    expect(() =>
      replayLadder(
        order,
        [history[0], action(2, "result", { rubberId: "one" })],
        two,
        rules,
      ),
    ).toThrow("result");
  });
  it("resolves points candidates by wins, upward wins and head-to-head, leaving true ties to an organizer", () => {
    const rows = replayLadder(["a", "b"], [], [], rules).map((s) => ({
      ...s,
      points: 5,
      wins: 1,
    }));
    expect(
      pointsChampionCandidates(
        rows,
        [
          match("one", "a", {
            teamA: "a",
            teamB: "b",
            challengerId: "b",
            defenderId: "a",
          }),
        ],
        rules,
      ),
    ).toEqual(["a"]);
    expect(
      pointsChampionCandidates(
        rows.map((s) => ({ ...s, upwardWins: s.teamId === "b" ? 1 : 0 })),
        [],
        rules,
      ),
    ).toEqual(["b"]);
    expect(pointsChampionCandidates(rows, [], rules)).toEqual(["a", "b"]);
  });
  it("enforces normal and expanded upward challenge reach", () => {
    expect(challenge().wasUpward).toBe(true);
    expect(() => challenge({ challengerId: "f" })).toThrow("range");
    const standings = replayLadder(order, [], [], rules).map((s) => ({
      ...s,
      streak: s.teamId === "f" ? 2 : 0,
    }));
    expect(challenge({ challengerId: "f", standings }).wasUpward).toBe(true);
  });
  it("allows downward challenges only from the top three within three positions", () => {
    expect(challenge({ challengerId: "a", defenderId: "d" }).wasUpward).toBe(
      false,
    );
    expect(() => challenge({ challengerId: "d", defenderId: "e" })).toThrow(
      "range",
    );
    expect(() => challenge({ challengerId: "a", defenderId: "e" })).toThrow(
      "range",
    );
  });
  it("enforces one active challenge for either entrant", () => {
    for (const teamIds of [
      ["d", "e"],
      ["a", "e"],
    ])
      expect(() =>
        challenge({ active: [{ teamIds, state: "Pending" }] }),
      ).toThrow("active");
  });
  it("enforces early-season, season-total and fourteen-day rematch limits", () => {
    const now = Date.parse(start) + 32 * 86400000,
      previous = match("one", "d", { reportedAt: now - 15 * 86400000 });
    expect(challenge({ now, matches: [previous] }).wasUpward).toBe(true);
    expect(() =>
      challenge({
        now: Date.parse(start) + 20 * 86400000,
        matches: [{ ...previous, reportedAt: Date.parse(start) }],
      }),
    ).toThrow("limit");
    expect(() =>
      challenge({ now, matches: [previous, { ...previous, id: "two" }] }),
    ).toThrow("limit");
    expect(() =>
      challenge({
        now,
        matches: [{ ...previous, reportedAt: now - 5 * 86400000 }],
      }),
    ).toThrow("14 days");
  });
  it("preserves the full response and five-day completion windows before final freeze", () => {
    expect(challenge({ now: freezeAt - 7 * 86400000 }).responseDeadline).toBe(
      new Date(freezeAt - 5 * 86400000).toISOString(),
    );
    expect(() => challenge({ now: freezeAt - 7 * 86400000 + 1 })).toThrow(
      "closed",
    );
  });
  it("counts retirement as played only when the organizer explicitly chooses that policy", () => {
    const rows = replayLadder(
      order,
      [history[0]],
      [match("one", "d", { outcome: "retirement" })],
      { ...rules, retirementTreatment: "played" },
    );
    expect(standing(rows, "d")).toMatchObject({
      wins: 1,
      played: 1,
      points: 5,
    });
  });
});
