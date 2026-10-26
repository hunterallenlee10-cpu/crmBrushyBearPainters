import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as setup, expect } from "@playwright/test";
import {
  TEST_USERS,
  completeMfa,
  resetTestUsers,
  signInWithMagicLink,
  type TestRole,
} from "./support/users";

/**
 * Creates one test user per role on the LOCAL Supabase stack, signs each in
 * through the real magic-link route (and MFA for Owner/Bookkeeper), and saves
 * their sessions for the other specs.
 */
export const AUTH_DIR = join(process.cwd(), "tests", "e2e", ".auth");

setup("sign in test users", async ({ browser }, testInfo) => {
  setup.setTimeout(120_000);
  mkdirSync(AUTH_DIR, { recursive: true });
  await resetTestUsers();
  const secrets: Partial<Record<TestRole, string>> = {};

  for (const role of Object.keys(TEST_USERS) as TestRole[]) {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const page = await context.newPage();
    await signInWithMagicLink(page, TEST_USERS[role].email);
    if (role === "owner" || role === "bookkeeper") secrets[role] = await completeMfa(page);
    await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
    await context.storageState({ path: join(AUTH_DIR, `${role}.json`) });
    await context.close();
  }
  writeFileSync(join(AUTH_DIR, "secrets.json"), JSON.stringify(secrets));
});
