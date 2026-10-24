import { test, expect } from "@playwright/test";

test("player dashboard uses persisted results and public reference leaderboard switches metrics on mobile", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill("player1@pprc.test");
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
  await page.goto("/dashboard");
  const count = page
    .getByTestId("performance-confirmed-results")
    .locator("strong");
  await expect(count).not.toHaveText("0");
  const history = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "My confirmed match history",
      exact: true,
    }),
  });
  await expect(history.locator("tbody tr").first()).toBeVisible();
  await expect(
    history.getByRole("link", { name: "View event" }).first(),
  ).toHaveAttribute("href", /\/events\//);
  const refs = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "My external reference values",
      exact: true,
    }),
  });
  await expect(refs).toContainText("4.2");
  await expect(refs).toContainText("4.5");
  await expect(
    page.getByRole("img", { name: "Confirmed results recorded by month" }),
  ).toBeVisible();
  await page.goto("/rankings");
  const first = page
    .locator("tbody tr")
    .filter({ has: page.locator('a[href="/players/player1"]') });
  await expect(first).toContainText("4.20");
  await page.getByLabel("Leaderboard reference").selectOption("doubles");
  await expect(first).toContainText("4.50");
  await expect(
    page.getByText(/does not calculate or certify official UTR/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await first.getByRole("link").click();
  await expect(
    page.getByText("PUBLIC PLAYER PROFILE", { exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(history.locator("tbody tr").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
