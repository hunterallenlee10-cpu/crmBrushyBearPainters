import { expect as baseExpect, test, type Page } from "@playwright/test";
import { adminClient, loginAs, type TestRole } from "./support/users";

/**
 * Admin → Field Picklists, Territories and Deleted Records (SPEC §5.1, §8.19).
 * Every test signs in fresh and works only on records it creates; seeded
 * built-in values and territories are never changed.
 */

test.use({ storageState: { cookies: [], origins: [] } });
// One worker for this file: parallel magic links for the same user overwrite each other's token.
test.describe.configure({ mode: "default" });
// First visits compile routes on the dev server.
test.setTimeout(90_000);

// The shared dev server is slow under parallel load; server actions get more time.
const expect = baseExpect.configure({ timeout: 15_000 });

const SCREENS = "docs/screens/phase-1";
const suffix = () => Math.random().toString(36).slice(2, 8);

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

/** Fresh sign-in, retried if another spec's magic link for the same user won the race. */
async function signIn(page: Page, role: TestRole, next = "/") {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await loginAs(page, role, next);
      const path = new URL(page.url()).pathname;
      if (!path.startsWith("/login") && !path.startsWith("/mfa")) {
        // Wait for hydration so typed input reaches React state.
        await page.waitForLoadState("networkidle");
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(500 + Math.random() * 1000);
  }
  throw new Error(`Could not sign in as ${role}: ${String(lastError)}`);
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function orgId(): Promise<string> {
  const { data, error } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  if (error || !data) throw error ?? new Error("brushy-bear org missing");
  return (data as { id: string }).id;
}

test.describe("field picklists", () => {
  test("lists the 10 seeded picklists", async ({ page }) => {
    await signIn(page, "owner", "/admin/picklists");
    await expect(page.getByRole("heading", { level: 1, name: "Field Picklists" })).toBeVisible();
    const rows = page.getByRole("table", { name: "Picklists" }).locator("tbody tr");
    await expect(rows).toHaveCount(10);
    for (const name of ["Lead Source", "Lead Sub-source", "Lead Disposition", "Sheen"]) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/admin-picklists.png`, fullPage: true });

    // Dispositions show the category column; sub-sources show their parent source.
    await page.getByRole("link", { name: "Lead Disposition", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lead Disposition" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Category for Walkthrough scheduled")).toHaveValue("positive");
    await expect(page.getByLabel("Category for No answer")).toHaveValue("no_contact");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/admin-picklist-values.png`, fullPage: true });

    await goto(page, "/admin/picklists/lead_sub_source");
    const parent = page.getByLabel("Parent lead source for Google Ads");
    await expect(parent.locator("option:checked")).toHaveText("Website");
  });

  test("sheen: add, rename, reorder and turn off custom values", async ({ page }) => {
    const admin = adminClient();
    const org = await orgId();
    const s = suffix();
    const labelA = `E2E Sheen ${s}`;
    const labelB = `E2E Velvet ${s}`;
    const keyA = `e2e_sheen_${s}`;
    const keyB = `e2e_velvet_${s}`;
    const renamed = `${labelA} renamed`;

    const { data: sheen } = await admin
      .from("picklists")
      .select("id")
      .eq("org_id", org)
      .eq("key", "sheen")
      .single();
    const sheenId = (sheen as { id: string }).id;
    const readValue = async (key: string) => {
      const { data } = await admin
        .from("picklist_values")
        .select("id, label, active, sort_order, is_system")
        .eq("picklist_id", sheenId)
        .eq("value", key)
        .maybeSingle();
      return data as {
        id: string;
        label: string;
        active: boolean;
        sort_order: number;
        is_system: boolean;
      } | null;
    };

    try {
      await signIn(page, "owner", "/admin/picklists/sheen");
      await expect(page.getByRole("heading", { level: 1, name: "Sheen" })).toBeVisible();
      await expect(
        page.getByText(
          "Changes apply everywhere this field is used. Values can be turned off but not deleted, so old records keep their meaning.",
        ),
      ).toBeVisible();

      // Built-in values are labeled and have no delete control anywhere.
      const list = page.getByRole("list", { name: "Sheen values" });
      await expect(list.getByText("Built-in").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /delete|remove/i })).toHaveCount(0);

      // Add two custom values; the key is generated from the label.
      for (const [label, key] of [
        [labelA, keyA],
        [labelB, keyB],
      ] as const) {
        await page.getByRole("button", { name: "Add value" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Label").fill(label);
        await expect(dialog.getByLabel("Key")).toHaveValue(key);
        await expect(dialog.getByText("can't change after you add the value")).toBeVisible();
        await dialog.getByRole("button", { name: "Add value" }).click();
        await expect(dialog).toBeHidden();
        await expect(list.getByLabel(`Label for ${key}`)).toHaveValue(label);
      }
      const a = await readValue(keyA);
      const b = await readValue(keyB);
      expect(a?.is_system).toBe(false);
      expect(a?.active).toBe(true);
      expect(b && a && b.sort_order > a.sort_order).toBe(true);

      // A duplicate label is refused with a plain message.
      await page.getByRole("button", { name: "Add value" }).click();
      const dup = page.getByRole("dialog");
      await dup.getByLabel("Label").fill("satin");
      await dup.getByLabel("Key").fill(`e2e_dup_${s}`);
      await dup.getByRole("button", { name: "Add value" }).click();
      await expect(dup.getByText(`There's already a value labeled "satin"`)).toBeVisible();
      await dup.getByRole("button", { name: "Cancel" }).click();
      await expect(dup).toBeHidden();
      expect(await readValue(`e2e_dup_${s}`)).toBeNull();

      // Rename inline (Enter saves).
      const labelInput = list.getByLabel(`Label for ${keyA}`);
      await labelInput.fill(renamed);
      await labelInput.press("Enter");
      await expect(page.getByText(`Renamed to "${renamed}".`)).toBeVisible();
      await expect.poll(async () => (await readValue(keyA))?.label).toBe(renamed);

      // Move B up above A with the keyboard-accessible button; focus stays on the control.
      const up = list.getByRole("button", { name: `Move ${labelB} up` });
      await up.click();
      await expect(list.getByRole("button", { name: `Move ${labelB} up` })).toBeFocused();
      const keys = await list.locator("code").allTextContents();
      expect(keys.indexOf(keyB)).toBeLessThan(keys.indexOf(keyA));
      await expect
        .poll(async () => {
          const [na, nb] = await Promise.all([readValue(keyA), readValue(keyB)]);
          return (nb?.sort_order ?? 0) < (na?.sort_order ?? 0);
        })
        .toBe(true);

      // Turn A off.
      const toggle = list.getByRole("switch", { name: `Active: ${renamed}` });
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(async () => (await readValue(keyA))?.active).toBe(false);

      // Survives a reload.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(list.getByRole("switch", { name: `Active: ${renamed}` })).not.toBeChecked();
      await expect(list.getByLabel(`Label for ${keyA}`)).toHaveValue(renamed);
      await expectNoHorizontalScroll(page);
    } finally {
      // Custom values aren't deletable in the app; tidy up with the service role.
      await admin
        .from("picklist_values")
        .delete()
        .eq("picklist_id", sheenId)
        .eq("is_system", false)
        .in("value", [keyA, keyB, `e2e_dup_${s}`]);
    }
  });
});

