import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { allPages } from "../../lib/nav";
import { CURRENT_PHASE } from "../../lib/admin-sections";
import { adminClient, loginAs, signInWithMagicLink, TEST_USERS } from "./support/users";

/**
 * App shell, signed-in as the Owner (storage state from auth.setup.ts) unless a
 * test signs in fresh with `loginAs`. Anything that changes session state
 * (View as, sign out) must use its own fresh session, never the shared one.
 */

const SIGNED_OUT = { cookies: [], origins: [] };
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("app shell (owner)", () => {
  test("home renders the shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Brushy Bear CRM home" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Help" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("desktop nav has every top-level item and dropdown", async ({ page }) => {
    test.skip(isMobile(page), "desktop only");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    // The Attention link carries a "needs attention now" count.
    await expect(nav.getByRole("link", { name: /^Attention\b/ })).toBeVisible();
    for (const label of ["Leads", "Jobs", "Schedule", "More", "Admin"]) {
      await expect(nav.getByRole("button", { name: label })).toBeVisible();
    }

    await nav.getByRole("button", { name: "Leads" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /Lead Dashboard/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Lead List/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /New Lead/ })).toBeVisible();
    // Shows the newest leads, or an empty note; which one depends on other specs' data.
    await expect(menu.getByText("Recent leads", { exact: true })).toBeVisible();

    await menu.getByRole("menuitem", { name: /Lead List/ }).click();
    await expect(page).toHaveURL(/\/leads\/list$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lead List" })).toBeVisible();
  });

  test("integrations pill shows 0 of 11 connected and links to Integrations", async ({ page }) => {
    test.skip(isMobile(page), "pill is hidden on small screens");
    await page.goto("/");
    const pill = page.getByRole("link", { name: "0 of 11 connected" });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page).toHaveURL(/\/admin\/integrations$/);
  });

  test("Ctrl+K opens universal search with scopes", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Search" })).toBeFocused();
    for (const scope of ["All", "Accounts", "Contacts", "Leads", "Jobs", "Invoices", "Mentions"]) {
      await expect(dialog.getByRole("radio", { name: scope })).toBeVisible();
    }
    await dialog.getByRole("combobox", { name: "Search" }).fill("master schedule");
    await dialog.getByRole("option", { name: /Master Schedule/ }).click();
    await expect(page).toHaveURL(/\/schedule\/master$/);
  });

  test("mobile menu opens and navigates", async ({ page }) => {
    test.skip(!isMobile(page), "mobile only");
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("link", { name: "Production Center" }).click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("unknown routes show the 404 page", async ({ page }) => {
    const res = await page.goto("/not-a-real-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("every nav route renders for the owner", async ({ page }) => {
    test.skip(isMobile(page), "same pages on mobile; checked once");
    test.setTimeout(120_000);
    for (const p of allPages()) {
      const res = await page.goto(p.href);
      expect(res?.status(), p.href).toBe(200);
      if (p.phase > CURRENT_PHASE) {
        await expect(page.getByRole("heading", { level: 1, name: p.label }), p.href).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { level: 1 }).first(), p.href).toBeVisible();
      }
    }
  });
});

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("app pages redirect to login and keep the destination", async ({ page }) => {
    await page.goto("/admin/company");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fcompany$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("login screen", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByText("Eastside house painting that holds up to the rain."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("magic-link request answers the same for unknown emails", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: /email/i }).fill("nobody@test.brushybear.local");
    await page.getByRole("button", { name: /email me a sign-in link/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  test("design system page is public", async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
    await expect(page.getByText("Walkthrough Scheduled")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Crew" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a signed-in account with no CRM profile sees No access", async ({ page }) => {
    const admin = adminClient();
    const email = `e2e-noaccess-${Math.random().toString(36).slice(2, 8)}@test.brushybear.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("createUser failed");
    try {
      await signInWithMagicLink(page, email);
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(page.getByRole("heading", { name: "No access yet" })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      expect((await page.goto("/admin"))?.url()).toMatch(/\/no-access$/);
    } finally {
      await admin.auth.admin.deleteUser(data.user.id);
    }
  });
});

test.describe("roles", () => {
  test.use({ storageState: SIGNED_OUT });

  test("owner must pass two-step sign-in before the app opens", async ({ page }) => {
    await signInWithMagicLink(page, TEST_USERS.owner.email);
    await expect(page).toHaveURL(/\/mfa$/);
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/mfa$/);
  });

  test("painter gets the crew view without Admin", async ({ page }) => {
    await loginAs(page, "painter");
    await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
    if (isMobile(page)) {
      await expect(page.getByRole("navigation", { name: "Crew" })).toBeVisible();
    } else {
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("button", { name: "Admin" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /of 11 connected/ })).toHaveCount(0);
    }
    for (const path of ["/admin", "/admin/users", "/admin/company", "/leads/list"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("office manager sees Admin but not owner-only sections", async ({ page }) => {
    await loginAs(page, "office_manager", "/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Setup" })).toBeVisible();
    expect((await page.goto("/admin/roles"))?.status()).toBe(404);
  });

  test("owner can View as a painter read-only, then exit", async ({ page }) => {
    test.skip(isMobile(page), "View as is a desktop tool");
    await loginAs(page, "owner");
    await page.getByRole("button", { name: "View as user" }).click();
    const dialog = page.getByRole("dialog", { name: "View as user" });
    await dialog.getByRole("textbox", { name: "Search people" }).fill(TEST_USERS.painter.fullName);
    await dialog.getByRole("button", { name: new RegExp(TEST_USERS.painter.fullName) }).click();

    const banner = page.getByRole("status").filter({ hasText: "Viewing as" });
    await expect(banner).toContainText(TEST_USERS.painter.fullName);
    await expect(banner).toContainText("read-only");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("button", { name: "Admin" })).toHaveCount(0);
    expect((await page.goto("/admin/company"))?.status()).toBe(404);

    await page.goto("/");
    await banner.getByRole("button", { name: "Exit view as" }).click();
    await expect(banner).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Admin" })).toBeVisible();
  });
});

test.describe("accessibility (axe)", () => {
  const scan = async (page: Page) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    return results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  };

  for (const path of ["/", "/leads", "/leads/list", "/admin", "/admin/company", "/dev/ui"]) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await scan(page)).toEqual([]);
    });
  }

  test.describe("signed-out pages", () => {
    test.use({ storageState: SIGNED_OUT });
    test("no serious or critical violations on /login", async ({ page }) => {
      await page.goto("/login");
      expect(await scan(page)).toEqual([]);
    });
    test("no serious or critical violations on /mfa", async ({ page }) => {
      await signInWithMagicLink(page, TEST_USERS.bookkeeper.email);
      await expect(page).toHaveURL(/\/mfa$/);
      expect(await scan(page)).toEqual([]);
    });
  });
});
