import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("profile summary shows identity, labeled ratings and the confirmed record", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/profile");
  const summary = page.getByRole("region", { name: "Profile summary" });
  await expect(summary).toBeVisible();
  for (const label of ["Singles", "Doubles"])
    await expect(summary.getByText(label, { exact: true })).toBeVisible();
  // A rating is either a two-decimal reference or the explicit "Not provided" label.
  await expect(summary.locator("strong").first()).toHaveText(
    /^(\d+\.\d{2}|Not provided)$/,
  );
  await expect(
    summary.getByText("Confirmed record", { exact: true }),
  ).toBeVisible();
  await expect(summary.getByText("Teams", { exact: true })).toBeVisible();
  await expect(summary.getByRole("alert")).toHaveCount(0);
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  await context.close();
});
