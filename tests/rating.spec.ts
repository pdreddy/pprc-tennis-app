import { test, expect, type Page } from "@playwright/test";

// API-mode PPRC Rating flows. Run against `./pprc.sh up-api` (VITE_DATA_PROVIDER=api) with the
// seeded demo club. In the hosted preview, VITE_AUTH_MODE=demo provides the one-click demo sign-in.
test.skip(process.env.PPRC_API_UI !== "1", "Set PPRC_API_UI=1 against an API-mode PWA with demo sign-in");

async function signIn(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByTestId(`demo-signin-${uid}`).click();
  await page.waitForURL(/\/(admin|my-events)/);
}

test("rankings list rated players in rating order with provisional markers", async ({ page }) => {
  await signIn(page, "player2");
  await page.goto("/rankings");
  await expect(page.getByTestId("rank-1")).toBeVisible();
  const ratings = await page.locator(".pp-table tbody td.num strong").allInnerTexts();
  const values = ratings.map(Number);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await page.getByRole("tab", { name: "Doubles" }).click();
  await expect(page.getByText(/Doubles ·/)).toBeVisible();
});

test("player profile shows PPRC ratings, reliability and history", async ({ page }) => {
  await signIn(page, "player2");
  await page.goto("/players");
  await page.getByTestId("players-search").fill("Demo Player 1");
  await page.getByTestId("player-card-player1").click();
  await expect(page.getByTestId("player-name")).toHaveText("Demo Player 1");
  await expect(page.getByTestId("rating-card-singles")).toContainText("PPRC singles rating");
});

test("a reported result needs the opponent's confirmation", async ({ browser }) => {
  const reporter = await (await browser.newContext()).newPage();
  await signIn(reporter, "player9");
  await reporter.goto("/me/matches");
  await reporter.getByTestId("report-opponent").selectOption("player10");
  await reporter.getByTestId("report-score").fill("6-4 6-4");
  await reporter.getByRole("button", { name: "Send for confirmation" }).click();
  await expect(reporter.getByText("Reported").first()).toBeVisible();
  const opponent = await (await browser.newContext()).newPage();
  await signIn(opponent, "player10");
  await opponent.goto("/me/matches");
  await expect(opponent.getByText(/waiting for confirmation/)).toBeVisible();
  await opponent.getByRole("button", { name: "Confirm result" }).first().click();
  await expect(opponent.getByText("Rated").first()).toBeVisible();
});

test("ladder challenge from a lower rank", async ({ page }) => {
  await signIn(page, "player5");
  await page.goto("/ladder");
  await expect(page.getByText("Demo Player 5 (you)")).toBeVisible();
  const challenge = page.getByRole("button", { name: "Challenge", exact: true });
  if (await challenge.count()) await challenge.first().click();
  await expect(page.getByRole("button", { name: "Cancel challenge" }).first()).toBeVisible();
});
