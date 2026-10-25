import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.setTimeout(600000);

async function login(page: Page, uid: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(`${uid}@pprc.test`);
  await page.getByLabel("Password", { exact: true }).fill("PprcDemo2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/my-events/);
}

// Every reachable screen for each role. Each route must load without an
// uncaught error and must not have serious or critical WCAG 2.2 AA violations.
const routes: [string, string[]][] = [
  [
    "guest",
    [
      "/",
      "/events",
      "/signin",
      "/results",
      "/players",
      "/clubs/pprc",
      "/rankings",
    ],
  ],
  [
    "player1",
    [
      "/",
      "/my-events",
      "/profile",
      "/schedule",
      "/teams",
      "/dashboard",
      "/notifications",
      "/rankings",
      "/players",
      "/results",
      "/clubs/pprc",
    ],
  ],
  [
    "admin",
    [
      "/admin",
      "/admin/events",
      "/admin/courts",
      "/admin/club",
      "/admin/members",
      "/admin/audit",
      "/admin/operations",
      "/admin/events/new",
    ],
  ],
];

for (const [role, paths] of routes) {
  test(`${role} routes load cleanly and pass automated accessibility checks`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const uncaught: string[] = [];
    page.on("pageerror", (e) => uncaught.push(e.message));
    if (role !== "guest")
      await login(page, role === "admin" ? "admin" : "player1");
    const problems: string[] = [];
    for (const path of paths) {
      uncaught.length = 0;
      await page.goto(path);
      await expect(page.locator("main, h1").first()).toBeVisible();
      // Firebase keeps connections open, so "networkidle" never settles.
      await page.waitForLoadState("load");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) =>
        ["serious", "critical"].includes(String(v.impact)),
      );
      for (const v of serious)
        problems.push(
          `${path}: ${v.id} (${v.impact}) — ${v.nodes
            .slice(0, 4)
            .map(
              (n) =>
                `${n.target.join(" ")} [${n.failureSummary?.split("\n").pop()}]`,
            )
            .join(" | ")}`,
        );
      if (uncaught.length)
        problems.push(`${path}: uncaught error — ${uncaught[0]}`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
    await context.close();
  });
}
