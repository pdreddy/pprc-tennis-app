import { test, expect, type Page } from "@playwright/test";
test.setTimeout(300000);
const tokens = new Map<string, string>();
async function api(uid: string, operation: string, data: any) {
  if (!tokens.has(uid)) {
    const r = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-pprc-events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${uid}@pprc.test`,
          password: "PprcDemo2026!",
          returnSecureToken: true,
        }),
      },
    );
    const j = await r.json();
    if (!r.ok) throw Error("Synthetic login failed");
    tokens.set(uid, j.idToken);
  }
  const response = await fetch(
    `http://127.0.0.1:5001/demo-pprc-events/us-central1/${operation}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.get(uid)}`,
      },
      body: JSON.stringify({
        data: { requestId: crypto.randomUUID(), ...data },
      }),
    },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error?.message ?? "Callable failed");
  return result.result;
}
async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}
async function records(
  page: Page,
  eventId: string,
  collection: string,
): Promise<any[]> {
  return page.evaluate(
    async ({ eventId, collection }) =>
      (await import("/src/firebase.ts")).getList(collection, [
        ["eventId", "==", eventId],
      ]),
    { eventId, collection },
  );
}
async function wizard(page: Page, kind: "koc" | "doubles", name: string) {
  await page.goto("/admin/events/new");
  await page.getByLabel("Competition format").selectOption(kind);
  await page.getByLabel("Event name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Entry fee ($)", { exact: true }).fill("0");
  await page.getByLabel("Total event capacity", { exact: true }).fill("2");
  await page.getByLabel("Registration questions (one per line)").fill("");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Capacity", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create draft event", exact: true })
    .click();
  await expect(page).toHaveURL(/admin\/events\/event-/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await page.getByLabel(/I reviewed this event's roster/).check();
  if (kind === "koc") {
    await page
      .getByLabel("Maximum rubbers per player in an encounter", { exact: true })
      .fill("1");
    await page
      .getByLabel("Stop when a team wins the required majority", {
        exact: true,
      })
      .uncheck();
  }
  await page
    .getByLabel("Competition policy change reason")
    .fill("Organizer reviewed synthetic event policy");
  await page
    .getByRole("button", { name: "Save competition policy", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await (await import("/src/firebase.ts")).getOne("events", id))
            ?.teamRules.policyConfirmed,
        id,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Publish tournament", exact: true })
    .click();
  await expect(
    page.getByText("Registration Open", { exact: true }).first(),
  ).toBeVisible();
  return id;
}
async function teamByApi(
  id: string,
  start: number,
  size: number,
  name: string,
) {
  const act = (uid: string, action: string, values: any = {}) =>
    api(uid, "teamCompetition", { eventId: id, action, ...values });
  const created = await act(`player${start}`, "createTeam", {
    name,
    waiver: true,
  });
  for (let i = 1; i < size; i++) {
    const invitation = await act(`player${start}`, "invitePlayer", {
      teamId: created.teamId,
      playerId: `player${start + i}`,
      slot: `P${i + 1}`,
    });
    await act(`player${start + i}`, "respondInvitation", {
      invitationId: invitation.invitationId,
      accepted: true,
      waiver: true,
    });
  }
  await act(`player${start}`, "registerTeam", {
    teamId: created.teamId,
    divisionId: `${id}-d1`,
  });
  return created.teamId;
}
async function approve(page: Page, name: string, seed: number) {
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  const panel = page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await panel.getByLabel("Team seed", { exact: true }).fill(String(seed));
  await panel
    .getByLabel("Approval reason")
    .fill("Verified synthetic roster and entry");
  await panel
    .getByRole("button", { name: "Approve team & seed", exact: true })
    .click();
  await expect(panel.getByText("Approved", { exact: true })).toBeVisible();
  await panel.getByLabel("Team check-in status").selectOption("Checked In");
  await panel
    .getByRole("button", { name: "Update team check-in", exact: true })
    .click();
}
async function captainLineup(
  page: Page,
  id: string,
  start: number,
  size: number,
) {
  await page.goto(`/events/${id}`);
  await page.getByRole("button", { name: "Fixtures", exact: true }).click();
  const editor = page.locator(".lineup-editor");
  await editor.locator("summary").click();
  if (size === 4) {
    await editor.getByLabel("Singles 1 player").selectOption(`player${start}`);
    await editor
      .getByLabel("Singles 2 player")
      .selectOption(`player${start + 1}`);
    await editor
      .getByLabel("Doubles 1 pair")
      .selectOption(`player${start + 2}|player${start + 3}`);
  }
  await editor
    .getByRole("button", { name: "Lock & submit lineup", exact: true })
    .click();
  // A click does not await an async Firebase submit. Confirm persistence before
  // navigating away; a full-page navigation can abort the pending callable.
  await expect
    .poll(() =>
      page.evaluate(async (eventId) => {
        const { getList, auth } = await import("/src/firebase.ts");
        return (
          await getList("lineups", [
            ["eventId", "==", eventId],
            ["memberIds", "array-contains", auth.currentUser!.uid],
          ])
        ).length;
      }, id),
    )
    .toBeGreaterThan(0);
}
async function confirmEncounter(page: Page, id: string) {
  await page.goto(`/events/${id}`);
  await page.getByRole("button", { name: "Fixtures", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm encounter", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async (eventId) => {
        const { getList, auth } = await import("/src/firebase.ts");
        const [teams, games] = await Promise.all([
          getList("teams", [
            ["eventId", "==", eventId],
            ["memberIds", "array-contains", auth.currentUser!.uid],
          ]),
          getList("teamEncounters", [
            ["eventId", "==", eventId],
            ["published", "==", true],
          ]),
        ]);
        return games.some((game) =>
          game.confirmedTeamIds?.includes(teams[0]?.id),
        );
      }, id),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Confirm encounter", exact: true }),
  ).toHaveCount(0);
}
async function scoreUi(page: Page, id: string, index: number, decider = false) {
  await page.goto(`/events/${id}`);
  await page.getByRole("button", { name: "Fixtures", exact: true }).click();
  const rubber = page.locator(".rubber-row").nth(index);
  await rubber.locator("summary").click();
  await rubber.getByLabel("Team A set 1", { exact: true }).fill("6");
  await rubber.getByLabel("Team B set 1", { exact: true }).fill("3");
  if (decider) {
    await rubber.getByLabel("Team A set 2", { exact: true }).fill("4");
    await rubber.getByLabel("Team B set 2", { exact: true }).fill("6");
    await rubber.getByLabel("Team A set 3", { exact: true }).fill("10");
    await rubber.getByLabel("Team B set 3", { exact: true }).fill("8");
    await rubber.getByLabel(/Third set is a 10-point/).check();
  }
  await rubber
    .getByRole("button", { name: "Submit rubber score", exact: true })
    .click();
  await expect(rubber.getByText(/Submitted:/)).toBeVisible();
}
async function confirmScoreUi(page: Page, id: string, index: number) {
  await page.goto(`/events/${id}`);
  await page.getByRole("button", { name: "Fixtures", exact: true }).click();
  const rubber = page.locator(".rubber-row").nth(index);
  await rubber.locator("summary").click();
  await rubber
    .getByRole("button", { name: "Confirm opponent score", exact: true })
    .click();
  await expect(
    rubber.getByText("Result version 1", { exact: true }),
  ).toBeVisible();
}

test("KOC organizer policy → four-player roster → captain lineups/confirmation → scores → playoff championship", async ({
  browser,
}) => {
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  await login(admin, "admin");
  const id = await wizard(admin, "koc", "Browser KOC Four-Player Cup");
  const captainContext = await browser.newContext(),
    captain = await captainContext.newPage();
  await login(captain, "player9");
  await captain.goto(`/events/${id}`);
  await captain.getByLabel("Team name", { exact: true }).fill("Orbit Four");
  await captain.getByRole("checkbox").check();
  await captain
    .getByRole("button", { name: "Create team", exact: true })
    .click();
  const ownPanel = captain.locator(".panel").filter({
    has: captain.getByRole("heading", { name: "Orbit Four", exact: true }),
  });
  for (const [slot, p] of [
    ["P2", 10],
    ["P3", 11],
    ["P4", 12],
  ] as const) {
    await ownPanel.getByLabel("Roster slot").selectOption(slot);
    await ownPanel.getByLabel("Player UID", { exact: true }).fill(`player${p}`);
    await ownPanel
      .getByRole("button", { name: "Send player invitation", exact: true })
      .click();
    await expect(
      ownPanel.getByText(new RegExp(`${slot}: player${p}.*Pending`)),
    ).toBeVisible();
    if (p < 12) {
      const invitations = await records(admin, id, "invitations");
      await api(`player${p}`, "teamCompetition", {
        eventId: id,
        action: "respondInvitation",
        invitationId: invitations.find((i) => i.playerId === `player${p}`).id,
        accepted: true,
        waiver: true,
      });
      await captain.reload();
    }
  }
  const partnerContext = await browser.newContext(),
    partner = await partnerContext.newPage();
  await login(partner, "player12");
  await partner.goto("/teams");
  const invitation = partner.locator(".panel").filter({
    has: partner.getByRole("heading", {
      name: "Orbit Four · P4",
      exact: true,
    }),
  });
  await invitation.getByRole("checkbox").check();
  await invitation
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await captain.reload();
  await captain
    .getByRole("button", { name: "Register confirmed team", exact: true })
    .click();
  await expect(ownPanel.getByText("Registered", { exact: true })).toBeVisible();
  await teamByApi(id, 13, 4, "Summit Four");
  await admin.reload();
  await approve(admin, "Orbit Four", 1);
  await approve(admin, "Summit Four", 2);
  await admin
    .getByRole("button", { name: "Assign groups", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Generate fixtures", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Generate team schedule", exact: true })
    .click();
  const opposingContext = await browser.newContext(),
    opponent = await opposingContext.newPage();
  await login(opponent, "player13");
  await captainLineup(captain, id, 9, 4);
  await captainLineup(opponent, id, 13, 4);
  await confirmEncounter(captain, id);
  await confirmEncounter(opponent, id);
  const teams = await records(admin, id, "teams"),
    games = await records(admin, id, "teamEncounters"),
    game = games[0],
    a = teams.find((t) => t.id === game.teamA),
    b = teams.find((t) => t.id === game.teamB);
  const proposing = a.captainId === "player9" ? captain : opponent,
    confirming = b.captainId === "player9" ? captain : opponent;
  for (let i = 0; i < 3; i++) {
    await scoreUi(proposing, id, i);
    await confirmScoreUi(confirming, id, i);
  }
  await admin.reload();
  await admin
    .getByRole("button", { name: "Qualify & generate playoffs", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(admin, id, "teamEncounters")).filter(
          (e) => e.phase === "playoffs",
        ).length,
    )
    .toBe(1);
  const final = (await records(admin, id, "teamEncounters")).find(
    (e) => e.phase === "playoffs",
  );
  const action = (uid: string, action: string, data: any = {}) =>
    api(uid, "teamCompetition", { eventId: id, action, ...data });
  for (const teamId of [final.teamA, final.teamB]) {
    const t = teams.find((t) => t.id === teamId),
      p = t.roster.map((p: any) => p.playerId);
    await action(t.captainId, "submitLineup", {
      teamId,
      encounterId: final.id,
      lineup: {
        singles: p.slice(0, 2),
        doubles: [{ players: p.slice(2, 4) }],
        tiebreak: [],
      },
    });
  }
  for (const teamId of [final.teamA, final.teamB])
    await action(
      teams.find((t) => t.id === teamId).captainId,
      "confirmEncounter",
      { teamId, encounterId: final.id },
    );
  const finalists = {
    a: teams.find((t) => t.id === final.teamA),
    b: teams.find((t) => t.id === final.teamB),
  };
  for (const r of (await records(admin, id, "rubbers")).filter(
    (r) => r.encounterId === final.id,
  )) {
    const submitted = await action(finalists.a.captainId, "submitRubberScore", {
      rubberId: r.id,
      baseVersion: 0,
      score: { winner: final.teamA, sets: [{ a: 6, b: 3 }], outcome: "played" },
    });
    await action(finalists.b.captainId, "confirmRubberScore", {
      resultId: submitted.resultId,
    });
  }
  await captain.goto(`/events/${id}`);
  await expect(captain.locator(".champion-banner")).toContainText(
    finalists.a.name,
  );
  await expect(captain.locator(".champion-banner")).toContainText(
    `Runner-up: ${finalists.b.name}`,
  );
  await captain.setViewportSize({ width: 390, height: 844 });
  expect(
    await captain.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await records(admin, id, "registrations")).every(
      (r) => r.checkIn === "Checked In",
    ),
  ).toBe(true);
  await Promise.all([
    adminContext.close(),
    captainContext.close(),
    opposingContext.close(),
    partnerContext.close(),
  ]);
});

