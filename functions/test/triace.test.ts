import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import {
  singlesParticipation,
  defaultTriaceRules,
  type Entity,
} from "@pprc/shared";

const projectId = "demo-pprc-events",
  app = initializeApp({ projectId }),
  db = getFirestore();
let env: RulesTestEnvironment, eid: string;
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const call = (uid: string, action: string, data: any = {}) =>
  execute("triace", uid, req({ eventId: eid, action, ...data }));
const get = (collection: string) =>
  db
    .collection(collection)
    .where("eventId", "==", eid)
    .get()
    .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as Entity));
const players = Array.from({ length: 18 }, (_, i) => `triace-player-${i + 1}`);
const config = {
  name: "TRIACE integration championship",
  description: "Synthetic lifecycle only",
  venue: "PPRC",
  location: "Prosper, TX",
  startDate: new Date(Date.now() + 86400000).toISOString(),
  endDate: new Date(Date.now() + 5 * 86400000).toISOString(),
  timezone: "America/Chicago",
  visibility: "public",
  fee: 0,
  capacity: 6,
  waitlist: true,
  registrationOpen: new Date(Date.now() - 86400000).toISOString(),
  registrationClose: new Date(Date.now() + 3600000).toISOString(),
  waiverRequired: true,
  refundPolicy: "Refund on request",
  sport: "Tennis",
  organizer: "PPRC",
  questions: [],
  assignedAdmins: ["triace-organizer"],
  duration: 90,
  buffer: 15,
  courtIds: ["triace-court-1", "triace-court-2"],
  competition: "triace",
  triaceRules: { ...defaultTriaceRules, groupCount: 2, qualifiersPerGroup: 2 },
};
const teams: Entity[] = [];
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:") ||
    (process.env.GCLOUD_PROJECT &&
      !process.env.GCLOUD_PROJECT.startsWith("demo-"))
  )
    throw Error("Synthetic tests require local demo emulators");
  process.env.FUNCTIONS_EMULATOR = "true";
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
  for (const uid of [
    ...players,
    "triace-admin",
    "triace-organizer",
    "triace-outsider",
    "triace-support",
  ]) {
    await db.doc(`users/${uid}`).set({
      id: uid,
      clubId: "pprc",
      displayName: uid,
      externalRating: 4.5,
      singlesUtr: 4.2,
      doublesUtr: 4.8,
      visibility: "private",
    });
    await db.doc(`memberships/${uid}`).set({
      clubId: "pprc",
      member: true,
      role:
        uid === "triace-admin"
          ? "clubAdmin"
          : uid === "triace-support"
            ? "platformAdmin"
            : ["triace-organizer", "triace-outsider"].includes(uid)
              ? "eventAdmin"
              : "player",
    });
  }
  for (const id of config.courtIds)
    await db.doc(`courts/${id}`).set({
      id,
      clubId: "pprc",
      active: true,
      name: id,
      venueId: "pprc-main",
    });
  eid = (
    await execute(
      "createEvent",
      "triace-admin",
      req({
        event: config,
        divisions: [
          { name: "TRIACE teams", format: "round-robin-playoffs", capacity: 6 },
        ],
      }),
    )
  ).eventId;
  await execute("publishEvent", "triace-admin", req({ eventId: eid }));
}, 60000);
afterAll(async () => {
  await env?.cleanup();
  await db.terminate();
  await deleteApp(app);
});

