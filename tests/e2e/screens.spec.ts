import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginAs, signInWithMagicLink, TEST_USERS } from "./support/users";

/**
 * Screenshots for the phase report (SPEC §17). Saved to docs/screens/phase-N/.
 * Run with `pnpm screens` (`PHASE=2 pnpm screens`; PHASE defaults to 1). Signed in as the Owner unless
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
  test.skip(PHASE !== "1", "Phase 1 screens");
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
  test.skip(PHASE !== "1", "Phase 1 screens");
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
    await page
      .getByRole("textbox", { name: "Email for a sign-in link" })
      .fill("someone@test.brushybear.local");
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

/**
 * Phase 2: leads. Seeds a handful of obviously fake sample leads (example.com,
 * 425-555 numbers) so the list isn't empty, and deletes them afterwards.
 */
test.describe("phase 2: leads", () => {
  test.skip(PHASE !== "2", "Phase 2 screens");
  const seeded: string[] = [];
  const SAMPLES = [
    ["Avery", "Kirkland", "98033", "website", "new", 88, "B", "hot", ["exterior"]],
    ["Jordan", "Bellevue", "98004", "google_ads", "contacted", 74, "C", "warm", ["interior"]],
    [
      "Riley",
      "Redmond",
      "98052",
      "nextdoor",
      "walkthrough_scheduled",
      81,
      "B",
      "warm",
      ["exterior", "deck_fence"],
    ],
    ["Morgan", "Sammamish", "98074", "customer_referral", "new", 93, "A", "hot", ["exterior"]],
    ["Casey", "Issaquah", "98027", "facebook_instagram", "nurture", 42, "F", "cold", ["cabinets"]],
    ["Quinn", "Woodinville", "98072", "website", "new", 67, "C", "warm", ["interior"]],
  ] as const;

  test.beforeAll(async () => {
    const db = adminClient();
    const { data: org } = await db
      .from("organizations")
      .select("id")
      .eq("slug", "brushy-bear")
      .single();
    for (const [
      i,
      [first, city, zip, source, status, score, grade, temperature, services],
    ] of SAMPLES.entries()) {
      const { data, error } = await db
        .from("leads")
        .insert({
          org_id: org!.id,
          first_name: first,
          last_name: "Sample",
          email: `${first.toLowerCase()}.sample@example.com`,
          mobile: `+1425555${String(140 + i).padStart(4, "0")}`,
          city,
          state: "WA",
          zip,
          lead_source: source,
          status,
          score,
          grade,
          temperature,
          services: [...services],
          created_at: new Date(Date.now() - i * 26 * 3_600_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      seeded.push(data.id);
    }
  });

  test.afterAll(async () => {
    if (!seeded.length) return;
    const db = adminClient();
    await db.from("activity").delete().eq("subject_type", "lead").in("subject_id", seeded);
    await db.from("leads").delete().in("id", seeded);
  });

  test("desktop: lead list", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/leads/list?q=Sample");
    await page.locator('[data-list-ready="true"]').waitFor();
    await shot(page, "leads-list");
    await page.getByRole("button", { name: `Preview Avery Sample` }).click();
    await page.getByRole("dialog", { name: "Avery Sample" }).waitFor();
    await shot(page, "leads-list-preview");
  });

  test("desktop: advanced filter", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/leads/list?q=Sample");
    await page.locator('[data-list-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Advanced" }).click();
    const dialog = page.getByRole("dialog", { name: "Advanced filter" });
    await dialog.getByRole("combobox", { name: "Rule 1 field" }).selectOption({ label: "Score" });
    await shot(page, "leads-list-advanced-filter");
  });

  test("desktop: search and leads menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Search" }).fill("Sample");
    await dialog.getByRole("option", { name: /Avery Sample/ }).waitFor();
    await shot(page, "desktop-search-records");
    await page.keyboard.press("Escape");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Leads" })
      .click();
    await page.getByRole("menu").waitFor();
    await shot(page, "desktop-leads-menu");
  });

  test("mobile: lead list", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/leads/list?q=Sample");
    await page.locator('[data-list-ready="true"]').waitFor();
    await shot(page, "mobile-leads-list");
  });
});
