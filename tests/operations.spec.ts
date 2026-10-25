import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("player switches calendar views and sees reschedule requests on a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/schedule");
  const views = page.getByRole("group", { name: "Calendar view" });
  for (const label of ["Day", "Week", "Month"]) {
    const tab = views.getByRole("button", { name: label, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
  }
  await expect(
    page.getByRole("heading", { name: "Reschedule requests", exact: true }),
  ).toBeVisible();
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  await context.close();
});

test("organizer sees operations counts for a chosen event", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/admin/operations");
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  const choose = page.getByLabel("Event", { exact: true });
  await choose.selectOption({ index: 1 });
  const summary = page.getByRole("region", { name: "Operations summary" });
  await expect(summary).toBeVisible();
  for (const label of [
    "Upcoming in 7 days",
    "Unscheduled",
    "Overdue",
    "Missing scores",
  ])
    await expect(summary.getByText(label, { exact: true })).toBeVisible();
});
