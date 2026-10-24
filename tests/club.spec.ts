import { test, expect, type Page } from "@playwright/test";

test.setTimeout(180000);
async function login(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

test("new player → private-event denial → membership approval → paid registration → privacy opt-out", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    player = await context.newPage();
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  await login(admin, "admin@pprc.test");
  // Arrange an isolated event through the same authenticated callable used by the UI.
  const eventId = await admin.evaluate(async () => {
    const { call } = await import("/src/firebase.ts");
    const iso = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString();
    const result = await call("createEvent", {
      event: {
        name: "Membership Onboarding Open",
        description: "Synthetic member journey",
        venue: "PPRC",
        location: "Prosper",
        startDate: iso(8),
        endDate: iso(9),
        timezone: "America/Chicago",
        visibility: "private",
        fee: 500,
        capacity: 8,
        waitlist: true,
        registrationOpen: iso(-1),
        registrationClose: iso(7),
        waiverRequired: true,
        refundPolicy: "Synthetic test refunds only",
        organizer: "PPRC",
        courtIds: ["court-1"],
      },
      divisions: [
        { name: "Member singles", format: "single-elimination", capacity: 8 },
      ],
    });
    await call("publishEvent", { eventId: result.eventId });
    return result.eventId as string;
  });
  await player.goto("/signin");
  await player
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await player
    .getByLabel("Email", { exact: true })
    .fill(`onboarding-${Date.now()}@pprc.test`);
  await player.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await player
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(player).toHaveURL(/profile/);
  await player
    .getByLabel("Display name", { exact: true })
    .fill("Milestone Club Member");
  await player.getByLabel("City", { exact: true }).fill("Aubrey");
  await player.getByLabel("Playing level").fill("Club competitive");
  await player
    .getByLabel("External rating reference (optional)", { exact: true })
    .fill("5");
  await player.getByLabel("Singles UTR reference", { exact: true }).fill("5.1");
  await player.getByLabel("Doubles UTR reference", { exact: true }).fill("4.9");
  await player
    .getByRole("button", { name: "Save player profile", exact: true })
    .click();
  await expect(player.locator(".onboarding-steps li").first()).toContainText(
    "Complete",
  );
  const uid = await player.evaluate(
    async () => (await import("/src/firebase.ts")).auth.currentUser!.uid,
  );
  await player.goto(`/events/${eventId}`);
  await expect(player.getByRole("alert")).toContainText(/permission/i);
  await player.goto("/clubs/pprc");
  await expect(
    player.getByText("Membership Onboarding Open", { exact: true }),
  ).toHaveCount(0);
  await player
    .getByLabel("Message to the club (optional)")
    .fill("Please approve my synthetic application.");
  await player
    .getByRole("button", { name: "Request club membership", exact: true })
    .click();
  await expect(
    player.getByText("Pending review", { exact: true }),
  ).toBeVisible();
  await admin.goto("/admin/members");
  const application = admin.getByTestId(`membership-${uid}`);
  await expect(
    application.getByRole("heading", { name: "Milestone Club Member" }),
  ).toBeVisible();
  await application.getByLabel("Membership decision").selectOption("Approved");
  await application
    .getByLabel("Decision reason (shared with player)")
    .fill("Synthetic application approved for integration testing");
  await application
    .getByRole("button", { name: "Review membership", exact: true })
    .click();
  await expect(application).toHaveCount(0);
  await player.reload();
  const membershipPanel = player.locator(".panel").filter({
    has: player.getByRole("heading", { name: "Your club membership" }),
  });
  await expect(
    membershipPanel.getByText("Club member", { exact: true }),
  ).toBeVisible();
  await player.goto("/notifications");
  const approval = player.locator(".panel").filter({
    has: player.getByRole("heading", { name: "Club membership approved" }),
  });
  await expect(
    approval.getByRole("link", { name: "View update" }),
  ).toHaveAttribute("href", "/clubs/pprc");
  await approval.getByRole("link", { name: "View update" }).click();
  await player
    .getByRole("link", { name: /Membership Onboarding Open/ })
    .first()
    .click();
  await player.getByRole("link", { name: /^Register/ }).click();
  await player.getByRole("checkbox").check();
  await player.getByRole("button", { name: "Reserve my place" }).click();
  await expect(player).toHaveURL(/my-events/);
  await player
    .getByRole("button", { name: "Complete payment", exact: true })
    .click();
  await player
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(player.getByText("Registered", { exact: true })).toBeVisible();
  await player.goto("/dashboard");
  await expect(
    player.getByTestId("performance-confirmed-results").locator("strong"),
  ).toHaveText("0");
  await expect(
    player.getByText("Your performance story starts on court", { exact: true }),
  ).toBeVisible();
  await player.goto("/players");
  await player.getByLabel("Search players").fill("Milestone Club");
  await player
    .getByRole("link", { name: "Milestone Club Member", exact: true })
    .click();
  await expect(
    player.getByRole("heading", { name: "Milestone Club Member" }),
  ).toBeVisible();
  await expect(player.locator(".reference-grid")).toContainText("5.1");
  await player.goto("/profile");
  await player.getByLabel("Profile visibility").selectOption("private");
  await player
    .getByRole("button", { name: "Save player profile", exact: true })
    .click();
  await expect
    .poll(() =>
      player.evaluate(
        async () =>
          await (
            await import("/src/firebase.ts")
          ).getOne(
            "publicProfiles",
            (await import("/src/firebase.ts")).auth.currentUser!.uid,
          ),
      ),
    )
    .toBeNull();
  const guestContext = await browser.newContext(),
    guest = await guestContext.newPage();
  await guest.goto(`/players/${uid}`);
  await expect(
    guest.getByText("This player isn’t publicly listed", { exact: true }),
  ).toBeVisible();
  await guest.goto("/rankings");
  await expect(
    guest.getByRole("link", { name: "Milestone Club Member", exact: true }),
  ).toHaveCount(0);
  await player.setViewportSize({ width: 390, height: 844 });
  await player
    .locator(".mobile-nav")
    .getByRole("link", { name: "Club", exact: true })
    .click();
  await expect(player).toHaveURL(/clubs\/pprc/);
  await expect(player.locator(".club-hero h1")).toBeVisible();
  await expect(player.locator(".player-card").first()).toBeVisible();
  const layout = await player.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    overflowing: [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().right > innerWidth)
      .slice(0, 12)
      .map((el) => ({
        className: el.className,
        text: el.textContent?.slice(0, 100),
        right: el.getBoundingClientRect().right,
      })),
  }));
  expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.viewport,
  );
  const box = await player
    .locator(".mobile-nav")
    .getByRole("link", { name: "Club", exact: true })
    .boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await Promise.all([
    context.close(),
    adminContext.close(),
    guestContext.close(),
  ]);
});
