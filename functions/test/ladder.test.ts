import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import * as clockSource from "../src/clock";
import {
  defaultLadderRules,
  ladderWeekClose,
  type LadderRules,
} from "@pprc/shared";
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
let env: RulesTestEnvironment;
const admin = "ladder-admin",
  organizer = "ladder-organizer",
  other = "ladder-other",
  support = "ladder-support",
  p = (n: number) => `ladder-player${n}`;
const req = (d: any = {}) => ({ requestId: randomUUID(), ...d }),
  realNow = Date.now.bind(Date);
let clock = Date.parse("2026-10-01T12:00:00Z");
const profile = {
  displayName: "Ladder player",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Club",
  externalRating: 4,
  singlesUtr: 4,
  doublesUtr: 4.5,
  handedness: "Right",
  availability: "Weekends",
  emergencyContact: "Synthetic private contact",
  visibility: "private",
  notificationPreferences: { inApp: true, push: false },
};
type F = {
  id: string;
  teams: any[];
  rules: LadderRules;
  start: string;
  end: string;
};
const load = async (c: string, id: string) =>
  ({ id, ...(await db.doc(`${c}/${id}`).get()).data() }) as any;
const rows = async (f: F, c: string) =>
  (await db.collection(c).where("eventId", "==", f.id).get()).docs.map(
    (d) => ({ id: d.id, ...d.data() }) as any,
  );
const act = (f: F, uid: string, action: string, data: any = {}) =>
  execute("ladder", uid, req({ eventId: f.id, action, ...data }));
const teamAct = (f: F, uid: string, action: string, data: any = {}) =>
  execute("teamCompetition", uid, req({ eventId: f.id, action, ...data }));
