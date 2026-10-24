import { test, expect, type Page } from "@playwright/test";
import {
  nextLadderMonday,
  ladderWeekClose,
} from "../packages/shared/src/ladder";
test.setTimeout(240000);
async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}
const entries = async (page: Page, id: string) => {
  await page.goto(`/events/${id}`);
  await page
    .getByRole("button", { name: "Entries & playoffs", exact: true })
    .click();
};
async function rows(page: Page, id: string, c: string): Promise<any[]> {
  return page.evaluate(
    async ({ id, c }) =>
      (await import("/src/firebase.ts")).getList(c, [["eventId", "==", id]]),
    { id, c },
  );
}
async function event(page: Page, id: string): Promise<any> {
  return page.evaluate(
    async (id) => (await import("/src/firebase.ts")).getOne("events", id),
    id,
  );
}
async function wizard(page: Page, doubles: boolean) {
  await page.goto("/admin/events/new");
  await page.getByLabel("Competition format").selectOption("ladder");
  await page
    .getByLabel("Event name", { exact: true })
    .fill(`Browser ${doubles ? "Doubles" : "Singles"} Ladder`);
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
  await page.getByRole("button", { name: "Season rules", exact: true }).click();
  if (doubles)
    await page.getByLabel("Ladder entry type").selectOption("doubles");
  await page
    .getByLabel("I reviewed and confirm the ladder season policy", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Ladder policy change reason")
    .fill("Reviewed synthetic ladder rules and fixed pairs");
  await page
    .getByRole("button", { name: "Save ladder policy", exact: true })
    .click();
  await expect
    .poll(async () => (await event(page, id)).ladderRules.policyConfirmed)
    .toBe(true);
  await page
    .getByRole("button", { name: "Publish ladder season", exact: true })
    .click();
  await expect(
    page.getByText("Registration Open", { exact: true }).first(),
  ).toBeVisible();
  return id;
}
async function approve(page: Page, id: string, name: string, seed: number) {
  await page.goto(`/admin/events/${id}`);
  await page
    .getByRole("button", { name: "Entries & playoffs", exact: true })
    .click();
  const panel = page
    .locator(".panel")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await panel.getByLabel("Team seed", { exact: true }).fill(String(seed));
  await panel
    .getByLabel("Approval reason")
    .fill("Organizer verified synthetic roster references");
  await panel
    .getByRole("button", { name: "Approve team & seed", exact: true })
    .click();
  await expect(panel.getByText("Approved", { exact: true })).toBeVisible();
}
async function start(page: Page, id: string) {
  await page.goto(`/admin/events/${id}`);
  await page.getByRole("button", { name: "Season rules", exact: true }).click();
  const start = nextLadderMonday(Date.now() - 7 * 86400000, "America/Chicago"),
    utc = (n: number) => new Date(n).toISOString().slice(0, 16);
  await page.getByLabel("Season start (UTC)", { exact: true }).fill(utc(start));
  await page
    .getByLabel("Final Sunday close (UTC)", { exact: true })
    .fill(
      utc(ladderWeekClose(new Date(start).toISOString(), "America/Chicago", 8)),
    );
  await page
    .getByLabel("Entry opening (UTC)", { exact: true })
    .fill(utc(start - 14 * 86400000));
  await page
    .getByLabel("Entry closing (UTC)", { exact: true })
    .fill(utc(start - 60000));
  await page
    .getByLabel("Calendar change reason")
    .fill("Organizer reschedules approved synthetic season to current week");
  await page
    .getByRole("button", { name: "Update ladder calendar", exact: true })
    .click();
  await expect
    .poll(async () => (await event(page, id)).startDate)
    .toBe(new Date(start).toISOString());
  await page
    .getByRole("button", { name: "Start approved season", exact: true })
    .click();
  await page.getByRole("button", { name: "Standings", exact: true }).click();
  await expect(page.getByTestId("ladder-standings")).toBeVisible();
  await expect
    .poll(async () => (await event(page, id)).ladderState?.started)
    .toBe(true);
}
async function createEntry(
  page: Page,
  id: string,
  name: string,
  doubles: boolean,
) {
  await entries(page, id);
  await page
    .getByLabel(doubles ? "Team name" : "Entry name", { exact: true })
    .fill(name);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", {
      name: doubles ? "Create team" : "Create entry",
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
for (const doubles of [false, true])
  test(`${doubles ? "Doubles" : "Singles"} ladder: consent → approval → challenge → negotiated time → verified score → persisted rankings`, async ({
    browser,
  }) => {
    const adminContext = await browser.newContext(),
      aContext = await browser.newContext(),
      bContext = await browser.newContext(),
      admin = await adminContext.newPage(),
      a = await aContext.newPage(),
      b = await bContext.newPage();
    try {
      await login(admin, "admin");
      const id = await wizard(admin, doubles);
      await login(a, "player17");
      await login(b, "player19");
      const names = ["Gold Ladder Entry", "Navy Ladder Entry"];
      for (const [page, name, partner] of [
        [a, names[0], "player18"],
        [b, names[1], "player20"],
      ] as const) {
        await createEntry(page, id, name, doubles);
        if (doubles) {
          await page.getByLabel("Player UID", { exact: true }).fill(partner);
          await page
            .getByRole("button", {
              name: "Send player invitation",
              exact: true,
            })
            .click();
          await expect(
            page.getByText(new RegExp(`P2: ${partner}.*Pending`)),
          ).toBeVisible();
          const partnerContext = await browser.newContext(),
            partnerPage = await partnerContext.newPage();
          await login(partnerPage, partner);
          await entries(partnerPage, id);
          await partnerPage
            .getByLabel(/I accept the event waiver and roster invitation/)
            .check();
          await partnerPage
            .getByRole("button", { name: "Accept invitation", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await rows(admin, id, "teams")).find((t) => t.name === name)
                  ?.roster.length,
            )
            .toBe(2);
          await partnerContext.close();
          await entries(page, id);
        }
        await page
          .getByRole("button", {
            name: doubles ? "Register confirmed team" : "Register entry",
            exact: true,
          })
          .click();
        await expect
          .poll(
            async () =>
              (await rows(admin, id, "registrations")).filter(
                (r) => r.state === "Registered",
              ).length,
          )
          .toBe(names.indexOf(name) + 1);
      }
      await approve(admin, id, names[0], 1);
      await approve(admin, id, names[1], 2);
      const teams = await rows(admin, id, "teams"),
        winner = teams.find((t) => t.name === names[1]),
        loser = teams.find((t) => t.name === names[0]);
      await start(admin, id);
      await b.goto(`/events/${id}`);
      await b.getByRole("button", { name: "Challenges", exact: true }).click();
      await b
        .getByRole("button", { name: "Send ladder challenge", exact: true })
        .click();
      await expect(b.getByText("Pending", { exact: true })).toBeVisible();
      await a.goto(`/events/${id}`);
      await a.getByRole("button", { name: "Challenges", exact: true }).click();
      await a
        .getByRole("button", { name: "Accept ladder challenge", exact: true })
        .click();
      await expect(a.getByText("Accepted", { exact: true })).toBeVisible();
      await a
        .getByLabel("Proposed start (UTC)")
        .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
      await a.getByLabel("Match location").fill("Synthetic PPRC Courts");
      await a
        .getByRole("button", { name: "Propose match time", exact: true })
        .click();
      await expect(a.getByText(/Proposed:/)).toBeVisible();
      await b.reload();
      await b.getByRole("button", { name: "Challenges", exact: true }).click();
      await b
        .getByRole("button", { name: "Confirm match time", exact: true })
        .click();
      await expect(b.getByText(/Agreed:/)).toBeVisible();
      const rubber = b.locator(".rubber-row");
      await rubber.locator("summary").click();
      await rubber.getByLabel("Rubber winner").selectOption(winner.id);
      await rubber.getByLabel("Team A set 1", { exact: true }).fill("6");
      await rubber.getByLabel("Team B set 1", { exact: true }).fill("3");
      await rubber.getByLabel("Team A set 2", { exact: true }).fill("6");
      await rubber.getByLabel("Team B set 2", { exact: true }).fill("3");
      await rubber
        .getByRole("button", { name: "Submit rubber score", exact: true })
        .click();
      await expect(rubber.getByText(/Submitted:/)).toBeVisible();
      await expect
        .poll(
          async () =>
            (await event(admin, id)).ladderState.standings.find(
              (s: any) => s.teamId === winner.id,
            ).points,
        )
        .toBe(0);
      await a.reload();
      await a.getByRole("button", { name: "Challenges", exact: true }).click();
      await a.locator(".rubber-row summary").click();
      await a
        .getByRole("button", { name: "Confirm opponent score", exact: true })
        .click();
      await expect
        .poll(
          async () => (await event(admin, id)).ladderState.standings[0].teamId,
        )
        .toBe(winner.id);
      await b.reload();
      await expect(b.getByTestId(`standing-${winner.id}`)).toContainText("#1");
      await expect(
        b.getByTestId(`standing-${winner.id}`).locator("td").nth(2),
      ).toHaveText("4");
      await expect(
        b.getByTestId(`standing-${loser.id}`).locator("td").nth(2),
      ).toHaveText("1");
      await b.setViewportSize({ width: 390, height: 844 });
      expect(
        await b.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (await rows(admin, id, "ladderLedger")).filter(
              (l) => l.kind === "result",
            ).length,
        )
        .toBe(1);
    } finally {
      await aContext.close();
      await bContext.close();
      await adminContext.close();
    }
  });
