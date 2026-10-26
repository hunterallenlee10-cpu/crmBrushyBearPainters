import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginAs, signInWithMagicLink, TEST_USERS } from "./support/users";

/**
 * Screenshots for the phase report (SPEC §17). Saved to docs/screens/phase-N/.
 * Run with `pnpm screens` (PHASE defaults to 1). Signed in as the Owner unless
 * a test signs in fresh.
 */
const PHASE = process.env.PHASE ?? "1";
const OUT = join(process.cwd(), "docs", "screens", `phase-${PHASE}`);
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SIGNED_OUT = { cookies: [], origins: [] };

async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: "disabled" });
}

test.describe.configure({ mode: "serial" });

// Open menus instantly so screenshots never catch a fade-in midway.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("owner", () => {
  test("desktop: home shell", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await shot(page, "desktop-home");
  });

  test("desktop: admin dropdown", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Admin" })
      .click();
    await page.getByRole("menu").waitFor();
    await shot(page, "desktop-admin-dropdown");
  });

  test("desktop: user menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menu").waitFor();
    await shot(page, "desktop-user-menu");
  });

  test("desktop: setup hub", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin");
    await shot(page, "desktop-admin-setup", true);
  });

  test("desktop: company settings", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/admin/company");
    await shot(page, "desktop-company-settings", true);
  });

  test("mobile: home shell", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await shot(page, "mobile-home");
  });

  test("mobile: menu", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").waitFor();
    await shot(page, "mobile-menu");
  });
});

test.describe("sign-in and access", () => {
  test.use({ storageState: SIGNED_OUT });

  test("desktop + mobile: login", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/login");
    await shot(page, "desktop-login");
    await page.setViewportSize(MOBILE);
    await page.goto("/login");
    await shot(page, "mobile-login");
  });

  test("desktop: login, link sent", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/login");
    await page.getByRole("textbox", { name: /email/i }).fill("someone@test.brushybear.local");
    await page.getByRole("button", { name: /email me a sign-in link/i }).click();
    await page.getByText(/check your email/i).waitFor();
    await shot(page, "desktop-login-sent");
  });

  test("mobile: two-step sign-in challenge", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await signInWithMagicLink(page, TEST_USERS.bookkeeper.email);
    await expect(page).toHaveURL(/\/mfa$/);
    await shot(page, "mobile-mfa-challenge");
  });

  test("desktop: no access", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const admin = adminClient();
    const email = `e2e-noaccess-${Math.random().toString(36).slice(2, 8)}@test.brushybear.local`;
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    try {
      await signInWithMagicLink(page, email);
      await expect(page).toHaveURL(/\/no-access$/);
      await shot(page, "desktop-no-access");
    } finally {
      if (data.user) await admin.auth.admin.deleteUser(data.user.id);
    }
  });

  test("mobile: painter crew view", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await loginAs(page, "painter");
    await page.getByRole("navigation", { name: "Crew" }).waitFor();
    await shot(page, "mobile-painter-home");
  });

  test("desktop: owner viewing as a painter", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "owner");
    await page.getByRole("button", { name: "View as user" }).click();
    const dialog = page.getByRole("dialog", { name: "View as user" });
    await dialog.getByRole("list", { name: "Users" }).waitFor();
    await shot(page, "desktop-view-as-picker");
    await dialog.getByRole("textbox", { name: "Search people" }).fill(TEST_USERS.painter.fullName);
    await dialog.getByRole("button", { name: new RegExp(TEST_USERS.painter.fullName) }).click();
    const banner = page.getByRole("status").filter({ hasText: "Viewing as" });
    await banner.waitFor();
    await shot(page, "desktop-view-as-banner");
    await banner.getByRole("button", { name: "Exit view as" }).click();
    await expect(banner).toHaveCount(0);
  });
});