const meta = async (f: F) => (await load("events", f.id)).ladderState;
async function create(
  count = 6,
  changes: Partial<LadderRules> = {},
): Promise<F> {
  clock = Date.parse("2026-10-01T12:00:00Z");
  const start = "2026-10-05T00:00:00Z",
    end = "2026-11-29T23:59:59.999Z",
    rules = { ...defaultLadderRules, policyConfirmed: true, ...changes };
  const result = await execute(
    "createEvent",
    admin,
    req({
      event: {
        name: `Synthetic ladder ${randomUUID().slice(0, 6)}`,
        description: "Real emulator season",
        competition: "ladder",
        ladderRules: rules,
        venue: "PPRC",
        location: "Prosper",
        timezone: "UTC",
        startDate: start,
        endDate: end,
        visibility: "private",
        fee: 0,
        capacity: count,
        waitlist: true,
        registrationOpen: "2026-09-30T00:00:00Z",
        registrationClose: "2026-10-04T23:00:00Z",
        waiverRequired: true,
        refundPolicy: "Synthetic",
        organizer: "PPRC",
        assignedAdmins: [organizer],
        courtIds: [],
        duration: 60,
        buffer: 0,
      },
      divisions: [
        {
          name: "Ladder entries",
          format: "single-elimination",
          capacity: count,
        },
      ],
    }),
  );
  const f: F = { id: result.eventId, teams: [], rules, start, end };
  await execute("publishEvent", admin, req({ eventId: f.id }));
  const size = rules.entryKind === "doubles" ? 2 : 1;
  for (let n = 0; n < count; n++) {
    const captain = p(n * size),
      made = await teamAct(f, captain, "createTeam", {
        name: `Entrant ${n + 1}`,
        waiver: true,
      });
    if (size === 2) {
      const invitation = await teamAct(f, captain, "invitePlayer", {
        teamId: made.teamId,
        playerId: p(n * size + 1),
        slot: "P2",
      });
      await expect(
        teamAct(f, captain, "registerTeam", {
          teamId: made.teamId,
          divisionId: `${f.id}-d1`,
        }),
      ).rejects.toThrow("confirmed");
      await teamAct(f, p(n * size + 1), "respondInvitation", {
        invitationId: invitation.invitationId,
        accepted: true,
        waiver: true,
      });
    }
    await teamAct(f, captain, "registerTeam", {
      teamId: made.teamId,
      divisionId: `${f.id}-d1`,
      combinedReference: 99,
      ratingSnapshots: [],
    });
    await teamAct(f, organizer, "approveTeam", {
      teamId: made.teamId,
      seed: n + 1,
      reason: "Organizer seeded synthetic season",
    });
    f.teams.push(await load("teams", made.teamId));
  }
  clock = Date.parse("2026-10-05T12:00:00Z");
  await act(f, organizer, "start");
  return f;
}
async function challenge(f: F, a: number, b: number) {
  return act(f, f.teams[a].captainId, "challenge", {
    teamId: f.teams[a].id,
    opponentId: f.teams[b].id,
  });
}
async function accept(f: F, id: string) {
  const ch = await load("ladderChallenges", id);
  return act(f, (await load("teams", ch.defenderId)).captainId, "respond", {
    challengeId: id,
    accepted: true,
  });
}
async function score(
  f: F,
  challengeId: string,
  winner: string,
  confirm = true,
) {
  const ch = await load("ladderChallenges", challengeId),
    r = (await rows(f, "rubbers")).find(
      (r) => r.encounterId === ch.encounterId,
    ),
    a = await load("teams", r.teamA),
    b = await load("teams", r.teamB),
    set = winner === r.teamA ? { a: 6, b: 3 } : { a: 3, b: 6 };
  const submitted = await teamAct(f, a.captainId, "submitRubberScore", {
    rubberId: r.id,
    baseVersion: r.version,
    score: { winner, sets: [set, set], outcome: "played" },
  });
  if (confirm)
    await teamAct(f, b.captainId, "confirmRubberScore", {
      resultId: submitted.resultId,
    });
  return { r, a, b, resultId: submitted.resultId };
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Real synthetic Firebase emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  env = await initializeTestEnvironment({
    projectId: "demo-pprc-events",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
  for (const uid of [
    admin,
    organizer,
    other,
    support,
    ...Array.from({ length: 16 }, (_, n) => p(n)),
  ]) {
    await execute(
      "saveProfile",
      uid,
      req({ profile: { ...profile, displayName: uid } }),
    );
    await db.doc(`memberships/${uid}`).set({
      clubId: "pprc",
      role:
        uid === admin
          ? "clubAdmin"
          : [organizer, other].includes(uid)
            ? "eventAdmin"
            : uid === support
              ? "platformAdmin"
              : "player",
      member: true,
    });
  }
  vi.spyOn(clockSource, "serverNow").mockImplementation(() => clock);
}, 60000);
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});
let f: F, first: any, submitted: any;
describe.sequential(
  "real Firestore ladder lifecycle, authorization and deadline processing",
  { timeout: 30000 },
  () => {
    it("requires callable authentication and starts only approved, server-seeded entrants", async () => {
      const res = await fetch(
        "http://127.0.0.1:5001/demo-pprc-events/us-central1/ladder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: {} }),
        },
      );
      expect(res.status).toBe(401);
      f = await create();
      expect((await meta(f)).initialOrder).toEqual(f.teams.map((t) => t.id));
      expect((await meta(f)).standings.map((s: any) => s.points)).toEqual([
        0, 0, 0, 0, 0, 0,
      ]);
      expect(f.teams[0].combinedReference).toBe(4);
      await expect(act(f, organizer, "start")).rejects.toThrow("already");
      await expect(
        execute(
          "cancelRegistration",
          p(0),
          req({
            eventId: f.id,
            registrationId: f.teams[0].registrationId,
            reason: "Attempt to bypass locked season roster",
          }),
        ),
      ).rejects.toThrow("locked");
      await assertFails(
        setDoc(
          doc(
            env.authenticatedContext(p(0)).firestore(),
            "ladderLedger",
            "forged-action",
          ),
          { eventId: f.id, kind: "result", sequence: 1 },
        ),
      );
    });
    it("denies role, rating, rank and clock payload spoofing and wrong-team challenge management", async () => {
      for (const uid of [other, support, p(0)])
        await expect(
          act(f, uid, "reopen", { reason: "Unauthorized season action" }),
        ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        act(f, p(0), "challenge", {
          teamId: f.teams[3].id,
          opponentId: f.teams[0].id,
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        act(f, p(3), "challenge", {
          teamId: f.teams[3].id,
          opponentId: f.teams[0].id,
          now: realNow(),
          points: 500,
          role: "clubAdmin",
        }),
      ).rejects.toThrow();
      await assertFails(
        setDoc(
          doc(env.authenticatedContext(p(0)).firestore(), "events", f.id),
          { ladderState: { standings: [] } },
        ),
      );
    });
    it("serializes overlapping challenges and keeps pending invitations private", async () => {
      const outcomes = await Promise.allSettled([
        challenge(f, 3, 0),
        challenge(f, 4, 1),
      ]);
      expect(
        outcomes.every((r) => r.status === "fulfilled"),
        outcomes
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason?.stack ?? String(r.reason))
          .join("\n"),
      ).toBe(true);
      first = (outcomes[0] as PromiseFulfilledResult<any>).value;
      const overlapping = await Promise.allSettled([
        challenge(f, 5, 3),
        challenge(f, 2, 0),
      ]);
      expect(overlapping.every((r) => r.status === "rejected")).toBe(true);
      await assertFails(
        getDoc(
          doc(
            env.authenticatedContext(p(2)).firestore(),
            "ladderChallenges",
            first.challengeId,
          ),
        ),
      );
      await expect(
        act(f, p(3), "respond", {
          challengeId: first.challengeId,
          accepted: true,
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
    });
    it("accepts a valid challenge, negotiates a time and persists fixed authorized players", async () => {
      await accept(f, first.challengeId);
      const ch = await load("ladderChallenges", first.challengeId);
      expect(Date.parse(ch.completionDeadline) - clock).toBe(5 * 86400000);
      await act(f, p(3), "proposeSchedule", {
        challengeId: ch.id,
        teamId: f.teams[3].id,
        scheduledAt: new Date(clock + 86400000).toISOString(),
        location: "Synthetic shared tennis courts",
      });
      await expect(
        act(f, p(3), "confirmSchedule", {
          challengeId: ch.id,
          teamId: f.teams[3].id,
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await act(f, p(0), "confirmSchedule", {
        challengeId: ch.id,
        teamId: f.teams[0].id,
      });
      const rubber = (await rows(f, "rubbers")).find(
        (r) => r.encounterId === ch.encounterId,
      );
      expect(rubber.playersA).toEqual([p(3)]);
      expect((await load("teamEncounters", ch.encounterId)).location).toContain(
        "Synthetic",
      );
    });
    it("reserves a result sequence without points until opposing verification, then swaps positions exactly once", async () => {
      submitted = await score(f, first.challengeId, f.teams[3].id, false);
      expect(
        (await meta(f)).standings.find((s: any) => s.teamId === f.teams[3].id)
          .points,
      ).toBe(0);
      await expect(
        teamAct(f, submitted.a.captainId, "confirmRubberScore", {
          resultId: submitted.resultId,
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      const outcomes = await Promise.allSettled([
        teamAct(f, submitted.b.captainId, "confirmRubberScore", {
          resultId: submitted.resultId,
        }),
        teamAct(f, submitted.b.captainId, "confirmRubberScore", {
          resultId: submitted.resultId,
        }),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const standings = (await meta(f)).standings;
      expect(
        standings.find((s: any) => s.teamId === f.teams[3].id),
      ).toMatchObject({ position: 1, points: 5, wins: 1 });
      expect(
        (await rows(f, "ladderLedger")).filter(
          (a) => a.kind === "result" && a.rubberId === submitted.r.id,
        ),
      ).toHaveLength(1);
    });
    it("preserves disputed result history and replays corrected rankings and bonuses without awarding twice", async () => {
      const d = await teamAct(f, p(3), "disputeRubber", {
        resultId: submitted.resultId,
        reason: "Correct synthetic winner after both players reviewed",
      });
      await teamAct(f, organizer, "resolveDispute", {
        disputeId: d.disputeId,
        resolution: "correct",
        score: {
          winner: f.teams[0].id,
          sets: [
            { a: 3, b: 6 },
            { a: 3, b: 6 },
          ],
          outcome: "played",
        },
        reason: "Agreed authoritative result correction",
      });
      expect((await load("rubberResults", submitted.resultId)).state).toBe(
        "Superseded",
      );
      const state = await meta(f);
      expect(state.standings[0]).toMatchObject({
        teamId: f.teams[0].id,
        points: 4,
        wins: 1,
      });
      expect(
        state.standings.find((s: any) => s.teamId === f.teams[3].id),
      ).toMatchObject({ points: 1, wins: 0, position: 4 });
    });
    it("deduplicates response expiry and applies first-decline and later-strike policy through actual maintenance transactions", async () => {
      clock += 49 * 3600000;
      await execute(
        "ladder",
        "system",
        req({ eventId: f.id, action: "tick" }),
        true,
      );
      await act(f, organizer, "tick");
      let state = await meta(f);
      expect(
        state.standings.find((s: any) => s.teamId === f.teams[1].id),
      ).toMatchObject({ declines: 1, points: 0, strikes: 0 });
      for (let n = 0; n < 2; n++) {
        const c = await challenge(f, 4, 1);
        await act(f, p(1), "respond", {
          challengeId: c.challengeId,
          accepted: false,
        });
      }
      state = await meta(f);
      expect(
        state.standings.find((s: any) => s.teamId === f.teams[1].id),
      ).toMatchObject({ declines: 3, points: -4, strikes: 0, position: 5 });
      const target = (await rows(f, "ladderLedger"))
        .filter((a) => a.kind === "decline" && a.teamId === f.teams[1].id)
        .sort((a, b) => a.sequence - b.sequence)[2];
      await act(f, organizer, "waiveDecline", {
        ledgerId: target.id,
        teamId: f.teams[1].id,
        reason: "Valid synthetic injury exemption",
      });
      expect(
        (await meta(f)).standings.find((s: any) => s.teamId === f.teams[1].id),
      ).toMatchObject({ points: -2, strikes: 1, position: 2 });
    });
    it("expires unplayed accepted challenges without points and requires explicit verification for a no-show", async () => {
      const ch = await challenge(f, 2, 1);
      await accept(f, ch.challengeId);
      clock += 6 * 86400000;
      await act(f, organizer, "tick");
      expect((await load("ladderChallenges", ch.challengeId)).state).toBe(
        "Expired",
      );
      const e = await load(
        "teamEncounters",
        (await load("ladderChallenges", ch.challengeId)).encounterId,
      );
      await teamAct(f, organizer, "forfeitEncounter", {
        encounterId: e.id,
        winner: e.teamA,
        reason: "Verified synthetic opponent did not appear",
      });
      const before = (await meta(f)).standings.find(
        (s: any) => s.teamId === e.teamA,
      );
      expect(before.points).toBe(3);
      expect(before.walkovers).toBe(1);
      await act(f, organizer, "walkoverMovement", {
        challengeId: ch.challengeId,
        approved: true,
        reason: "Accepted valid challenge and verified no-show",
      });
      expect(
        (await meta(f)).standings.find((s: any) => s.teamId === e.teamA).points,
      ).toBe(3);
    });
    it("processes real weekly inactivity actions once and replays an organizer exemption", async () => {
      clock = ladderWeekClose(f.start, "UTC", 3) + 1;
      await act(f, organizer, "tick");
      const count = (await rows(f, "ladderLedger")).filter(
        (a) => a.kind === "week-close",
      ).length;
      await act(f, organizer, "tick");
      expect(
        (await rows(f, "ladderLedger")).filter((a) => a.kind === "week-close"),
      ).toHaveLength(count);
      await act(f, organizer, "exemption", {
        teamId: f.teams[5].id,
        fromWeek: 1,
        throughWeek: 4,
        reason: "Valid synthetic travel exemption",
      });
      expect(
        (await rows(f, "ladderLedger")).some(
          (a) => a.kind === "exemption" && a.teamId === f.teams[5].id,
        ),
      ).toBe(true);
    });
    it("enforces early-season/rematch limits and the final acceptance cutoff without browser clock control", async () => {
      const repeat = await create(2);
      const earlier = await challenge(repeat, 1, 0);
      await accept(repeat, earlier.challengeId);
      await score(repeat, earlier.challengeId, repeat.teams[1].id);
      clock += 16 * 86400000;
      await expect(challenge(repeat, 0, 1)).rejects.toThrow("limit");
      clock = Date.parse(f.end) - 6 * 86400000;
      await expect(challenge(f, 3, 0)).rejects.toThrow("closed");
    });
    it("freezes champions once, defaults playoffs off and requires audited reopening for season corrections", async () => {
      clock = Date.parse(f.end) + 1;
      await Promise.all([act(f, organizer, "tick"), act(f, organizer, "tick")]);
      const state = await meta(f);
      expect(state.frozen).toBe(true);
      expect(state.ladderChampionTeamId).toBe(state.standings[0].teamId);
      expect(
        (await rows(f, "ladderLedger")).filter((a) => a.kind === "close"),
      ).toHaveLength(1);
      await expect(act(f, organizer, "generatePlayoffs")).rejects.toThrow(
        "enabled",
      );
      await expect(
        teamAct(f, p(3), "disputeRubber", {
          resultId: submitted.resultId,
          reason: "Attempt frozen result change",
        }),
      ).rejects.toThrow("frozen");
      await act(f, organizer, "reopen", {
        reason: "Review authoritative season correction",
      });
      expect((await meta(f)).reviewHold).toBe(true);
      await act(f, organizer, "tick");
      expect((await meta(f)).frozen).toBe(false);
      await act(f, organizer, "close");
      expect((await meta(f)).frozen).toBe(true);
    });
    it("withholds champions for unverified results until audited organizer review and reclosure", async () => {
      const pending = await create(2),
        ch = await challenge(pending, 1, 0);
      await accept(pending, ch.challengeId);
      const result = await score(
        pending,
        ch.challengeId,
        pending.teams[1].id,
        false,
      );
      clock = Date.parse(pending.end) + 1;
      await act(pending, organizer, "tick");
      expect(await meta(pending)).toMatchObject({
        frozen: true,
        pendingReview: true,
        ladderChampionTeamId: null,
        pointsChampionTeamId: null,
      });
      await expect(
        teamAct(pending, result.b.captainId, "confirmRubberScore", {
          resultId: result.resultId,
        }),
      ).rejects.toThrow("frozen");
      await act(pending, organizer, "reopen", {
        reason: "Review synthetic result submitted inside season window",
      });
      await teamAct(pending, result.b.captainId, "confirmRubberScore", {
        resultId: result.resultId,
      });
      await act(pending, organizer, "close");
      expect(await meta(pending)).toMatchObject({
        frozen: true,
        pendingReview: false,
        ladderChampionTeamId: pending.teams[1].id,
        pointsChampionTeamId: pending.teams[1].id,
      });
    });
    it("requires an authorized audited points-champion decision when sporting tiebreakers remain tied", async () => {
      const tied = await create(2);
      clock = Date.parse(tied.end) + 1;
      await act(tied, organizer, "tick");
      expect((await meta(tied)).pointsChampionCandidates).toHaveLength(2);
      expect((await meta(tied)).pointsChampionTeamId).toBeNull();
      await expect(
        act(tied, p(0), "decidePointsChampion", {
          teamId: tied.teams[0].id,
          reason: "Unauthorized championship decision",
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await act(tied, organizer, "decidePointsChampion", {
        teamId: tied.teams[1].id,
        reason: "Organizer reviews equally tied synthetic season results",
      });
      expect((await meta(tied)).pointsChampionTeamId).toBe(tied.teams[1].id);
      await expect(
        act(tied, organizer, "decidePointsChampion", {
          teamId: tied.teams[0].id,
          reason: "Attempt to declare a second winner",
        }),
      ).rejects.toThrow("already");
    });
    it("supports fixed consenting doubles pairs and generates optional playoffs exactly once", async () => {
      const d = await create(2, { entryKind: "doubles", playoffQualifiers: 2 });
      const ch = await challenge(d, 1, 0);
      await accept(d, ch.challengeId);
      await score(d, ch.challengeId, d.teams[1].id);
      await expect(
        teamAct(d, p(2), "withdrawTeam", {
          teamId: d.teams[1].id,
          reason: "Attempt partner replacement mid-season",
        }),
      ).rejects.toThrow("locked");
      clock = Date.parse(d.end) + 1;
      await act(d, organizer, "tick");
      const race = await Promise.allSettled([
        act(d, organizer, "generatePlayoffs"),
        act(d, organizer, "generatePlayoffs"),
      ]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (await rows(d, "teamEncounters")).filter((e) => e.phase === "playoffs"),
      ).toHaveLength(1);
      expect((await load("events", d.id)).playoffWindow.startDate > d.end).toBe(
        true,
      );
      const game = (await rows(d, "teamEncounters")).find(
        (e) => e.phase === "playoffs",
      );
      for (const id of [game.teamA, game.teamB]) {
        const t = await load("teams", id);
        await teamAct(d, t.captainId, "submitLineup", {
          encounterId: game.id,
          teamId: id,
          lineup: {
            singles: [],
            doubles: [{ players: t.memberIds }],
            tiebreak: [],
          },
        });
      }
      const rubber = (await rows(d, "rubbers")).find(
        (r) => r.encounterId === game.id,
      );
      const a = await load("teams", game.teamA),
        b = await load("teams", game.teamB);
      const result = await teamAct(d, a.captainId, "submitRubberScore", {
        rubberId: rubber.id,
        baseVersion: 0,
        score: {
          winner: game.teamA,
          sets: [
            { a: 6, b: 3 },
            { a: 6, b: 3 },
          ],
          outcome: "played",
        },
      });
      await teamAct(d, b.captainId, "confirmRubberScore", {
        resultId: result.resultId,
      });
      expect((await load("events", d.id)).championTeamId).toBe(game.teamA);
      expect(
        (await meta(d)).standings.reduce(
          (n: number, s: any) => n + s.played,
          0,
        ),
      ).toBe(2);
    });
  },
);
