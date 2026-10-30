import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "pnpm --filter @pprc/web exec vite --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    // Firebase's local emulator wrapper sets CI=1 even on a developer
    // machine. Permit the explicit local runner to reuse a Vite server.
    reuseExistingServer: process.env.PPRC_REUSE_DEV_SERVER === "1" || !process.env.CI,
    timeout: 60000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"], ["html", { open: "never" }]],
});
