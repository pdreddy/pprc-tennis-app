import { test } from "node:test";
import assert from "node:assert/strict";
import { solveRatings, parseScore, winnerOf, expectedShare, impliedGap, MatchInput } from "./rating";

test("expectedShare and impliedGap are inverses", () => {
  for (const d of [-2, -0.5, 0, 0.7, 1.9]) {
    assert.ok(Math.abs(impliedGap(expectedShare(d)) - d) < 1e-9);
  }
});

test("parseScore handles match tiebreaks and tiebreak notation", () => {
  const s = parseScore("6-4 6-7(5) 10-8");
  assert.deepEqual(s.sets, [[6, 4], [6, 7], [10, 8]]);
  assert.equal(s.p1Games, 13);
  assert.equal(s.p2Games, 11);
  assert.equal(winnerOf(s.sets), 1);
  assert.throws(() => parseScore("six-four"));
});

test("solver recovers hidden skill ordering from simulated matches", () => {
  const truth = new Map<number, number>();
  for (let i = 1; i <= 40; i++) truth.set(i, 3 + (i % 20) * 0.5);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const matches: MatchInput[] = [];
  const now = new Date("2026-10-01");
  for (let k = 0; k < 600; k++) {
    const a = 1 + Math.floor(rand() * 40);
    let b = 1 + Math.floor(rand() * 40);
    if (a === b) b = (b % 40) + 1;
    if (Math.abs(truth.get(a)! - truth.get(b)!) > 3) continue;
    const pa = expectedShare(truth.get(a)! - truth.get(b)!);
    let ga = 0;
    let gb = 0;
    for (let g = 0; g < 20; g++) (rand() < pa ? ga++ : gb++);
    const day = new Date(now.getTime() - rand() * 200 * 86_400_000).toISOString().slice(0, 10);
    matches.push({ id: k, playedOn: day, p1: a, p2: b, p1Games: ga, p2Games: gb, format: "best_of_3" });
  }
  const seeds = new Map([...truth.keys()].map((p) => [p, 6]));
  const { ratings } = solveRatings(matches, seeds, now);
  const strong = ratings.get(20)!.rating; // truth 3 + 0*0.5? (20 % 20 = 0) → 3.0
  const top = ratings.get(19)!.rating; // truth 12.0
  assert.ok(top > strong + 4, `expected 19 (${top}) well above 20 (${strong})`);
  // Spread between best and worst truth should be largely preserved.
  const r = [...ratings.values()].map((x) => x.rating);
  assert.ok(Math.max(...r) - Math.min(...r) > 6);
});

import { parseAnalysis } from "./ai";

test("parseAnalysis tolerates fenced JSON and clamps grades", () => {
  const a = parseAnalysis('Here you go:\n```json\n{"summary":"ok","shots":[{"shot":"Serve","grade":9,"observations":"x"}],"patterns":["a"],"moments":[{"time":"0:10","note":"n"}],"drills":[]}\n```');
  assert.equal(a.shots[0].grade, 5);
  assert.equal(a.moments[0].time, "0:10");
  assert.throws(() => parseAnalysis("no json here"));
});
