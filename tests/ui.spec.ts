import { test, expect } from "@playwright/test";
test("original PPRC discovery shell and mobile navigation remain usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "More than a match. A place to belong.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Find your next event" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByLabel("Maximum price ($)")).toBeVisible();
  await page.getByLabel("Search events").fill("Prosper");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Schedule" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("unauthenticated registration and administration require sign-in", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Your next match starts here" }),
  ).toBeVisible();
  await page.goto("/register/prosper-open/prosper-open-singles");
  await expect(
    page.getByRole("heading", { name: "Your next match starts here" }),
  ).toBeVisible();
});
test("sign-in has labeled controls, validation, and an accessible mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signin");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("invalid");
  expect(
    await page
      .getByLabel("Email", { exact: true })
      .evaluate((el: HTMLInputElement) => el.validity.typeMismatch),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/pprc-mobile-signin.png",
    fullPage: true,
  });
});
test("mobile bottom navigation is shown on phones and hidden on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(nav).toBeHidden();
});