test("doubles fixed partner consent → round robin → deciding match tiebreak → opponent confirmation → championship", async ({
  browser,
}) => {
  const ac = await browser.newContext(),
    admin = await ac.newPage();
  await login(admin, "admin");
  const id = await wizard(admin, "doubles", "Browser Doubles Round Robin");
  await teamByApi(id, 1, 2, "Gold Pair");
  await teamByApi(id, 3, 2, "Navy Pair");
  await admin.reload();
  await approve(admin, "Gold Pair", 1);
  await approve(admin, "Navy Pair", 2);
  await admin
    .getByRole("button", { name: "Assign groups", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Generate fixtures", exact: true })
    .click();
  const a = await browser.newContext(),
    p1 = await a.newPage(),
    b = await browser.newContext(),
    p3 = await b.newPage();
  await login(p1, "player1");
  await login(p3, "player3");
  await captainLineup(p1, id, 1, 2);
  await captainLineup(p3, id, 3, 2);
  await confirmEncounter(p1, id);
  await confirmEncounter(p3, id);
  const [game] = await records(admin, id, "teamEncounters"),
    teams = await records(admin, id, "teams"),
    first = teams.find((t) => t.id === game.teamA),
    second = teams.find((t) => t.id === game.teamB),
    proposer = first.captainId === "player1" ? p1 : p3,
    opponent = second.captainId === "player1" ? p1 : p3;
  await scoreUi(proposer, id, 0, true);
  const pending = (await records(admin, id, "rubberResults"))[0];
  await expect(
    api(first.roster[1].playerId, "teamCompetition", {
      eventId: id,
      action: "confirmRubberScore",
      resultId: pending.id,
    }),
  ).rejects.toThrow("Opponent");
  await confirmScoreUi(opponent, id, 0);
  await p1.reload();
  await expect(p1.locator(".champion-banner")).toContainText(first.name);
  await expect(p1.locator(".champion-banner")).toContainText(
    `Runner-up: ${second.name}`,
  );
  await p1.getByRole("button", { name: "Standings", exact: true }).click();
  await expect(p1.locator("tbody tr").first()).toContainText(first.name);
  const final = (await records(admin, id, "rubberResults"))[0];
  expect(final).toMatchObject({
    state: "Final",
    score: {
      sets: [
        { a: 6, b: 3 },
        { a: 4, b: 6 },
        { a: 10, b: 8, matchTiebreak: true },
      ],
    },
  });
  await p1.setViewportSize({ width: 390, height: 844 });
  expect(
    await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await Promise.all([ac.close(), a.close(), b.close()]);
});
