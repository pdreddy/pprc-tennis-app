import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("player downloads a valid calendar file from the schedule on a mobile viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/schedule");
  const button = page.getByRole("button", {
    name: "Download calendar (.ics)",
    exact: true,
  });
  await expect(button).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  expect(download.suggestedFilename()).toBe("pprc-matches.ics");
  const text = readFileSync((await download.path())!, "utf8");
  expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  await context.close();
});
