import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

// Saves the availability form, waiting for the server write to finish.
async function save(page: Page) {
  const panel = page.getByRole("region", { name: "Availability" });
  const done = page.waitForResponse(
    (r) => r.url().includes("saveAvailability") && r.ok(),
  );
  await panel
    .getByRole("button", { name: "Save availability", exact: true })
    .click();
  await done;
  await expect(
    panel.getByText("Saved successfully.", { exact: true }),
  ).toBeVisible();
}

test("player saves private availability and it persists after reload", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await login(page, "player1");
  await page.goto("/profile");
  const panel = page.getByRole("region", { name: "Availability" });
  await expect(
    panel.getByText("Only you and club administrators", { exact: false }),
  ).toBeVisible();
  try {
    await panel.getByLabel("Mon", { exact: true }).check();
    await panel
      .getByLabel("Preferred start time", { exact: true })
      .fill("18:00");
    await panel.getByLabel("Preferred end time", { exact: true }).fill("20:00");
    await save(page);
    await page.reload();
    const again = page.getByRole("region", { name: "Availability" });
    await expect(again.getByLabel("Mon", { exact: true })).toBeChecked();
    await expect(
      again.getByLabel("Preferred start time", { exact: true }),
    ).toHaveValue("18:00");
    await expect(
      again.getByLabel("Preferred end time", { exact: true }),
    ).toHaveValue("20:00");
  } finally {
    // Restore "no restriction" so later flows that schedule this player are unaffected.
    await page.goto("/profile");
    const reset = page.getByRole("region", { name: "Availability" });
    await reset.getByLabel("Mon", { exact: true }).uncheck();
    await reset.getByLabel("Preferred start time", { exact: true }).fill("");
    await reset.getByLabel("Preferred end time", { exact: true }).fill("");
    await save(page);
  }
  await context.close();
});