async function playEncounter(
  e: Entity,
  appearances: Map<string, number>,
  exerciseDispute = false,
) {
  const a = teams.find((t) => t.id === e.teamA)!,
    b = teams.find((t) => t.id === e.teamB)!;
  const lineup = (t: Entity) => {
    const n = appearances.get(t.id) ?? 0;
    appearances.set(t.id, n + 1);
    const p = t.roster.map((r: any) => r.playerId);
    return {
      singles: n % 2 ? [p[1], p[2]] : [p[0], p[1]],
      doubles: [{ players: [p[0], p[1]] }, { players: [p[1], p[2]] }],
      tiebreak: [p[2]],
    };
  };
  await call(a.captainId, "submitLineup", {
    teamId: a.id,
    encounterId: e.id,
    lineup: lineup(a),
  });
  if (exerciseDispute) {
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext(b.captainId).firestore(),
          "lineups",
          `${e.id}-${a.id}`,
        ),
      ),
    );
    await expect(
      call("triace-outsider", "submitLineup", {
        teamId: b.id,
        encounterId: e.id,
        lineup: lineup(b),
      }),
    ).rejects.toThrow("captain");
    appearances.set(b.id, 0);
  }
  await call(b.captainId, "submitLineup", {
    teamId: b.id,
    encounterId: e.id,
    lineup: lineup(b),
  });
  for (const r of (await get("rubbers"))
    .filter((r) => r.encounterId === e.id)
    .sort((x, y) => x.index - y.index)) {
    const score = {
      winner: r.index === 2 || r.index === 3 ? b.id : a.id,
      sets: [
        r.index === 4
          ? { a: 10, b: 7 }
          : r.index < 2
            ? { a: 6, b: 3 }
            : { a: 3, b: 6 },
      ],
      outcome: "played",
      notes: "",
    };
    if (exerciseDispute && r.index === 4)
      await expect(
        call(a.captainId, "submitRubberScore", {
          rubberId: r.id,
          baseVersion: 0,
          score: { ...score, sets: [{ a: 10, b: 9 }] },
        }),
      ).rejects.toThrow("10");
    const result = await call(a.captainId, "submitRubberScore", {
      rubberId: r.id,
      baseVersion: 0,
      score,
    });
    if (exerciseDispute && r.index === 0) {
      await expect(
        call(a.captainId, "confirmRubberScore", { resultId: result.resultId }),
      ).rejects.toThrow("Opponent");
      const dispute = await call(b.captainId, "disputeRubber", {
        resultId: result.resultId,
        reason: "Please verify the recorded set",
      });
      await expect(
        call(b.captainId, "confirmRubberScore", { resultId: result.resultId }),
      ).rejects.toThrow("disputed");
      await call("triace-organizer", "resolveDispute", {
        disputeId: dispute.disputeId,
        resolution: "correct",
        score,
        reason: "Both captains verified the corrected set",
      });
      expect(
        (await db.doc(`rubberResults/${result.resultId}`).get()).get("state"),
      ).toBe("Superseded");
    } else
      await call(b.captainId, "confirmRubberScore", {
        resultId: result.resultId,
      });
    await expect(
      call(b.captainId, "confirmRubberScore", { resultId: result.resultId }),
    ).rejects.toThrow();
  }
  expect((await db.doc(`teamEncounters/${e.id}`).get()).get("winner")).toBe(
    a.id,
  );
}

