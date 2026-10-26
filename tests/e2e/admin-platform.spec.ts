import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TEST_USERS, adminClient, loginAs, type TestRole } from "./support/users";

/**
 * Admin → Integrations (cards, setup checklist, simulated test send, outbox)
 * and Admin → Audit Log (filters, keyset pages, field diff). Phase 1.
 */

test.use({ storageState: { cookies: [], origins: [] } });
// One worker for this file: parallel magic links for the same user overwrite each other's token.
test.describe.configure({ mode: "default", timeout: 90_000 });

const SHOTS = join(process.cwd(), "docs", "screens", "phase-1");
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });
}

/**
 * Fresh sign-in (loginAs) that lands on `path`. Retried because other specs can
 * end the same test user's sessions (sign-out is global) or race its magic link.
 */
async function signIn(page: Page, role: TestRole, path: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await page.context().clearCookies();
      await loginAs(page, role, path);
      await page.goto(path);
      const at = new URL(page.url()).pathname;
      if (!at.startsWith("/login") && at !== "/mfa") return;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await page.waitForTimeout(1500 * attempt);
  }
  throw new Error(`Could not sign in as ${role}`);
}

/** Client components are interactive once React hydrates; the toast region only mounts then. */
async function hydrated(page: Page) {
  await page.getByRole("region", { name: /Notifications/ }).waitFor({ state: "attached" });
}

