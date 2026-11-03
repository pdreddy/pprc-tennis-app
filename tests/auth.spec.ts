import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Real Emergent-managed sign-in on the hosted preview, driven by one-time sign-in tickets.
// Run with `./pprc.sh test-auth-ui` (mints tickets for the two +clerk_test users first).
const ticketsFile = process.env.PPRC_TICKETS_JSON;
test.skip(!ticketsFile || !process.env.PPRC_BASE_URL, "Set PPRC_TICKETS_JSON and PPRC_BASE_URL (see ./pprc.sh test-auth-ui)");
const tickets: Record<"alex" | "blair", { user_id: string; ticket: string }> = ticketsFile ? JSON.parse(readFileSync(ticketsFile, "utf8")) : ({} as never);

const sessions: Partial<Record<"alex" | "blair", BrowserContext>> = {};

async function signedIn(browser: Browser, who: "alex" | "blair"): Promise<Page> {
  if (!sessions[who]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/sign-in?__clerk_ticket=${tickets[who].ticket}`);
    await page.waitForLoadState("networkidle");
    await page.goto("/me/rating");
    await expect(page.getByTestId("my-rating-page")).toBeVisible({ timeout: 30000 });
    sessions[who] = context;
    await page.close();
  }
  return sessions[who]!.newPage();
}

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const context of Object.values(sessions)) await context?.close();
});

test("signed-out visitors are sent to sign in for player pages", async ({ page }) => {
  await page.goto("/me/rating");
  await expect(page.getByText(/Continue to PPRC|Sign in/i).first()).toBeVisible();
});

test("a player signs in with a ticket and sees their own PPRC rating", async ({ browser }) => {
  const page = await signedIn(browser, "alex");
  await page.goto("/me/rating");
  await expect(page.getByTestId("my-rating-page")).toBeVisible();
  await expect(page.getByTestId("rating-card-singles")).toContainText("PPRC singles rating");
  await expect(page.getByTestId("player-name")).toContainText("Alex");
});

test("a player sees challenges and fair matches but not the admin members page", async ({ browser }) => {
  const page = await signedIn(browser, "alex");
  await page.goto("/me/matches");
  await expect(page.getByTestId("my-matches-page")).toBeVisible();
  await expect(page.getByTestId("challenges-list").or(page.getByTestId("challenges-empty"))).toBeVisible();
  await expect(page.getByTestId("fair-matches").or(page.getByTestId("fair-matches-empty"))).toBeVisible();
  await page.goto("/admin/members");
  await expect(page.getByTestId("members-roles")).toHaveCount(0);
});

test("a club admin signs in and manages roles, email preview and challenge settings", async ({ browser }) => {
  const page = await signedIn(browser, "blair");
  await page.goto("/admin/members");
  await expect(page.getByTestId("members-roles")).toBeVisible();
  await expect(page.getByTestId(`role-select-${tickets.alex.user_id}`)).toHaveValue("player");
  await expect(page.getByTestId("email-preview-frame")).toBeVisible();
  await expect(page.getByTestId("preview-meta")).toContainText("Subject:");
  await expect(page.getByTestId("challenge-expiry-input")).toBeVisible();
  await expect(page.getByTestId("challenge-expiry-mode")).toBeVisible();
});

test("head to head between the two signed-in testers loads with share buttons", async ({ browser }) => {
  const page = await signedIn(browser, "alex");
  await page.goto(`/players/${tickets.alex.user_id}/vs/${tickets.blair.user_id}`);
  await expect(page.getByTestId("rivalry-page")).toBeVisible();
  await expect(page.getByTestId("h2h-score")).toBeVisible();
  await expect(page.getByTestId("h2h-share-card")).toBeVisible();
});
