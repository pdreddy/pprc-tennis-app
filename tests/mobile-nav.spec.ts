import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

const destinations: [string, string][] = [
  ["Home", "/"],
  ["Tournaments", "/events"],
  ["Matches", "/schedule"],
  ["Rankings", "/rankings"],
  ["Profile", "/profile"],
];

test("mobile bottom navigation opens five destinations and marks the active one", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  const nav = page.locator(".mobile-nav");
  await expect(nav.getByRole("link")).toHaveCount(5);
  for (const [label, path] of destinations) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    // Home must not stay highlighted on other destinations.
    if (path !== "/")
      await expect(
        nav.getByRole("link", { name: "Home", exact: true }),
      ).not.toHaveAttribute("aria-current", "page");
  }
  await context.close();
});

test("profile links reach teams, club and players without the bottom bar", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/profile");
  const more = page.getByRole("navigation", { name: "More places" });
  for (const [label, path] of [
    ["My teams", "/teams"],
    ["Club", "/clubs/pprc"],
    ["Players", "/players"],
  ] as const) {
    await page.goto("/profile");
    await more.getByRole("link", { name: label, exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  }
  await context.close();
});
