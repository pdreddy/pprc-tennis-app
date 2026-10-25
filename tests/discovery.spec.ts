import { test, expect } from "@playwright/test";

test.setTimeout(120000);

test("discovery groups filter the event list and their counts match the cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/events");
  const groups = page.getByRole("group", { name: "Event groups" });
  await expect(groups).toBeVisible();
  for (const label of ["All", "Upcoming", "Active", "Completed"]) {
    const tab = groups.getByRole("button", { name: new RegExp(`^${label}`) });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    const count = Number(
      (await tab.locator(".filter-count").textContent()) ?? "NaN",
    );
    expect(Number.isNaN(count)).toBe(false);
    // The visible card count and the results heading match the tab count.
    await expect(page.locator(".event-card")).toHaveCount(count);
    await expect(page.locator(".event-discovery strong").first()).toHaveText(
      String(count),
    );
  }
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
});
