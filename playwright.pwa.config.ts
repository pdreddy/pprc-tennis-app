import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "tests",
  testMatch: "pwa.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command:
      "pnpm --filter @pprc/web build && pnpm --filter @pprc/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    env: {
      VITE_USE_EMULATORS: "true",
      VITE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_PROJECT_ID: "demo-pprc-events",
      VITE_FIREBASE_API_KEY: "demo-pprc-events",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-pprc-events.firebaseapp.com",
      VITE_FIREBASE_STORAGE_BUCKET: "demo-pprc-events.appspot.com",
      VITE_FIREBASE_APP_ID: "1:123:web:demo",
    },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [{ name: "pwa-chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"]],
});