test.describe("territories", () => {
  test("ZIP conflicts, create, delete and restore", async ({ page }) => {
    const admin = adminClient();
    const org = await orgId();
    const { data: live } = await admin
      .from("territories")
      .select("zip_codes")
      .eq("org_id", org)
      .is("deleted_at", null);
    const used = new Set(((live ?? []) as { zip_codes: string[] }[]).flatMap((t) => t.zip_codes));
    const zip = ["98039", "98040", "98059", "98011", "98028", "98072", "98077", "98019"].find(
      (z) => !used.has(z),
    );
    if (!zip) throw new Error("No unused test ZIP available");
    const name = `E2E Territory ${suffix()}`;
    let createdId: string | null = null;

    try {
      await signIn(page, "owner", "/admin/territories");
      await expect(page.getByRole("heading", { level: 1, name: "Territories" })).toBeVisible();
      await expect(page.getByText("Owners: verify these ZIP lists.")).toBeVisible();
      const list = page.getByRole("list", { name: "Territories" });
      await expect(list.getByRole("heading", { name: "Bellevue" })).toBeVisible();
      await expect(list.getByRole("list", { name: "ZIP codes in Bellevue" })).toContainText(
        "98004",
      );
      await expect(list.getByRole("heading", { name: "Outside service area" })).toBeVisible();
      await expect(
        list.getByText("No ZIP codes. Leads that match no territory are flagged Out of area."),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${SCREENS}/admin-territories.png`, fullPage: true });

      // A ZIP already in Bellevue is caught before saving, naming Bellevue.
      await page.getByRole("button", { name: "Add territory" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(name);
      const zips = dialog.getByLabel("ZIP codes");
      await zips.fill("98004, 9800x");
      await expect(dialog.getByText(`ZIP codes must be 5 digits. Fix "9800x".`)).toBeVisible();
      await zips.fill("98004");
      await expect(dialog.getByText("98004 already belongs to Bellevue.")).toBeVisible();
      await dialog.getByRole("button", { name: "Add territory" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText("Bellevue");

      // Create with an unused ZIP.
      await zips.fill(zip);
      await dialog.getByRole("button", { name: "Add territory" }).click();
      await expect(dialog).toBeHidden();
      await expect(list.getByRole("heading", { name })).toBeVisible();
      await expect(list.getByRole("list", { name: `ZIP codes in ${name}` })).toHaveText(zip);
      const { data: created } = await admin
        .from("territories")
        .select("id, zip_codes, is_service_area, active")
        .eq("org_id", org)
        .eq("name", name)
        .is("deleted_at", null)
        .single();
      const row = created as {
        id: string;
        zip_codes: string[];
        is_service_area: boolean;
        active: boolean;
      };
      createdId = row.id;
      expect(row).toMatchObject({ zip_codes: [zip], is_service_area: true, active: true });

      // Delete requires a reason.
      await page.getByRole("button", { name: `Delete ${name}` }).click();
      const del = page.getByRole("dialog");
      await del.getByRole("button", { name: "Delete territory" }).click();
      await expect(del.getByText("Say briefly why")).toBeVisible();
      await del.getByLabel("Reason").fill("E2E test territory");
      await del.getByRole("button", { name: "Delete territory" }).click();
      await expect(del).toBeHidden();
      await expect(list.getByRole("heading", { name })).toHaveCount(0);

      // It shows up in Deleted Records with the reason and can be restored.
      await goto(page, "/admin/deleted-records");
      await expect(page.getByRole("heading", { level: 1, name: "Deleted Records" })).toBeVisible();
      const recordRow = page.getByRole("row").filter({ hasText: name });
      await expect(recordRow).toContainText("E2E test territory");
      await expect(recordRow).toContainText("Olive Owner");
      await page.getByRole("button", { name: /^Territories/ }).click();
      await expect(recordRow).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `${SCREENS}/admin-deleted-records.png`, fullPage: true });
      await page.getByRole("button", { name: `Restore ${name}` }).click();
      await expect(page.getByText(`Restored ${name}.`)).toBeVisible();
      await expect(recordRow).toHaveCount(0);

      await goto(page, "/admin/territories");
      await expect(list.getByRole("heading", { name })).toBeVisible();
      const { data: restored } = await admin
        .from("territories")
        .select("deleted_at, delete_reason, zip_codes")
        .eq("id", createdId)
        .single();
      expect(restored).toMatchObject({ deleted_at: null, delete_reason: null, zip_codes: [zip] });
    } finally {
      if (createdId) await admin.from("territories").delete().eq("id", createdId);
      else await admin.from("territories").delete().eq("org_id", org).eq("name", name);
    }
  });

  test("ZIP lookup maps addresses to territories", async ({ page }) => {
    await signIn(page, "owner", "/admin/territories");
    const input = page.getByLabel("ZIP code or address");
    const result = page.getByTestId("zip-lookup-result");
    await input.fill("Kirkland WA 98033");
    await expect(result).toContainText("98033");
    await expect(result).toContainText("Kirkland");
    await input.fill("98101");
    await expect(result).toContainText("Out of area — leads are flagged, not rejected");
    await input.fill("Main Street");
    await expect(result).toContainText("Type a 5-digit ZIP");
  });
});

test.describe("small screens", () => {
  test("all four pages fit a 390px screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "owner", "/admin/picklists");
    for (const path of [
      "/admin/picklists",
      "/admin/picklists/lead_disposition",
      "/admin/picklists/lead_sub_source",
      "/admin/territories",
      "/admin/deleted-records",
    ]) {
      await goto(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe("permissions", () => {
  test("painter gets 404 on picklists, territories and deleted records", async ({ page }) => {
    await signIn(page, "painter");
    for (const path of [
      "/admin/picklists",
      "/admin/picklists/sheen",
      "/admin/territories",
      "/admin/deleted-records",
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
