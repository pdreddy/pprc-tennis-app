import { test, expect } from "@playwright/test";

test.setTimeout(120000);

test("rankings show server ladder standings or an explicit empty state, plus the separate reference list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rankings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ladder standings" }),
  ).toBeVisible();
  // Either real standings tables or the explicit empty state; never a blank area.
  const standings = page.getByRole("region", { name: "Ladder standings" });
  const empty = page.getByText("No ladder standings yet", { exact: true });
  await expect(standings.or(empty)).toBeVisible();
  if (await standings.count()) {
    // Standings carry a numeric rank in each row.
    const firstRank = standings
      .locator("tbody tr")
      .first()
      .locator("td")
      .first();
    await expect(firstRank).toHaveText(/^\d+$/);
  }
  await expect(
    page.getByRole("heading", { name: "Reference leaderboard", exact: true }),
  ).toBeVisible();
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
});
