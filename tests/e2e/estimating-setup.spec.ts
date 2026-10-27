import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminClient, loginAs } from "./support/users";

/**
 * Phase 4 setup screens (SPEC §8.12, §8.19): Price Book, Paint Catalog,
 * Production Rates, Estimate Setup, Agreement Templates and the Estimates
 * list. Rows this spec adds are removed afterwards; the seeded sample rows
 * are only looked at (saving them would mark them calibrated).
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-4";
const code = `e2e_item_${t}`;
const paintName = `E2E Test Paint ${t}`;

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const db = adminClient();
  await db.from("catalog_items").delete().eq("code", code);
  await db.from("paint_products").delete().eq("product", paintName);
});

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    ),
  ).toEqual([]);
}

const desktop = (name: string) => name === "e2e-desktop";

test("Price Book: the sample catalog, search, and adding an item", async ({ page }, info) => {
  await page.goto("/price-book");
  await expect(page.getByRole("heading", { name: "Price Book", level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /Default/ })
    .first()
    .click();
  await page.waitForURL(/\/price-book\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Sample").first()).toBeVisible();
  await page.getByLabel("Search the catalog").fill("cedar");
  await expect(page.getByRole("button", { name: /cedar/i }).first()).toBeVisible();
  await page.getByLabel("Search the catalog").fill("");
  if (desktop(info.project.name)) {
    await page.screenshot({ path: `${SCREENS}/price-book-desktop.png` });
    await page.getByRole("button", { name: "New item" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Name").fill(`Garage floor line ${t}`);
    await d.getByLabel("Code").fill(code);
    await d.getByLabel("Pricing").selectOption("flat");
    await d.getByLabel("Price per unit ($)").fill("2.75");
    await d.getByRole("button", { name: "Save item" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("Search the catalog").fill(code);
    await expect(page.getByRole("button", { name: `Garage floor line ${t}` })).toBeVisible();
  } else {
    await page.screenshot({ path: `${SCREENS}/price-book-mobile.png`, fullPage: true });
  }
  await axe(page);
});

test("Paint catalog and production rates", async ({ page }, info) => {
  await page.goto("/price-book/paint");
  await expect(page.getByRole("link", { name: "Paint catalog" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("sq ft/gal").first()).toBeVisible();
  if (desktop(info.project.name)) {
    await page.getByRole("button", { name: "New paint product" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Product").fill(paintName);
    await d.getByLabel("Our cost per gallon ($)").fill("41.50");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(paintName) })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/paint-catalog-desktop.png` });
  }
  await axe(page);

  await page.goto("/price-book/rates");
  await expect(
    page.getByText(/rates are still samples|Every rate has been calibrated/),
  ).toBeVisible();
  await page.getByLabel("Surface").selectOption("int_walls");
  await page.waitForURL(/surface=int_walls/);
  await expect(
    page.getByRole("textbox", { name: /Units per labor hour, Brush & roll, Good/ }),
  ).toBeVisible();
  if (desktop(info.project.name))
    await page.screenshot({ path: `${SCREENS}/production-rates-desktop.png` });
  await axe(page);
});

test("Admin: Estimate Setup and Agreement Templates", async ({ page }, info) => {
  await page.goto("/admin/estimate-setup");
  await expect(page.getByRole("heading", { name: "Estimate Setup", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Loaded labor rate ($ per hour)")).toBeVisible();
  await expect(page.getByRole("form", { name: "What's included: Exterior" })).toContainText(
    "From the website",
  );
  if (desktop(info.project.name)) {
    await page.screenshot({ path: `${SCREENS}/admin-estimate-setup-desktop.png` });
  }
  await axe(page);

  await page.goto("/admin/agreements");
  await expect(page.getByRole("heading", { name: "Agreement Templates", level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /Contract/ })
    .first()
    .click();
  await page.waitForURL(/\/admin\/agreements\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/slots? still to fill/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  if (desktop(info.project.name)) {
    await page.screenshot({ path: `${SCREENS}/admin-agreement-template-desktop.png` });
  }
  await axe(page);
});

test("Estimates list with its KPIs", async ({ page }, info) => {
  await page.goto("/estimates");
  await expect(page.getByRole("heading", { name: "Estimates", level: 1 })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Estimate KPIs" });
  await expect(kpis.getByText("Close Rate", { exact: true })).toBeVisible();
  await expect(kpis.getByText("24h Estimate SLA")).toBeVisible();
  await page.screenshot({
    path: `${SCREENS}/estimates-${desktop(info.project.name) ? "desktop" : "mobile"}.png`,
  });
  await axe(page);
});

test("an estimator can't open the setup screens", async ({ page }, info) => {
  test.skip(!desktop(info.project.name), "Role check once.");
  await loginAs(page, "estimator", "/admin/estimate-setup");
  await expect(page.getByRole("heading", { name: /not found|couldn't find/i })).toBeVisible();
  await page.goto("/price-book");
  await expect(page.getByRole("heading", { name: "Price Book", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "New price book" })).toHaveCount(0);
});
