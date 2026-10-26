import { mkdirSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { adminClient, createThrowawayUser, loginAs } from "./support/users";

/**
 * Admin → Roles & Permissions (SPEC §4.2). Every test signs in fresh and only
 * changes its own custom templates/packs (random names) — never the seeded ones.
 */

test.use({ storageState: { cookies: [], origins: [] } });
// The shared dev server compiles these routes on first visit, and other specs sign the
// same owner in and out, so allow slow navigations and one retry for a lost session.
test.describe.configure({ timeout: 120_000, retries: 1 });
const expect = baseExpect.configure({ timeout: 20_000 });

const SCREENS = "docs/screens/phase-1";
const SYSTEM_TEMPLATES = [
  "Owner",
  "Office Manager",
  "Estimator / Sales",
  "Project Manager / Crew Lead",
  "Painter (Crew Member)",
  "Subcontractor",
  "Bookkeeper",
  "Read-only",
];

const suffix = () => Math.random().toString(36).slice(2, 7);
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 1440) >= 1024;

async function shot(page: Page, name: string) {
  if (!isDesktop(page)) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SCREENS}/${name}`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

/** No sideways page scroll at a 390px phone width (tables scroll inside their own box). */
async function expectFitsPhone(page: Page) {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  if (before) await page.setViewportSize(before);
}

async function orgId(): Promise<string> {
  const { data, error } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  if (error || !data) throw error ?? new Error("org missing");
  return data.id as string;
}

test("overview lists the 8 built-in templates with user counts and the pack matrix", async ({
  page,
}) => {
  await loginAs(page, "owner", "/admin/roles");
  await expect(page.getByRole("heading", { level: 1, name: "Roles & Permissions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const cards = page.getByRole("list", { name: "Role templates" });
  for (const name of SYSTEM_TEMPLATES) {
    const card = cards.getByRole("listitem", { name, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("template-user-count")).toHaveText(/^\d+ users?/);
  }
  await expect(cards.getByRole("listitem", { name: "Owner", exact: true })).toContainText(
    "MFA required",
  );
  await expect(
    cards.getByRole("listitem", { name: "Painter (Crew Member)", exact: true }),
  ).toContainText("Crew");
  // The e2e owner exists, so Owner has at least one user.
  await expect(
    cards.getByRole("listitem", { name: "Owner", exact: true }).getByTestId("template-user-count"),
  ).not.toHaveText("0 users");

  const matrix = page.getByRole("table", { name: "Packs by template" });
  await expect(matrix.getByRole("row", { name: /Field crew/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "admin-roles-overview.png");
  await expectFitsPhone(page);

  // Tabs are linkable.
  await page.getByRole("tab", { name: "Packs" }).click();
  await expect(page).toHaveURL(/tab=packs/);
  await expect(page.getByText("System · read-only").first()).toBeVisible();
  await page.goto("/admin/roles?tab=users");
  await expect(page.getByRole("table", { name: "Users and their templates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Olive Owner", exact: true })).toHaveAttribute(
    "href",
    /^\/admin\/users\/[0-9a-f-]{36}$/,
  );
  await expectNoHorizontalScroll(page);
});

test("the Owner template is locked", async ({ page }) => {
  await loginAs(page, "owner", "/admin/roles?tab=templates");
  await page
    .getByRole("table", { name: "Role templates" })
    .getByRole("link", { name: "Owner", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Owner" })).toBeVisible();
  await expect(
    page.getByText("The Owner template has every permission and is locked."),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Edit roles and permissions/ })).toContainText(
    "Granted",
  );
  await expectFitsPhone(page);
});

test("clone a template, add a pack with a diff preview, save, then delete it", async ({ page }) => {
  const admin = adminClient();
  const name = `E2E Lead Painter ${suffix()}`;
  await loginAs(page, "owner", "/admin/roles?tab=templates");

  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog", { name: "New role template" });
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog.getByText(/Key: e2e_lead_painter_/)).toBeVisible();
  await dialog.getByLabel("Description").fill("Painters who also run the daily log.");
  await dialog.getByLabel("Copy packs from").selectOption({ label: "Painter (Crew Member)" });
  await dialog.getByRole("button", { name: "Create template" }).click();

  await expect(page).toHaveURL(/\/admin\/roles\/templates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const templateId = page.url().split("/").pop() ?? "";

  const { data: created } = await admin
    .from("role_templates")
    .select("key, is_system, is_crew, grants_all")
    .eq("id", templateId)
    .single();
  expect(created).toMatchObject({ is_system: false, is_crew: true, grants_all: false });
  expect(created?.key).toMatch(/^e2e_lead_painter_[a-z0-9_]+$/);

  // Cloned packs: same as Painter (Field crew).
  const fieldCrew = page.getByRole("checkbox", { name: "Field crew" });
  await expect(fieldCrew).toBeChecked();
  const reportingView = page.getByRole("checkbox", { name: "Reporting — view" });
  await expect(reportingView).not.toBeChecked();
  await expect(page.getByText("No changes yet.")).toBeVisible();

  await reportingView.check();
  const added = page.getByTestId("diff-added");
  await expect(added).toContainText("View reports and dashboards");
  await expect(added).toContainText("Use Analytics and Ask Brushy Bear");
  await expect(page.getByTestId("diff-removed")).toHaveCount(0);
  await shot(page, "admin-role-template.png");
  await expectFitsPhone(page);

  await page.getByRole("button", { name: "Save packs" }).click();
  await expect(page.getByText("Template packs saved.")).toBeVisible();
  await expect(page.getByText("No changes yet.")).toBeVisible();
  await expect(page.getByRole("row", { name: /View reports and dashboards/ })).toContainText(
    "Granted",
  );

  const { data: links } = await admin
    .from("template_packs")
    .select("pack:permission_packs(key)")
    .eq("template_id", templateId);
  const keys = (links ?? []).map((l) => (l.pack as unknown as { key: string } | null)?.key).sort();
  expect(keys).toEqual(["field_crew", "reporting_view"]);

  // Rename.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`${name} (renamed)`);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} (renamed)` })).toBeVisible();

  // Deleting while a user is on the template shows the database's message.
  const temp = await createThrowawayUser("painter", "roles");
  await admin.from("profiles").update({ role_template_id: templateId }).eq("id", temp.id);
  await page.getByRole("button", { name: /^Delete template/ }).click();
  let del = page.getByRole("dialog");
  await del.getByRole("button", { name: "Delete template" }).click();
  await expect(del.getByRole("alert")).toContainText("at least 3 characters");
  await del.getByLabel("Reason").fill("E2E: no longer needed");
  await del.getByRole("button", { name: "Delete template" }).click();
  await expect(del.getByRole("alert")).toContainText(
    "Move the users on this template to another template first.",
  );
  await del.getByRole("button", { name: "Cancel" }).click();

  // Move the user back, then delete for real.
  const { data: painter } = await admin
    .from("role_templates")
    .select("id")
    .eq("org_id", await orgId())
    .eq("key", "painter")
    .single();
  await admin.from("profiles").update({ role_template_id: painter?.id }).eq("id", temp.id);

  await page.getByRole("button", { name: /^Delete template/ }).click();
  del = page.getByRole("dialog");
  await del.getByLabel("Reason").fill("E2E: no longer needed");
  await del.getByRole("button", { name: "Delete template" }).click();
  await expect(page).toHaveURL(/\/admin\/roles\?tab=templates$/);
  await expect(page.getByRole("link", { name: `${name} (renamed)` })).toHaveCount(0);

  const { data: deleted } = await admin
    .from("role_templates")
    .select("deleted_at, delete_reason")
    .eq("id", templateId)
    .single();
  expect(deleted?.deleted_at).not.toBeNull();
  expect(deleted?.delete_reason).toBe("E2E: no longer needed");
});

