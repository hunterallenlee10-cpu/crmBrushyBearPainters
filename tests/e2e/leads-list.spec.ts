import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminClient, loginAs, TEST_USERS } from "./support/users";

/**
 * Lead List (SPEC §8.4) and the shared list framework: search, tabs, chips,
 * sort, Advanced filter, saved views, columns, bulk actions, preview, scope.
 */

const tag = () => randomUUID().slice(0, 6);
const seeded: string[] = [];

async function userId(email: string): Promise<string> {
  const { data } = await adminClient().from("profiles").select("id").eq("email", email).single();
  return data!.id;
}

async function seedLead(fields: Record<string, unknown>): Promise<string> {
  const { data: org } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  const { data, error } = await adminClient()
    .from("leads")
    .insert({ org_id: org!.id, lead_source: "website", ...fields })
    .select("id")
    .single();
  if (error) throw error;
  seeded.push(data.id);
  return data.id;
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.afterAll(async () => {
  if (!seeded.length) return;
  const db = adminClient();
  await db.from("activity").delete().eq("subject_type", "lead").in("subject_id", seeded);
  await db.from("leads").delete().in("id", seeded);
});

test.describe("Lead List", () => {
  test.describe.configure({ mode: "serial" });
  const t = tag();
  const names = { hot: `Hana Hot${t}`, door: `Ned Door${t}`, cold: `Cole Cold${t}` };

  test.beforeAll(async () => {
    const owner = await userId(TEST_USERS.owner.email);
    await seedLead({
      first_name: names.hot.split(" ")[0],
      last_name: names.hot.split(" ")[1],
      email: `hot${t}@example.com`,
      zip: "98033",
      temperature: "hot",
      score: 92,
      grade: "A",
      owner_id: owner,
    });
    await seedLead({
      first_name: names.door.split(" ")[0],
      last_name: names.door.split(" ")[1],
      mobile: "+14255557301",
      lead_source: "nextdoor",
      temperature: "warm",
      score: 66,
      grade: "C",
    });
    await seedLead({
      first_name: names.cold.split(" ")[0],
      last_name: names.cold.split(" ")[1],
      email: `cold${t}@example.com`,
      temperature: "cold",
      score: 31,
      grade: "F",
      status: "nurture",
    });
  });

  test("search, tabs, chips, sort and preview", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await page.goto(`/leads/list?q=${t}`);
    await page.locator('[data-list-ready="true"]').waitFor();
    await expect(page.getByRole("heading", { level: 1, name: "Lead List" })).toBeVisible();
    const table = page.getByRole("table");
    for (const n of Object.values(names))
      await expect(table.getByRole("link", { name: n })).toBeVisible();

    await page.getByRole("button", { name: /^New\b/ }).click();
    await expect(page).toHaveURL(/tab=new/);
    await expect(table.getByRole("link", { name: names.cold })).toHaveCount(0); // nurture isn't New

    await page.getByRole("button", { name: /^All\b/ }).click();
    await page.getByRole("button", { name: "🔥 Hot", pressed: false }).click();
    await expect(page).toHaveURL(/chips=hot/);
    await expect(table.getByRole("link", { name: names.hot })).toBeVisible();
    await expect(table.getByRole("link", { name: names.door })).toHaveCount(0);
    await page.getByRole("button", { name: "🔥 Hot", pressed: true }).click();

    await page.getByRole("button", { name: "Score" }).click();
    await expect(page.getByRole("columnheader", { name: /Score/ })).toHaveAttribute(
      "aria-sort",
      /descending|ascending/,
    );

    await page.getByRole("button", { name: `Preview ${names.door}` }).click();
    const drawer = page.getByRole("dialog", { name: names.door });
    await expect(drawer.getByRole("link", { name: "Open lead" })).toBeVisible();
    await expect(drawer.getByText("(425) 555-7301")).toBeVisible();
  });

  test("Advanced filter, saved view and columns", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await page.goto(`/leads/list?tab=all&q=${t}`);
    await page.locator('[data-list-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Advanced" }).click();
    const dialog = page.getByRole("dialog", { name: "Advanced filter" });
    await dialog.getByRole("combobox", { name: "Rule 1 field" }).selectOption({ label: "Source" });
    await dialog
      .getByRole("combobox", { name: "Rule 1 value" })
      .selectOption({ label: "Nextdoor" });
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/[?&]f=/);
    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: names.door })).toBeVisible();
    await expect(table.getByRole("link", { name: names.hot })).toHaveCount(0);

    // Save the view, leave, come back through the Views menu.
    const viewName = `E2E view ${t}`;
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    await page.getByLabel("Name").fill(viewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page).toHaveURL(/view=/);
    await page.goto("/leads/list");
    await page.locator('[data-list-ready="true"]').waitFor();
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: viewName }).click();
    await expect(page.getByRole("table").getByRole("link", { name: names.door })).toBeVisible();
    await page.getByRole("button", { name: viewName }).click();
    await page.getByRole("menuitem", { name: `Delete “${viewName}”` }).click();
    await expect(page.getByText(`Deleted “${viewName}”.`)).toBeVisible();

    // Hide the Contact column, then reset.
    await page.goto(`/leads/list?q=${t}`);
    await page.locator('[data-list-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Columns" }).click();
    const cols = page.getByRole("dialog", { name: "Columns" });
    await cols.getByRole("checkbox", { name: "Contact" }).uncheck();
    await cols.getByRole("button", { name: "Save columns" }).click();
    await expect(page.getByRole("columnheader", { name: "Contact" })).toHaveCount(0);
    await page.getByRole("button", { name: "Columns" }).click();
    await page
      .getByRole("dialog", { name: "Columns" })
      .getByRole("button", { name: "Reset to default" })
      .click();
    await expect(page.getByRole("columnheader", { name: "Contact" })).toBeVisible();
  });

  test("bulk assign and status change", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await page.goto(`/leads/list?tab=all&q=${t}`);
    await page.locator('[data-list-ready="true"]').waitFor();
    await page.getByRole("checkbox", { name: `Select ${names.door}` }).check();
    await page.getByRole("checkbox", { name: `Select ${names.cold}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Assign" }).click();
    await page
      .getByLabel(/Assign 2 to/)
      .selectOption({ label: TEST_USERS.office_manager.fullName });
    await page.getByRole("button", { name: "Assign", exact: true }).last().click();
    await expect(page.getByText(/Assigned 2 leads/)).toBeVisible();

    const office = await userId(TEST_USERS.office_manager.email);
    const { data } = await adminClient()
      .from("leads")
      .select("owner_id")
      .in("id", seeded.slice(1, 3));
    expect(data?.every((r) => r.owner_id === office)).toBe(true);

    await page.getByRole("checkbox", { name: `Select ${names.door}` }).check();
    await page
      .getByRole("region", { name: "Bulk actions" })
      .getByRole("combobox", { name: "Change status" })
      .selectOption("contacted");
    await expect(page.getByText(/Updated 1 lead/)).toBeVisible();
    const { data: door } = await adminClient()
      .from("leads")
      .select("status")
      .eq("id", seeded[1]!)
      .single();
    expect(door?.status).toBe("contacted");
  });

  test("estimators see only their own leads; painters can't open the list", async ({ page }) => {
    await loginAs(page, "estimator", `/leads/list?tab=all&q=${t}`);
    await expect(page.getByRole("heading", { level: 1, name: "Lead List" })).toBeVisible();
    await expect(page.getByText("No leads match these filters")).toBeVisible();
    await loginAs(page, "painter", "/leads/list");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("fits a phone screen and passes axe", async ({ page }) => {
    await page.goto(`/leads/list?q=${t}`);
    await page.locator('[data-list-ready="true"]').waitFor();
    await expect(page.getByRole("heading", { level: 1, name: "Lead List" })).toBeVisible();
    await noSideScroll(page);
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
});
