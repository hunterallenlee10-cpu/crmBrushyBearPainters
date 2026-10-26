import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Projects:
 *  - e2e-desktop / e2e-mobile: behavior + accessibility checks (`pnpm test:e2e`)
 *  - screens: screenshots saved to docs/screens/phase-N/ (`pnpm screens`)
 *
 * CI runs against `next start` after `next build`; locally the dev server is used
 * (or reuse a server you already started).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  },
  projects: [
    {
      name: "e2e-desktop",
      testIgnore: /screens\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "e2e-mobile",
      testIgnore: /screens\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "screens",
      testMatch: /screens\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
