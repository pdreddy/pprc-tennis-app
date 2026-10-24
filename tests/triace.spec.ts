import { test, expect, type Page } from "@playwright/test";
test.setTimeout(300000);
const eid = "triace-cup",
  tokens = new Map<string, string>();
async function token(uid: string) {
  if (tokens.has(uid)) return tokens.get(uid)!;
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
  if (!r.ok) throw Error(j.error?.message);
  tokens.set(uid, j.idToken);
  return j.idToken as string;
}
async function api(uid: string, action: string, data: any = {}) {
  const r = await fetch(
    "http://127.0.0.1:5001/demo-pprc-events/us-central1/triace",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token(uid)}`,
      },
      body: JSON.stringify({
        data: { requestId: crypto.randomUUID(), eventId: eid, action, ...data },
      }),
    },
  );
  const j = await r.json();
  if (!r.ok) throw Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.result;
}
function decode(value: any): any {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [
        k,
        decode(v),
      ]),
    );
  return value.timestampValue;
}
async function records(collection: string): Promise<any[]> {
  const r = await fetch(
    "http://127.0.0.1:8080/v1/projects/demo-pprc-events/databases/(default)/documents:runQuery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token("admin")}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "eventId" },
              op: "EQUAL",
              value: { stringValue: eid },
            },
          },
        },
      }),
    },
  );
  const j = await r.json();
  if (!r.ok) throw Error(JSON.stringify(j));
  return j
    .filter((x: any) => x.document)
    .map((x: any) => ({
      id: x.document.name.split("/").pop(),
      ...Object.fromEntries(
        Object.entries(x.document.fields).map(([k, v]) => [k, decode(v)]),
      ),
    }));
}
async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}
const lineup = (roster: any[], rotate = false) => {
  const p = roster.map((r) => r.playerId);
  return {
    singles: rotate ? [p[1], p[2]] : [p[0], p[1]],
    doubles: [{ players: [p[0], p[1]] }, { players: [p[1], p[2]] }],
    tiebreak: [p[2]],
  };
};

test("TRIACE captain invitations → registration → groups → confirmed rubbers → playoffs → champion", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    captain = await context.newPage();
  await login(captain, "player1");
  await captain.goto(`/events/${eid}/triace`);
  await captain.getByLabel("Team name", { exact: true }).fill("Aurora Aces");
  await captain.getByRole("checkbox").check();
  await captain
    .getByRole("button", { name: "Create team", exact: true })
    .click();
  await expect(
    captain.getByRole("heading", { name: "Aurora Aces", exact: true }),
  ).toBeVisible();
  for (const [uid, slot] of [
    ["player2", "P2"],
    ["player3", "P3"],
  ]) {
    await captain.getByLabel("Roster slot", { exact: true }).selectOption(slot);
    await captain.getByLabel("Player UID", { exact: true }).fill(uid);
    await captain
      .getByRole("button", { name: "Send player invitation", exact: true })
      .click();
    const invitedContext = await browser.newContext(),
      invited = await invitedContext.newPage();
    await login(invited, uid);
    await invited.goto("/teams");
    await invited.getByRole("checkbox").check();
    await invited
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      invited.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toHaveCount(0);
    await invitedContext.close();
    await captain.reload();
  }
  await captain
    .getByRole("button", { name: "Register confirmed team", exact: true })
    .click();
  await expect(
    captain.getByRole("link", { name: "Registration & payment" }),
  ).toBeVisible();
  let teams = await records("teams");
  const firstTeam = teams.find((t) => t.captainId === "player1")!;
  for (let n = 1; n < 6; n++) {
    const captainId = `player${n * 3 + 1}`,
      result = await api(captainId, "createTeam", {
        name: [
          "Aurora Aces",
          "Midnight Racquets",
          "Golden Eagles",
          "Court Royals",
          "Prosper Panthers",
          "North Stars",
        ][n],
        waiver: true,
      });
    for (let p = 1; p < 3; p++) {
      const playerId = `player${n * 3 + p + 1}`,
        invite = await api(captainId, "invitePlayer", {
          teamId: result.teamId,
          playerId,
          slot: `P${p + 1}`,
        });
      await api(playerId, "respondInvitation", {
        invitationId: invite.invitationId,
        accepted: true,
        waiver: true,
      });
    }
    await api(captainId, "registerTeam", {
      teamId: result.teamId,
      divisionId: "triace-cup-teams",
    });
  }
  teams = await records("teams");
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  await login(admin, "admin");
  await admin.goto(`/admin/events/${eid}`);
  const firstPanel = admin.locator(".panel").filter({
    has: admin.getByRole("heading", { name: "Aurora Aces", exact: true }),
  });
  await firstPanel.getByLabel("Team seed", { exact: true }).fill("1");
  await firstPanel
    .getByLabel("Approval reason", { exact: true })
    .fill("Initial team seeding after roster verification");
  await firstPanel
    .getByRole("button", { name: "Approve team & seed", exact: true })
    .click();
  await expect(firstPanel.getByText("Approved", { exact: true })).toBeVisible();
  let seed = 2;
  for (const t of teams.filter((t) => t.id !== firstTeam.id))
    await api("admin", "approveTeam", {
      teamId: t.id,
      seed: seed++,
      reason: "Initial approved team seed",
    });
  await admin.reload();
  await admin
    .getByRole("button", { name: "Assign groups", exact: true })
    .click();
  await expect(
    admin.getByRole("button", { name: "Assign groups", exact: true }),
  ).toBeDisabled();
  await admin
    .getByRole("button", { name: "Generate fixtures", exact: true })
    .click();
  await expect(
    admin.getByRole("button", { name: "Generate fixtures", exact: true }),
  ).toBeDisabled();
  await admin
    .getByRole("button", { name: "Generate team schedule", exact: true })
    .click();
  const played = new Map<string, number>();
  const submitLineups = async (e: any) => {
    for (const id of [e.teamA, e.teamB]) {
      const t = teams.find((t) => t.id === id)!;
      const n = played.get(id) ?? 0;
      played.set(id, n + 1);
      await api(t.captainId, "submitLineup", {
        teamId: id,
        encounterId: e.id,
        lineup: lineup(t.roster, e.phase === "groups" && n % 2 === 1),
      });
    }
  };
  const scoreRubbers = async (e: any, skipFirst = false) => {
    const a = teams.find((t) => t.id === e.teamA)!,
      b = teams.find((t) => t.id === e.teamB)!;
    for (const r of (await records("rubbers"))
      .filter((r) => r.encounterId === e.id)
      .sort((a, b) => a.index - b.index)) {
      if (skipFirst && r.index === 0) continue;
      const result = await api(a.captainId, "submitRubberScore", {
        rubberId: r.id,
        baseVersion: r.version,
        score: {
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
        },
      });
      await api(b.captainId, "confirmRubberScore", {
        resultId: result.resultId,
      });
    }
  };
  for (const e of (await records("teamEncounters")).sort(
    (a, b) => a.round - b.round || a.id.localeCompare(b.id),
  )) {
    await submitLineups(e);
    await scoreRubbers(e);
  }
  for (const g of await records("teamGroups"))
    await api("admin", "resolveTeamTies", {
      groupId: g.id,
      teamIds: g.teamIds,
      reason: "Explicit review of qualification tie order",
    });
  await admin.reload();
  await admin
    .getByRole("button", { name: "Qualify & generate playoffs", exact: true })
    .click();
  await expect(
    admin.getByRole("button", {
      name: "Qualify & generate playoffs",
      exact: true,
    }),
  ).toBeDisabled();
  for (const e of (await records("teamEncounters")).filter(
    (e) => e.phase === "playoffs" && e.nextId,
  )) {
    await submitLineups(e);
    await scoreRubbers(e);
  }
  const final = (await records("teamEncounters")).find(
    (e) => e.phase === "playoffs" && !e.nextId,
  )!;
  const a = teams.find((t) => t.id === final.teamA)!,
    b = teams.find((t) => t.id === final.teamB)!;
  const finalistContext = await browser.newContext(),
    finalist = await finalistContext.newPage();
  await login(finalist, a.captainId);
  await finalist.goto(`/events/${eid}/triace`);
  await finalist.getByRole("button", { name: "Fixtures", exact: true }).click();
  const fixture = finalist.getByTestId(`encounter-${final.id}`);
  await fixture.getByText("Submit captain lineup", { exact: true }).click();
  await fixture
    .getByRole("button", { name: "Lock & submit lineup", exact: true })
    .click();
  await expect(fixture.getByText(/Your lineup is locked/)).toBeVisible();
  await api(b.captainId, "submitLineup", {
    teamId: b.id,
    encounterId: final.id,
    lineup: lineup(b.roster),
  });
  await finalist.reload();
  await finalist.getByRole("button", { name: "Fixtures", exact: true }).click();
  const firstRubber = fixture.locator(".rubber-row").first();
  await firstRubber.locator("summary").click();
  await firstRubber.getByLabel("Team A set 1", { exact: false }).fill("6");
  await firstRubber.getByLabel("Team B set 1", { exact: false }).fill("3");
  await firstRubber
    .getByRole("button", { name: "Submit rubber score", exact: true })
    .click();
  await expect(
    firstRubber.getByText(/Awaiting confirmation|Submitted:/).first(),
  ).toBeVisible();
  const opponentContext = await browser.newContext(),
    opponent = await opponentContext.newPage();
  await login(opponent, b.captainId);
  await opponent.goto(`/events/${eid}/triace`);
  await opponent.getByRole("button", { name: "Fixtures", exact: true }).click();
  const opponentRubber = opponent
    .getByTestId(`encounter-${final.id}`)
    .locator(".rubber-row")
    .first();
  await opponentRubber.locator("summary").click();
  await opponentRubber
    .getByRole("button", { name: "Confirm opponent score", exact: true })
    .click();
  await expect(
    opponentRubber.locator("summary").getByText("6–3", { exact: true }),
  ).toBeVisible();
  await scoreRubbers(final, true);
  await finalist.reload();
  await expect(
    finalist.getByRole("status").filter({ hasText: "CHAMPIONS" }),
  ).toContainText(a.name);
  await finalist
    .getByRole("button", { name: "Standings", exact: true })
    .click();
  await expect(
    finalist.getByRole("heading", {
      name: "Championship bracket",
      exact: true,
    }),
  ).toBeVisible();
  await finalist.setViewportSize({ width: 390, height: 844 });
  expect(
    await finalist.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await finalist.screenshot({
    path: "test-results/triace-mobile-champion.png",
    fullPage: true,
  });
  await finalist.goto("/schedule");
  await expect(
    finalist.getByRole("heading", { name: "My team schedule", exact: true }),
  ).toBeVisible();
  await expect(
    finalist.getByRole("link", { name: "Lineup & scores" }).first(),
  ).toBeVisible();
  await finalist.goto("/results");
  await expect(
    finalist.getByRole("heading", {
      name: "My TRIACE match history",
      exact: true,
    }),
  ).toBeVisible();
  await expect(finalist.getByRole("alert")).toHaveCount(0);
  await expect(
    finalist
      .locator(".panel")
      .filter({
        has: finalist.getByRole("heading", {
          name: "My TRIACE match history",
          exact: true,
        }),
      })
      .getByRole("link", { name: "Tournament →" })
      .first(),
  ).toBeVisible();
  await context.close();
  await adminContext.close();
  await finalistContext.close();
  await opponentContext.close();
});

test("TRIACE public scoreboard works on iPhone and unassigned organizers cannot operate it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/events/${eid}/triace`);
  await expect(
    page.getByRole("heading", {
      name: "TRIACE 2.0 Champions Cup",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await login(page, "other-admin");
  await page.goto(`/admin/events/${eid}`);
  await expect(
    page.getByRole("button", { name: "Generate fixtures", exact: true }),
  ).toHaveCount(0);
  await expect(api("other-admin", "generateFixtures")).rejects.toThrow(
    "organizer",
  );
});