describe.sequential("TRIACE trusted lifecycle", () => {
  it("rejects players, unassigned organizers and support from administrative mutations", async () => {
    for (const uid of [players[0], "triace-outsider", "triace-support"])
      await expect(
        call(uid, "configure", {
          rules: defaultTriaceRules,
          reason: "Initial tournament rules",
        }),
      ).rejects.toThrow();
    await expect(
      execute(
        "registerForDivision",
        players[0],
        req({ eventId: eid, divisionId: `${eid}-d1`, waiver: true }),
      ),
    ).rejects.toThrow("TRIACE");
    await expect(
      execute(
        "applyAdminOverride",
        "triace-admin",
        req({
          eventId: eid,
          kind: "status",
          status: "Completed",
          reason: "Premature completion attempt",
        }),
      ),
    ).rejects.toThrow("champion");
  });
  it("runs captain creation, private invitations, player consent, snapshots and approval", async () => {
    for (let n = 0; n < 6; n++) {
      const roster = players.slice(n * 3, n * 3 + 3),
        captain = roster[0];
      const t = await call(captain, "createTeam", {
        name: `Synthetic Team ${n + 1}`,
        waiver: true,
      });
      for (let p = 1; p < 3; p++) {
        const invite = await call(captain, "invitePlayer", {
          teamId: t.teamId,
          playerId: roster[p],
          slot: `P${p + 1}`,
        });
        await expect(
          call(players[(n * 3 + 3) % 18], "respondInvitation", {
            invitationId: invite.invitationId,
            accepted: true,
            waiver: true,
          }),
        ).rejects.toThrow("invited");
        await assertFails(
          getDoc(
            doc(
              env.authenticatedContext("triace-outsider").firestore(),
              "invitations",
              invite.invitationId,
            ),
          ),
        );
        await call(roster[p], "respondInvitation", {
          invitationId: invite.invitationId,
          accepted: true,
          waiver: true,
        });
      }
      const reg = await call(captain, "registerTeam", {
        teamId: t.teamId,
        divisionId: `${eid}-d1`,
      });
      expect(
        (await db.doc(`registrations/${reg.registrationId}`).get()).get(
          "combinedReference",
        ),
      ).toBe(14.4);
      await expect(
        call(captain, "invitePlayer", {
          teamId: t.teamId,
          playerId: "triace-admin",
          slot: "P2",
        }),
      ).rejects.toThrow("locked");
      await expect(
        call(captain, "configure", {
          rules: defaultTriaceRules,
          reason: "Unauthorized rule change",
        }),
      ).rejects.toThrow();
      await call("triace-organizer", "approveTeam", {
        teamId: t.teamId,
        seed: n + 1,
        reason: "Initial approved team seeding",
      });
      teams.push({
        id: t.teamId,
        ...(await db.doc(`teams/${t.teamId}`).get()).data(),
      } as Entity);
    }
    expect(await get("ratingSnapshots")).toHaveLength(18);
    await expect(
      call("triace-admin", "configure", {
        rules: defaultTriaceRules,
        reason: "Rules after registration",
      }),
    ).rejects.toThrow("locked");
  }, 120000);
  it("assigns groups, generates real fixtures and schedules without court or team collisions", async () => {
    await call("triace-organizer", "assignGroups");
    await call("triace-organizer", "generateFixtures");
    expect(await get("teamEncounters")).toHaveLength(6);
    await call("triace-organizer", "generateTeamSchedule");
    const encounters = await get("teamEncounters");
    expect(encounters.every((e) => e.scheduledAt && e.courtId)).toBe(true);
    const e = encounters[0],
      other = encounters.find((x) => x.id !== e.id)!;
    await expect(
      call("triace-organizer", "scheduleEncounter", {
        encounterId: other.id,
        scheduledAt: e.scheduledAt,
        courtId: e.courtId,
        reason: "Deliberate conflicting assignment",
      }),
    ).rejects.toThrow("conflict");
    await expect(
      call(teams[0].captainId, "withdrawTeam", {
        teamId: teams[0].id,
        reason: "Late withdrawal needs organizer",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  }, 60000);
  it("plays every group encounter with legal lineups, opponent confirmation, disputes and participation", async () => {
    const appearances = new Map<string, number>();
    let first = true;
    for (const e of (await get("teamEncounters")).sort(
      (a, b) => a.round - b.round || a.id.localeCompare(b.id),
    )) {
      await playEncounter(e, appearances, first);
      first = false;
    }
    const encounters = await get("teamEncounters"),
      rubbers = await get("rubbers");
    for (const t of teams)
      for (const p of t.roster)
        expect(
          singlesParticipation(
            p.playerId,
            t.id,
            encounters,
            rubbers,
            defaultTriaceRules,
          ).eligible,
        ).toBe(true);
    for (const g of await get("teamGroups"))
      await call("triace-organizer", "resolveTeamTies", {
        groupId: g.id,
        teamIds: g.teamIds,
        reason: "Resolve tied sporting records after supervised review",
      });
    expect((await get("disputes")).every((d) => d.status === "Resolved")).toBe(
      true,
    );
  }, 180000);
  it("qualifies four teams, runs semifinals and final, and declares a champion without database edits", async () => {
    const qualification = await call(
      "triace-organizer",
      "generateTeamPlayoffs",
    );
    expect(qualification.qualifiers).toHaveLength(4);
    await expect(
      call("triace-admin", "generateTeamPlayoffs"),
    ).rejects.toThrow();
    const appearances = new Map<string, number>();
    for (const e of (await get("teamEncounters")).filter(
      (e) => e.phase === "playoffs" && e.round === 1,
    ))
      await playEncounter(e, appearances);
    const final = (await get("teamEncounters")).find(
      (e) => e.phase === "playoffs" && !e.nextId,
    )!;
    expect(final.teamA).toBeTruthy();
    expect(final.teamB).toBeTruthy();
    await playEncounter(final, appearances);
    const event = await db.doc(`events/${eid}`).get();
    expect(event.get("status")).toBe("Completed");
    expect(event.get("championTeamId")).toBe(final.teamA);
    const report = await call("triace-organizer", "exportTeamReport");
    expect(report.csv).toContain("Synthetic Team");
    const groupResult = (await get("rubberResults")).find(
      (r) => r.state === "Final" && !r.encounterId.includes("playoffs"),
    )!;
    await expect(
      call("triace-admin", "disputeRubber", {
        resultId: groupResult.id,
        reason: "Qualification already locked",
      }),
    ).rejects.toThrow("locked");
  }, 120000);
  it("enforces direct-write denial, private operational access and immutable audit history", async () => {
    const guest = env.unauthenticatedContext().firestore(),
      player = env.authenticatedContext(players[0]).firestore();
    await assertSucceeds(getDoc(doc(guest, "teams", teams[0].id)));
    for (const collection of [
      "teams",
      "invitations",
      "lineups",
      "rubbers",
      "rubberResults",
      "disputes",
      "ratingSnapshots",
      "teamEncounters",
      "teamGroups",
      "auditEvents",
    ])
      await assertFails(
        setDoc(doc(player, collection, "forged"), {
          eventId: eid,
          clubId: "pprc",
          playerId: players[0],
        }),
      );
    const audits = await db
      .collection("auditEvents")
      .where("eventId", "==", eid)
      .get();
    expect(audits.size).toBeGreaterThan(100);
    const audit = audits.docs[0];
    await assertFails(
      setDoc(
        doc(
          env.authenticatedContext("triace-admin").firestore(),
          "auditEvents",
          audit.id,
        ),
        { action: "forged" },
      ),
    );
    const privateSnapshot = (await get("ratingSnapshots")).find(
      (r) => r.playerId !== players[0],
    )!;
    await assertFails(
      getDoc(doc(player, "ratingSnapshots", privateSnapshot.id)),
    );
    const messages = await get("notifications");
    expect(messages.some((n) => n.title === "Champion declared")).toBe(true);
  });
});