test("create a custom pack with two permissions, edit it, then delete it", async ({ page }) => {
  const admin = adminClient();
  const name = `E2E Photo Review ${suffix()}`;
  await loginAs(page, "owner", "/admin/roles?tab=packs");

  await page.getByRole("link", { name: "New pack" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New permission pack" })).toBeVisible();
  await page.getByRole("button", { name: "Create pack" }).click();
  await expect(page.getByText("Name is required.")).toBeVisible();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByLabel("Category").selectOption({ label: "Production" });
  await page.getByLabel("Description").fill("Review and delete job photos.");
  await page.getByRole("checkbox", { name: "View job photos" }).check();
  await page.getByLabel("View job photos: whose records").selectOption({ label: "Team" });
  await page.getByRole("checkbox", { name: "Delete job photos" }).check();
  // Unscoped permissions have no scope picker.
  await expect(page.getByLabel("Delete job photos: whose records")).toHaveCount(0);
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Create pack" }).click();

  await expect(page).toHaveURL(/\/admin\/roles\/packs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const packId = page.url().split("/").pop() ?? "";

  const { data: perms } = await admin
    .from("pack_permissions")
    .select("permission, scope")
    .eq("pack_id", packId)
    .order("permission");
  expect(perms).toEqual([
    { permission: "photos:delete", scope: "all" },
    { permission: "photos:read", scope: "team" },
  ]);
  await expect(page.getByRole("checkbox", { name: "View job photos" })).toBeChecked();
  await expect(page.getByText(/^Created pack/)).toBeHidden();
  await shot(page, "admin-role-pack.png");
  await expectFitsPhone(page);

  // Widen the scope and save.
  await page.getByLabel("View job photos: whose records").selectOption({ label: "Everyone's" });
  await page.getByRole("button", { name: "Save pack" }).click();
  await expect(page.getByText("Pack saved.")).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("pack_permissions")
        .select("scope")
        .eq("pack_id", packId)
        .eq("permission", "photos:read")
        .single();
      return data?.scope;
    })
    .toBe("all");

  await page.getByRole("button", { name: /^Delete pack/ }).click();
  const del = page.getByRole("dialog");
  await del.getByLabel("Reason").fill("E2E: cleanup");
  await del.getByRole("button", { name: "Delete pack" }).click();
  await expect(page).toHaveURL(/\/admin\/roles\?tab=packs$/);
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  const { data: deleted } = await admin
    .from("permission_packs")
    .select("deleted_at, delete_reason, is_system")
    .eq("id", packId)
    .single();
  expect(deleted?.deleted_at).not.toBeNull();
  expect(deleted).toMatchObject({ delete_reason: "E2E: cleanup", is_system: false });
});

test("system packs are read-only and can be duplicated", async ({ page }) => {
  const admin = adminClient();
  await loginAs(page, "owner", "/admin/roles?tab=packs");
  await page.getByRole("link", { name: "Field crew", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Field crew" })).toBeVisible();
  await expect(page.getByText("Built-in packs are read-only")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /View jobs/ })).toContainText("Own records");
  await expectFitsPhone(page);

  await page.getByRole("button", { name: "Duplicate as custom pack" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Field crew (copy)" })).toBeVisible();
  const copyId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("checkbox", { name: "Upload job photos" })).toBeChecked();
  const { count } = await admin
    .from("pack_permissions")
    .select("id", { count: "exact", head: true })
    .eq("pack_id", copyId);
  expect(count).toBe(8);

  // Clean up the copy.
  await page.getByRole("button", { name: /^Delete pack/ }).click();
  const del = page.getByRole("dialog");
  await del.getByLabel("Reason").fill("E2E: cleanup copy");
  await del.getByRole("button", { name: "Delete pack" }).click();
  await expect(page).toHaveURL(/\/admin\/roles\?tab=packs$/);
});

test("office manager gets a 404 on Roles & Permissions", async ({ page }) => {
  await loginAs(page, "office_manager", "/admin/roles");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("/admin/roles/packs/new");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
