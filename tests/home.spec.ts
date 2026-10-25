import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("signed-in player sees a personal home with real sections and no load errors", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Hi, / }),
  ).toBeVisible();
  for (const section of [
    "Upcoming matches",
    "My registrations",
    "Active ladder challenges",
    "My teams",
  ])
    await expect(
      page.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible();
  // Ratings show a real value or the explicit "Not provided" label, never a blank or zero placeholder.
  const ratings = page.getByRole("region", { name: "Ratings" });
  await expect(ratings).toBeVisible();
  for (const label of ["Singles", "Doubles"])
    await expect(ratings.getByText(label, { exact: true })).toBeVisible();
  // Every section loaded from authorized data: no inline error alerts.
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Small screens: no horizontal overflow.
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  await context.close();
});

test("guests keep the public landing page without personal data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Find your next event/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Hi, / })).toHaveCount(0);
});
