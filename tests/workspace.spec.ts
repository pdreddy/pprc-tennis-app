import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.setTimeout(120000);
async function login(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill("player1@pprc.test");
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(String(v.impact)),
    ),
  ).toEqual([]);
}
test("quick search finds persisted public tournaments and supports keyboard, escape and route focus", async ({
  page,
}) => {
  await page.goto("/events");
  await page.getByRole("button", { name: "Open quick search" }).click();
  const dialog = page.getByRole("dialog", { name: "Your next move" });
  await expect(dialog.getByLabel("Search workspace")).toBeFocused();
  await dialog.getByLabel("Search workspace").fill("Prosper Open");
  const found = dialog.getByRole("link").filter({ hasText: "Prosper Open" });
  await expect(found).toHaveCount(1);
  await accessible(page);
  await found.click();
  await expect(page).toHaveURL(/events\/prosper-open$/);
  await expect(page.locator("#main-content")).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open quick search" }),
  ).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/events$/);
});
test("redesigned workspace uses authorized counts, actionable links and accessible desktop/mobile layouts", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();
  await expect(
    page.getByTestId("workspace-unread").locator("strong"),
  ).not.toHaveText("Loading");
  const data = await page.evaluate(async () => {
    const f = await import("/src/firebase.ts");
    const uid = f.auth.currentUser!.uid;
    const notes = await f.getList("notifications", [["playerId", "==", uid]]);
    return { unread: notes.filter((n) => !n.read).length };
  });
  await expect(
    page.getByTestId("workspace-unread").locator("strong"),
  ).toHaveText(String(data.unread));
  await expect(
    page.getByTestId("workspace-focus").getByRole("link"),
  ).toHaveAttribute("href", /^(\/events|\/schedule|\/my-events)/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await accessible(page);
  await expect(page.getByRole("navigation",{name:"Main navigation"})).toBeVisible();
  await page.screenshot({
    path: ".local/validation/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await accessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/validation/workspace-mobile.png",
    fullPage: true,
  });
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "You’re offline" }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: "You’re offline" }),
  ).toHaveCount(0);
  await page.getByTestId("workspace-unread").click();
  await expect(page).toHaveURL(/notifications$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: /Your notifications/ }),
  ).toBeVisible();
});