/** Opens an expandable row (its only button); retried because a click before hydration does nothing. */
async function expand(button: Locator) {
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

test.describe("Admin → Integrations", () => {
  test("shows 11 disconnected cards and the summary", async ({ page }) => {
    await signIn(page, "owner", "/admin/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(page.getByTestId("integrations-summary")).toHaveText("0 of 11 connected");
    await expect(page.getByText("This build connects nothing.")).toBeVisible();

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(11);
    for (const card of await cards.all()) {
      await expect(card).toContainText("Not connected");
      await expect(card).toContainText("Never");
    }
    const sms = page.getByRole("article", { name: "SMS & Voice" });
    await expect(sms).toContainText("Outbox (simulated)");
    await expect(sms).toContainText("Twilio");
    await expect(page.getByRole("article", { name: "E-signature" })).toContainText(
      "Built-in (BearSign)",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await shot(page, "admin-integrations");
  });

  test("Configure on SMS & Voice shows the Twilio checklist and a locked Connect button", async ({
    page,
  }) => {
    await signIn(page, "owner", "/admin/integrations");
    await hydrated(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("article", { name: "SMS & Voice" })
      .getByRole("button", { name: "Configure SMS & Voice" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Set up SMS & Voice" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem").first()).toContainText("Create a Twilio account");
    await expect(dialog).toContainText("TWILIO_AUTH_TOKEN");
    await expect(dialog).toContainText("INTEGRATION_SMS_PROVIDER");
    await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
    await expect(dialog).toContainText(
      "Connecting real providers is turned off in this build — see docs/INTEGRATIONS.md → How the lock works",
    );
    await shot(page, "admin-integration-configure", false);
  });

  test("Send a test (simulated) for Email records an outbox row", async ({ page }) => {
    const startedAt = Date.now();
    await signIn(page, "owner", "/admin/integrations");
    await hydrated(page);
    await page
      .getByRole("article", { name: "Email" })
      .getByRole("button", { name: "Send a test (simulated) for Email" })
      .click();
    await expect(
      page.getByText("Test email recorded in the outbox. Nothing was sent."),
    ).toBeVisible();

    // Other specs write to the outbox too, so find this test's row by id.
    const since = new Date(startedAt - 2000).toISOString();
    let outboxId = "";
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("integration_outbox")
          .select("id, status, provider")
          .eq("domain", "email")
          .eq("recipient", TEST_USERS.owner.email)
          .eq("subject", "Test email from Brushy Bear CRM (simulated)")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1);
        const row = data?.[0];
        outboxId = row?.id ?? "";
        return row ? `${row.status}/${row.provider}` : null;
      })
      .toBe("simulated/outbox");

    const row = page.locator(`[data-outbox-id="${outboxId}"]`);
    await expect(row).toContainText("Simulated – not sent");
    await expect(row).toContainText("e***@test.brushybear.local");
    await expect(row).toContainText("email.send");
    await expect(row).not.toContainText("e2e-owner@");

    await expand(row.getByRole("button"));
    const detail = page.locator(`#outbox-detail-${outboxId}`);
    await expect(detail).toContainText('"subject": "Test email from Brushy Bear CRM (simulated)"');
    await expect(detail).not.toContainText("e2e-owner@");
  });

  test("no sideways scroll at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "owner", "/admin/integrations");
    await expect(page.getByRole("article")).toHaveCount(11);
    await expectNoHorizontalScroll(page);
    await page.goto("/admin/audit-log");
    await expect(page.getByRole("heading", { level: 1, name: "Audit Log" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("Admin → Audit Log", () => {
  test("lists recent entries and filters by Company settings", async ({ page }) => {
    await signIn(page, "owner", "/admin/audit-log");
    await expect(page.getByRole("heading", { level: 1, name: "Audit Log" })).toBeVisible();
    await expect(page.getByTestId("audit-row").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    await expect(page.getByText("Export arrives with Export Controls (Phase 10)")).toBeVisible();

    await page.getByLabel("Table").selectOption({ label: "Company settings" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/table=public\.company_settings/);
    const rows = page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      await expect(row).toContainText("Company settings");
    }
    await hydrated(page);
    await expand(rows.first().getByRole("button"));
    await expect(page.getByRole("table", { name: "Field changes" })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await shot(page, "admin-audit-log", false);
  });

  test("record filter pages with Older/Newer and expands a field diff", async ({ page }) => {
    const admin = adminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", "brushy-bear")
      .single();
    const { data: list } = await admin
      .from("picklists")
      .select("id")
      .eq("org_id", org?.id)
      .eq("key", "lost_reason")
      .single();
    const suffix = Math.random().toString(36).slice(2, 8);
    const { data: value, error } = await admin
      .from("picklist_values")
      .insert({
        org_id: org?.id,
        picklist_id: list?.id,
        value: `e2e_audit_${suffix}`,
        label: `E2E audit ${suffix}`,
        sort_order: 1000,
        active: false,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const id = value?.id as string;

    try {
      // 1 insert + 55 updates = 56 audit rows for this record: two pages.
      for (let i = 1; i <= 55; i++) {
        const { error: uErr } = await admin
          .from("picklist_values")
          .update({ sort_order: 1000 + i })
          .eq("id", id);
        expect(uErr).toBeNull();
      }

      await signIn(page, "owner", `/admin/audit-log?record=${id}`);
      await hydrated(page);
      const rows = page.getByTestId("audit-row");
      await expect(rows).toHaveCount(50);
      await expect(rows.first()).toContainText(
        `Changed Picklist value “E2E audit ${suffix}”: sort_order`,
      );
      await expect(rows.first()).toContainText("System");

      await expand(rows.first().getByRole("button"));
      const diff = page.getByRole("table", { name: "Field changes" });
      await expect(diff).toBeVisible();
      await expect(diff.getByRole("rowheader", { name: "sort_order" })).toBeVisible();
      await expect(diff).toContainText("1054");
      await expect(diff).toContainText("1055");
      await expect(diff).not.toContainText("updated_at");

      await expect(page.getByRole("link", { name: "Newer" })).toHaveCount(0);
      await page.getByRole("link", { name: "Older" }).click();
      await expect(page).toHaveURL(/before=\d+/);
      await expect(rows).toHaveCount(6);
      await expect(rows.last()).toContainText(`Created Picklist value “E2E audit ${suffix}”`);
      await expect(page.getByRole("link", { name: "Older" })).toHaveCount(0);

      await page.getByRole("link", { name: "Newer" }).click();
      await expect(page).not.toHaveURL(/(before|after)=/);
      await expect(page).toHaveURL(new RegExp(`record=${id}`));
      await expect(rows).toHaveCount(50);
    } finally {
      await admin.from("picklist_values").delete().eq("id", id);
    }
  });
});

test.describe("Admin platform permissions", () => {
  test("office manager sees Integrations without test sends, and no Audit Log", async ({
    page,
  }) => {
    await signIn(page, "office_manager", "/admin/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(11);
    await expect(page.getByRole("button", { name: /Send a test/ })).toHaveCount(0);
    const res = await page.goto("/admin/audit-log");
    expect(res?.status()).toBe(404);
  });

  test("painter gets 404 on both", async ({ page }) => {
    await signIn(page, "painter", "/");
    for (const path of ["/admin/integrations", "/admin/audit-log"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
