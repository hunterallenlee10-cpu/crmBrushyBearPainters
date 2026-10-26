import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";

/**
 * Screenshots for the phase report (SPEC §17). Saved to docs/screens/phase-N/.
 * Run with `pnpm screens` (PHASE defaults to 0).
 */
const PHASE = process.env.PHASE ?? "0";
const OUT = join(process.cwd(), "docs", "screens", `phase-${PHASE}`);
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: "disabled" });
}

test.describe.configure({ mode: "serial" });

// Open menus instantly so screenshots never catch a fade-in midway.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("desktop: home shell", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await shot(page, "desktop-home");
});

test("desktop: leads dropdown with recent items", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Leads" })
    .click();
  await page.getByRole("menu").waitFor();
  await shot(page, "desktop-leads-dropdown");
});

test("desktop: more dropdown", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "More" })
    .click();
  await page.getByRole("menu").waitFor();
  await shot(page, "desktop-more-dropdown");
});

test("desktop: universal search", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor();
  await shot(page, "desktop-search");
});

test("desktop: notifications and user menu", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByText("You're all caught up.").waitFor();
  await shot(page, "desktop-notifications");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menu").waitFor();
  await shot(page, "desktop-user-menu");
});

test("desktop: help panel", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("dialog").waitFor();
  await shot(page, "desktop-help");
});

test("desktop: placeholder page", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/schedule/master");
  await shot(page, "desktop-placeholder-master-schedule");
});

test("desktop: login", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await shot(page, "desktop-login");
});

test("desktop: design system", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/dev/ui");
  await shot(page, "desktop-design-system", true);
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

test("mobile: login", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/login");
  await shot(page, "mobile-login");
});

test("mobile: design system (crew tab bar)", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/dev/ui");
  await shot(page, "mobile-design-system", true);
});
