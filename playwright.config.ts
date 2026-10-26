import { defineConfig, devices } from "@playwright/test";

// Local runs read Supabase settings from .env.local (CI sets them in the job).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — CI or a deliberately empty environment
}

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const OWNER_STATE = "tests/e2e/.auth/owner.json";

/**
 * Projects:
 *  - setup: creates one test user per role on the local Supabase stack and signs them in
 *  - e2e-desktop / e2e-mobile: behavior + accessibility checks (`pnpm test:e2e`), as the owner by default
 *  - screens: screenshots saved to docs/screens/phase-N/ (`pnpm screens`)
 *
 * Requires the local Supabase stack (`pnpm supabase start`). CI runs against
 * `next start` after `next build`; locally the dev server is used (or reuse one).
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
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "e2e-desktop",
      testIgnore: /(screens\.spec|auth\.setup)\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: OWNER_STATE,
      },
    },
    {
      name: "e2e-mobile",
      testIgnore: /(screens\.spec|auth\.setup)\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: OWNER_STATE },
    },
    {
      name: "screens",
      testMatch: /screens\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: OWNER_STATE },
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
