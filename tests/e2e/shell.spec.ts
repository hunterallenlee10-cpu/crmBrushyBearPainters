import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { allPages } from "../../lib/nav";

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("app shell", () => {
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
    for (const label of ["Home", "Attention"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    for (const label of ["Leads", "Jobs", "Schedule", "More", "Admin"]) {
      await expect(nav.getByRole("button", { name: label })).toBeVisible();
    }

    await nav.getByRole("button", { name: "Leads" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /Lead Dashboard/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Lead List/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /New Lead/ })).toBeVisible();
    await expect(menu.getByText("No recent leads yet.")).toBeVisible();

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
    await expect(page.getByRole("heading", { level: 1, name: "Production Center" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("unknown routes show the 404 page", async ({ page }) => {
    const res = await page.goto("/not-a-real-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("every nav route renders", () => {
  test("all placeholder pages return 200 with their title", async ({ page }) => {
    test.skip(isMobile(page), "same pages on mobile; checked once");
    for (const p of allPages()) {
      const res = await page.goto(p.href);
      expect(res?.status(), p.href).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: p.label }), p.href).toBeVisible();
    }
  });
});

test.describe("brand pages", () => {
  test("login screen", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByText("Eastside house painting that holds up to the rain."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });

  test("design system page", async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
    await expect(page.getByText("Walkthrough Scheduled")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Crew" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("accessibility (axe)", () => {
  for (const path of ["/", "/leads/list", "/login", "/dev/ui"]) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    });
  }
});
