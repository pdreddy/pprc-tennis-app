import { test, expect, type Page } from "@playwright/test";

test.setTimeout(180000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("deep links and refresh keep the player on the same screen with the right tab active", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  for (const [path, label] of [
    ["/schedule", "Matches"],
    ["/rankings", "Rankings"],
    ["/profile", "Profile"],
  ] as const) {
    await page.goto(path);
    await page.reload();
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await expect(
      page
        .locator(".mobile-nav")
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  await context.close();
});

test("an unauthenticated visitor to a player screen is asked to sign in, not shown player data", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/profile");
  await expect(
    page.getByText(
      "Sign in to manage your profile, register and follow your events.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Profile summary" }),
  ).toHaveCount(0);
  await context.close();
});
