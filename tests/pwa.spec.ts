import { test, expect } from "@playwright/test";
test("production PWA manifest, icons, worker and offline shell", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "More than a match. A place to belong.",
    }),
  ).toBeVisible();
  const manifest = await page.evaluate(async () =>
    (await fetch("/manifest.webmanifest")).json(),
  );
  expect(manifest.display).toBe("standalone");
  expect(manifest.short_name).toBe("PPRC Sports");
  expect(manifest.icons.some((i: any) => i.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((i: any) => i.sizes === "512x512")).toBe(true);
  for (const icon of ["/icon-192.png", "/icon-512.png"])
    expect((await page.request.get(icon)).status()).toBe(200);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "More than a match. A place to belong.",
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(false);
});
