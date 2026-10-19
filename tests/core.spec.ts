import { test, expect, type Page } from "@playwright/test";
test.setTimeout(180000);
async function login(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}
test("registration → development payment → admin approval, seed, draw, schedule and score", async ({
  browser,
}) => {
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await login(player, "player1@pprc.test");
  await player.goto("/register/prosper-open/prosper-open-singles");
  await player.getByLabel("Any scheduling constraints?").fill("None");
  await player.getByRole("checkbox").check();
  await player.getByRole("button", { name: "Reserve my place" }).click();
  await expect(player).toHaveURL(/my-events/);
  await player
    .getByRole("button", { name: "Complete payment" })
    .first()
    .click();
  await player
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(
    player.getByText("Registered", { exact: true }).first(),
  ).toBeVisible();
  const p2context = await browser.newContext();
  const p2 = await p2context.newPage();
  await login(p2, "player2@pprc.test");
  await p2.goto("/register/prosper-open/prosper-open-singles");
  await p2.getByLabel("Any scheduling constraints?").fill("None");
  await p2.getByRole("checkbox").check();
  await p2.getByRole("button", { name: "Reserve my place" }).click();
  await expect(p2).toHaveURL(/my-events/);
  await p2.getByRole("button", { name: "Complete payment" }).first().click();
  await p2.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(
    p2.getByText("Registered", { exact: true }).first(),
  ).toBeVisible();
  const extraContexts = [];
  for (const n of [6, 7]) {
    const context = await browser.newContext();
    extraContexts.push(context);
    const page = await context.newPage();
    await login(page, `player${n}@pprc.test`);
    await page.goto("/register/prosper-open/prosper-open-singles");
    await page.getByLabel("Any scheduling constraints?").fill("None");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Reserve my place" }).click();
    await expect(page).toHaveURL(/my-events/);
    await page.getByRole("button", { name: "Complete payment" }).click();
    await page
      .getByRole("button", { name: "Simulate successful payment" })
      .click();
    await expect(
      page.getByText("Registered", { exact: true }).first(),
    ).toBeVisible();
  }
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, "admin@pprc.test");
  await admin.goto("/admin/events/prosper-open/registrations");
  const panels = admin.locator(".panel").filter({
    has: admin.getByRole("button", { name: "Approve & save seed" }),
  });
  await expect(panels).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const panel = panels.nth(i);
    await panel
      .getByLabel("Seed (0 = external-reference ordering)")
      .fill(String(i + 1));
    await panel
      .getByLabel("Seed change reason")
      .fill("Initial tournament seeding");
    await panel.getByRole("button", { name: "Approve & save seed" }).click();
    await expect(panel.getByText("Approved", { exact: true })).toBeVisible();
    await panel.getByLabel("Check-in status").selectOption("Checked In");
    await panel.getByRole("button", { name: "Update check-in" }).click();
  }
  await admin.goto("/admin/events/prosper-open/draws");
  await admin
    .getByRole("button", { name: "Generate draw", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Publish draw", exact: true })
    .click();
  await expect(
    admin.getByText("Published", { exact: true }).first(),
  ).toBeVisible();
  await admin.goto("/admin/events/prosper-open/schedule");
  await admin
    .getByRole("button", { name: "Generate schedule", exact: true })
    .click();
  await expect(admin.getByText("Unscheduled", { exact: true })).toHaveCount(0);
  await admin.goto("/admin/events/prosper-open/scores");
  let firstWinner = "";
  for (let i = 0; i < 3; i++) {
    const formPanel = admin
      .locator(".panel")
      .filter({
        has: admin.getByRole("button", { name: "Submit & finalize score" }),
      })
      .first();
    await expect(formPanel).toBeVisible();
    if (i === 0)
      firstWinner = (await formPanel.getByRole("heading").innerText())
        .replace(/^Round 1: /, "")
        .split(" vs ")[0];
    await formPanel.getByLabel("P1 games", { exact: true }).nth(0).fill("6");
    await formPanel.getByLabel("P2 games", { exact: true }).nth(0).fill("4");
    await formPanel.getByLabel("P1 games", { exact: true }).nth(1).fill("6");
    await formPanel.getByLabel("P2 games", { exact: true }).nth(1).fill("3");
    await formPanel
      .getByRole("button", { name: "Submit & finalize score" })
      .click();
    await expect(admin.getByText("Final", { exact: true })).toHaveCount(i + 1);
    if (i === 0) {
      await admin.goto("/admin/events/prosper-open/draws");
      const finalRow = admin
        .locator("tr")
        .filter({ has: admin.getByRole("cell", { name: "2", exact: true }) });
      await expect(
        finalRow.getByRole("cell", { name: firstWinner, exact: true }),
      ).toBeVisible();
      await admin.goto("/admin/events/prosper-open/scores");
    }
  }
  await admin.goto("/admin/events/prosper-open");
  await admin
    .getByLabel("Event status", { exact: true })
    .selectOption("Completed");
  await admin
    .getByLabel("Required audit reason")
    .fill("All three matches are finalized");
  await admin.getByRole("button", { name: "Update event status" }).click();
  await expect(
    admin.getByText("Completed", { exact: true }).first(),
  ).toBeVisible();
  await admin.goto("/admin/events/prosper-open/reports");
  const downloadPromise = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "Export results CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("prosper-open-results.csv");
  await Promise.all([
    playerContext.close(),
    p2context.close(),
    adminContext.close(),
    ...extraContexts.map((c) => c.close()),
  ]);
});
test("waitlisted player is promoted when a paid-capacity place opens", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, "admin@pprc.test");
  await admin.goto("/admin/events/sunset-round-robin");
  await admin
    .getByLabel("Total event capacity", { exact: true })
    .count()
    .then(async (count) => {
      if (count)
        await admin
          .getByLabel("Total event capacity", { exact: true })
          .fill("2");
      else await admin.getByLabel("Event capacity", { exact: true }).fill("2");
    });
  await admin
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    admin.getByRole("status").filter({ hasText: "Saved successfully" }),
  ).toBeVisible();
  const contexts = [];
  for (const n of [3, 4, 5]) {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage();
    await login(p, `player${n}@pprc.test`);
    await p.goto("/register/sunset-round-robin/sunset-round-robin-singles");
    await p.getByLabel("Any scheduling constraints?").fill("None");
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Reserve my place" }).click();
    await expect(p).toHaveURL(/my-events/);
    if (n === 5)
      await expect(p.getByText("Waitlisted", { exact: true })).toBeVisible();
  }
  const withdrawing = contexts[0]
    .pages()[0]
    .locator(".panel")
    .filter({
      has: contexts[0]
        .pages()[0]
        .getByRole("heading", { name: /Sunset Social Round Robin/ }),
    });
  await withdrawing
    .getByLabel("Withdrawal reason")
    .fill("Cannot attend this weekend");
  await withdrawing
    .getByRole("button", { name: "Withdraw registration" })
    .click();
  await expect(
    withdrawing.getByText("Withdrawn", { exact: true }),
  ).toBeVisible();
  const promoted = contexts[2].pages()[0];
  await promoted.reload();
  await expect(
    promoted.getByText("Pending Payment", { exact: true }),
  ).toBeVisible();
  await Promise.all([...contexts, adminContext].map((c) => c.close()));
});

test("admin creates and publishes an event through all five wizard steps", async ({
  page,
}) => {
  await login(page, "admin@pprc.test");
  await page.goto("/admin/events/new");
  await expect(
    page.getByRole("heading", { name: "Create an event", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("PPRC Community Cup");
  for (let step = 0; step < 4; step++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create draft event", exact: true })
    .click();
  await expect(page).toHaveURL(/admin\/events\/event-/);
  await expect(
    page.getByRole("heading", { name: "PPRC Community Cup", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish event", exact: true })
    .click();
  await expect(
    page.getByText("Registration Open", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Public preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PPRC Community Cup", exact: true }),
  ).toBeVisible();
});
