import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

async function blocks(page: Page): Promise<any[]> {
  return page.evaluate(async () =>
    (await import("/src/firebase.ts")).getList("courtBlocks", []),
  );
}

test("club admin blocks a court for maintenance, sees it, and releases it", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/admin/courts");
  await expect(
    page.getByRole("heading", { name: "Courts & venues", exact: true }),
  ).toBeVisible();
  const reason = `Resurfacing ${Date.now()}`;

  // Scope to the add-block form: other court and venue forms reuse labels.
  const form = page.locator("form", {
    has: page.getByRole("button", { name: "Add block", exact: true }),
  });
  await form.getByLabel("Court", { exact: true }).selectOption({ index: 0 });
  await form.getByLabel("Start", { exact: true }).fill("2031-03-17T09:00");
  await form.getByLabel("End", { exact: true }).fill("2031-03-17T11:00");
  await form.getByLabel("Block reason", { exact: true }).fill(reason);
  await form
    .getByLabel("Audit reason", { exact: true })
    .fill("Synthetic maintenance block for browser test");
  await form.getByRole("button", { name: "Add block", exact: true }).click();

  const row = page.locator("li", { hasText: reason });
  await expect(row).toBeVisible();
  const stored = (await blocks(page)).find((b) => b.reason === reason);
  expect(stored).toBeTruthy();

  await row.getByLabel("Removal reason", { exact: true }).fill(
    "Synthetic release for browser test",
  );
  await row.getByRole("button", { name: "Remove block", exact: true }).click();
  await expect(page.getByText(reason)).toHaveCount(0);
  expect((await blocks(page)).find((b) => b.reason === reason)).toBeUndefined();
});

test("a signed-in non-admin cannot see the block form", async ({ page }) => {
  await login(page, "player1");
  await page.goto("/admin/courts");
  await expect(page.getByText("Block a court for maintenance")).toHaveCount(0);
});
