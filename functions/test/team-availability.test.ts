import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { defaultTriaceRules } from "@pprc/shared";

// Real Firestore emulator. Synthetic accounts, courts and teams only.
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore();
const admin = "tavail-admin";
const courts = ["tavail-court-1", "tavail-court-2"];
const req = (data: any = {}) => ({ requestId: randomUUID(), ...data });
const profile = {
  displayName: "Synthetic team player",
  city: "Prosper",
  preferredSport: "Tennis",
  tennisLevel: "Club",
  externalRating: 4,
  singlesUtr: 4,
  doublesUtr: 4.5,
  handedness: "Right",
  availability: "Synthetic",
  emergencyContact: "Private synthetic contact",
  visibility: "private",
  notificationPreferences: { inApp: true, push: false },
};

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Local emulators required");
  process.env.FUNCTIONS_EMULATOR = "true";
  await db
    .doc(`memberships/${admin}`)
    .set({ clubId: "pprc", role: "clubAdmin", member: true });
  await db
    .doc(`users/${admin}`)
    .set({ id: admin, clubId: "pprc", displayName: admin });
  await execute(
    "manageClub",
    admin,
    req({
      target: "venue",
      id: "tavail-venue",
      value: { name: "Team availability venue", location: "Prosper, TX" },
      reason: "Synthetic venue for team availability",
    }),
  );
  for (const id of courts)
    await execute(
      "manageClub",
      admin,
      req({
        target: "court",
        id,
        value: {
          name: id,
          venueId: "tavail-venue",
          surface: "Hard",
          active: true,
        },
        reason: "Synthetic court for team availability",
      }),
    );
}, 60000);

afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});

const act = (eid: string, uid: string, action: string, data: any = {}) =>
  execute("triace", uid, req({ eventId: eid, action, ...data }));

it("refuses a team slot when a team has fewer than two available players", async () => {
  // Monday 17 March 2031 (Chicago CDT). Only one player on team 0 is available then.
  const teams: { teamId: string; roster: string[] }[] = [];
  for (let t = 0; t < 4; t++) {
    const roster = [0, 1, 2].map((i) => `tavail-${t}-p${i}`);
    for (const uid of roster) {
      await execute(
        "saveProfile",
        uid,
        req({ profile: { ...profile, displayName: uid } }),
      );
      await db
        .doc(`memberships/${uid}`)
        .set({ clubId: "pprc", role: "player", member: true });
    }
    teams.push({ teamId: "", roster });
  }
  await db.doc(`availability/tavail-0-p0`).set({
    id: "tavail-0-p0",
    playerId: "tavail-0-p0",
    clubId: "pprc",
    weekdays: [1],
    windows: [],
    unavailableDates: [],
  });
  await db.doc(`availability/tavail-0-p1`).set({
    id: "tavail-0-p1",
    playerId: "tavail-0-p1",
    clubId: "pprc",
    weekdays: [2],
    windows: [],
    unavailableDates: [],
  });
  await db.doc(`availability/tavail-0-p2`).set({
    id: "tavail-0-p2",
    playerId: "tavail-0-p2",
    clubId: "pprc",
    weekdays: [2],
    windows: [],
    unavailableDates: [],
  });

  const { eventId } = await execute(
    "createEvent",
    admin,
    req({
      event: {
        name: "Synthetic team availability",
        description: "Synthetic team availability test",
        venue: "Team availability venue",
        location: "Prosper, TX",
        startDate: "2031-03-17T13:00:00.000Z",
        endDate: "2031-03-21T13:00:00.000Z",
        timezone: "America/Chicago",
        visibility: "public",
        fee: 0,
        capacity: 4,
        waitlist: true,
        registrationOpen: new Date(Date.now() - 60000).toISOString(),
        registrationClose: new Date(Date.now() + 3600000).toISOString(),
        waiverRequired: true,
        refundPolicy: "Synthetic",
        sport: "Tennis",
        organizer: "PPRC",
        questions: [],
        assignedAdmins: [admin],
        courtIds: courts,
        competition: "triace",
        triaceRules: defaultTriaceRules,
      },
      divisions: [
        { name: "Teams", format: "round-robin-playoffs", capacity: 4 },
      ],
    }),
  );
  await execute("publishEvent", admin, req({ eventId }));
  for (let t = 0; t < 4; t++) {
    const roster = teams[t].roster;
    const team = await act(eventId, roster[0], "createTeam", {
      name: `Availability team ${t}`,
      waiver: true,
    });
    teams[t].teamId = team.teamId;
    for (let i = 1; i < 3; i++) {
      const inv = await act(eventId, roster[0], "invitePlayer", {
        teamId: team.teamId,
        playerId: roster[i],
        slot: `P${i + 1}`,
      });
      await act(eventId, roster[i], "respondInvitation", {
        invitationId: inv.invitationId,
        accepted: true,
        waiver: true,
      });
    }
    await act(eventId, roster[0], "registerTeam", {
      teamId: team.teamId,
      divisionId: `${eventId}-d1`,
    });
    await act(eventId, admin, "approveTeam", {
      teamId: team.teamId,
      seed: t + 1,
      reason: "Synthetic approved seed",
    });
  }
  await act(eventId, admin, "assignGroups", {
    reason: "Reviewed group assignment before fixtures",
  });
  await act(eventId, admin, "generateFixtures");
  const encounter = (
    await db.collection("teamEncounters").where("eventId", "==", eventId).get()
  ).docs[0];
  // Team 0 has one available player on Monday, so a Monday slot is refused for
  // any encounter that includes it, and allowed otherwise.
  const involvesTeamZero = [
    encounter.get("teamA"),
    encounter.get("teamB"),
  ].includes(teams[0].teamId);
  const monday = "2031-03-17T23:30:00.000Z";
  if (involvesTeamZero)
    await expect(
      act(eventId, admin, "scheduleEncounter", {
        encounterId: encounter.id,
        scheduledAt: monday,
        courtId: courts[0],
        reason: "Team availability check",
      }),
    ).rejects.toThrow("scheduling conflict");
  else
    await act(eventId, admin, "scheduleEncounter", {
      encounterId: encounter.id,
      scheduledAt: monday,
      courtId: courts[0],
      reason: "Team availability check",
    });
  // Tuesday evening: team 0 has two available players, so the slot is allowed.
  await act(eventId, admin, "scheduleEncounter", {
    encounterId: encounter.id,
    scheduledAt: "2031-03-18T23:30:00.000Z",
    courtId: courts[0],
    reason: "Team availability accepted",
  });
  expect(
    (await db.doc(`teamEncounters/${encounter.id}`).get()).get("courtId"),
  ).toBe(courts[0]);
}, 240000);
