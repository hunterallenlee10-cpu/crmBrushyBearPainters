import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { onboardingRequirements } from "../../lib/domain/estimating/outputs";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * Phase 7 — Money (PLAN "done when"): a deposit payment recorded and applied
 * on Job → Financial clears the onboarding deposit item and releases the
 * Deposit Hold; an approved $250 On-Time Guarantee credit lands on the final
 * invoice; sending it moves the job to Invoiced and paying the balance moves
 * it to Paid in Full. Then the Invoices list, A/R aging, Admin → Finance and
 * the bookkeeper's Job Costing with a receipt, plus the phone view.
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-7";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let orgId = "";
let ownerId = "";
let accountId = "";
let jobId = "";

function asOwner() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": ownerId } },
    },
  );
}

async function seed() {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  orgId = org!.id;
  const { data: owner } = await db
    .from("profiles")
    .select("id")
    .eq("email", TEST_USERS.owner.email)
    .single();
  ownerId = owner!.id;
  const { data: acct, error: e1 } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `Ledger${t} Residence` })
    .select("id")
    .single();
  if (e1) throw e1;
  accountId = acct!.id;
  const { data: contact, error: e2 } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: "Lena",
      last_name: `Ledger${t}`,
      mobile: `+1425557${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`,
      email: `lena-${t}@example.com`,
      sms_opt_in: true,
      email_opt_in: true,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  const { data: job, error: e3 } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `Ledger${t} – Kirkland – Interior`,
      account_id: accountId,
      primary_contact_id: contact!.id,
      work_types: ["interior"],
      owner_id: ownerId,
      point_of_contact_id: ownerId,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  jobId = job!.id;
  // A $10,000 contract (baseline), in Onboarding with its checklist, a draft
  // $3,000 deposit invoice and a Deposit Hold, as acceptance leaves it.
  const { error: e4 } = await db
    .from("job_financials")
    .insert({ job_id: jobId, org_id: orgId, contract_baseline_cents: 1_000_000 });
  if (e4) throw e4;
  const { error: e5 } = await asOwner().rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: "walkthrough_scheduled",
    p_to: "onboarding",
    p_override: true,
    p_reason: "E2E seed: accepted on paper before the CRM",
  });
  if (e5) throw e5;
  const rows = onboardingRequirements({
    workTypes: ["interior"],
    hasHoa: false,
    leadSafeWork: false,
    hasRepairAllowance: false,
    hasColorConsult: false,
    depositCents: 300_000,
  });
  const { error: e6 } = await db.from("onboarding_requirements").insert(
    rows.map((r) => ({
      org_id: orgId,
      job_id: jobId,
      key: r.key,
      group_key: r.group,
      label: r.label,
      required: r.required,
      owner_role: r.ownerRole,
      status: r.status,
      auto_verify_rule: r.autoVerifyRule,
      sort_order: r.sortOrder,
    })),
  );
  if (e6) throw e6;
  const { error: e7 } = await asOwner().rpc("create_invoice", {
    p_job: jobId,
    p_type: "deposit",
    p_lines: [{ description: "Deposit (30%)", unit_price_cents: 300_000 }],
  });
  if (e7) throw e7;
  await db.from("job_holds").insert({
    org_id: orgId,
    job_id: jobId,
    hold_type: "deposit",
    reason: "Waiting for the deposit.",
    blocks_scheduling: true,
  });
}

test.beforeAll(seed);

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  await deleteJobs([jobId]);
  await deleteAccounts([accountId]);
});

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 3)
            .join(" | ")}`,
      ),
  ).toEqual([]);
}

async function stage(): Promise<string> {
  const { data } = await adminClient().from("jobs").select("stage").eq("id", jobId).single();
  return data!.stage as string;
}

const summary = (page: Page) => page.getByRole("region", { name: "Money summary" });

test("recording the deposit clears the onboarding item and releases the Deposit Hold", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Mutations run once; the phone view is below.");
  await page.goto(`/jobs/${jobId}?section=financial`);
  await expect(summary(page)).toContainText("$10,000.00");
  await expect(summary(page)).toContainText("$3,000.00");
  await page.screenshot({ path: `${SCREENS}/financial-worksheet-before.png`, fullPage: true });
  await axe(page);

  await page.getByRole("tab", { name: /Payments/ }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Amount ($)")).toHaveValue("3000.00");
  // Forced application: the split follows the amount onto the deposit invoice.
  await expect(dialog.getByText("Applied $3,000.00 of $3,000.00")).toBeVisible();
  await dialog.getByLabel("Check # / reference").fill("CHK 1042");
  await page.screenshot({ path: `${SCREENS}/record-payment.png` });
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect(page.getByText(/PMT-\d{4}-\d{4} · \$3,000\.00/)).toBeVisible();

  const db = adminClient();
  await expect
    .poll(async () => {
      const { data } = await db
        .from("onboarding_requirements")
        .select("status, verified_auto")
        .eq("job_id", jobId)
        .eq("key", "deposit_received")
        .single();
      return `${data?.status}/${data?.verified_auto}`;
    })
    .toBe("verified/true");
  const { data: hold } = await db
    .from("job_holds")
    .select("released_at")
    .eq("job_id", jobId)
    .eq("hold_type", "deposit")
    .single();
  expect(hold?.released_at).not.toBeNull();
  const { data: job } = await db.from("jobs").select("deposit_paid_at").eq("id", jobId).single();
  expect(job?.deposit_paid_at).not.toBeNull();

  await page.goto(`/jobs/${jobId}?section=onboarding&tab=checklist`);
  await expect(page.getByTestId("requirement-deposit_received")).toContainText("Deposit paid");
  // The outbox has a "would sync" preview for QuickBooks.
  await page.goto(`/jobs/${jobId}?section=financial&tab=accounting`);
  await expect(page.getByText("Would sync (simulated)")).toBeVisible();
  await expect(page.getByText("Not connected").first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/financial-accounting.png`, fullPage: true });
});

test("the final invoice carries the approved $250 On-Time Guarantee credit; paying it moves the job to Paid in Full", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Mutations run once.");
  const db = adminClient();
  // The start slipped (not weather): the schedule drafts the credit and an owner approves it.
  const { data: credit, error } = await db
    .from("on_time_credits")
    .insert({
      org_id: orgId,
      job_id: jobId,
      amount_cents: 25_000,
      promised_date: "2026-06-01",
      actual_start_date: "2026-06-03",
      reason: "Started 2 days late (crew double-booked).",
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: approveError } = await asOwner()
    .from("on_time_credits")
    .update({ status: "approved", decided_by: ownerId, decided_at: new Date().toISOString() })
    .eq("id", credit!.id);
  if (approveError) throw approveError;
  // Production is done (owner override past the production stages for the test).
  const { error: moveError } = await asOwner().rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: "onboarding",
    p_to: "completed",
    p_override: true,
    p_reason: "E2E: production finished outside this test",
  });
  if (moveError) throw moveError;

  await page.goto(`/jobs/${jobId}?section=financial`);
  await expect(page.getByText("On-Time Guarantee · $250.00")).toBeVisible();
  await page.getByRole("button", { name: "Draft the final invoice" }).click();
  await expect(page.getByText("Final invoice drafted.")).toBeVisible();
  await page.getByRole("tab", { name: /Invoices/ }).click();
  const final = page
    .locator("li")
    .filter({ hasText: /· Final/ })
    .first();
  await expect(final).toContainText("Balance of contract");
  await expect(final).toContainText("$7,000.00");
  await expect(final).toContainText("On-Time Guarantee credit");
  await expect(final).toContainText("−$250.00");
  await expect(final).toContainText("$6,750.00");
  await page.screenshot({ path: `${SCREENS}/final-invoice-with-credit.png`, fullPage: true });

  // Send it (simulated text + email with the PDF): Completed → Invoiced.
  await final.getByRole("button", { name: /^Send/ }).click();
  const send = page.getByRole("dialog");
  await expect(send.getByLabel("Text message")).toHaveValue(/\$6,750\.00/);
  await page.screenshot({ path: `${SCREENS}/send-invoice.png` });
  await send.getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByText("Invoice sent (simulated).")).toBeVisible();
  await expect.poll(stage).toBe("invoiced");
  const { data: outbox } = await db
    .from("integration_outbox")
    .select("domain, status")
    .eq("related_type", "job")
    .eq("related_id", jobId)
    .eq("status", "simulated");
  expect(new Set((outbox ?? []).map((o) => o.domain))).toEqual(new Set(["sms_voice", "email"]));
  const { data: onTime } = await db
    .from("jobs")
    .select("on_time_guarantee_status")
    .eq("id", jobId)
    .single();
  expect(onTime?.on_time_guarantee_status).toBe("credit_applied");

  // Pay the balance: Invoiced → Paid in Full.
  await page.reload();
  await page.getByRole("tab", { name: /Payments/ }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog");
  await expect(pay.getByLabel("Amount ($)")).toHaveValue("6750.00");
  await pay.getByLabel("Method").selectOption("ach");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect.poll(stage).toBe("paid_in_full");
  await page.goto(`/jobs/${jobId}?section=financial`);
  await expect(summary(page)).toContainText("$9,750.00");
  await page.screenshot({ path: `${SCREENS}/financial-paid-in-full.png`, fullPage: true });
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByText("Paid in full").first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/overview-paid-in-full.png`, fullPage: true });
});

test("Invoices list, A/R aging and Admin → Finance", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Desktop office screens.");
  await page.goto("/invoices?tab=all");
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await expect(page.getByText("A/R Outstanding")).toBeVisible();
  await page.getByPlaceholder("Search invoice #, job or customer…").fill(`Ledger${t}`);
  await expect(page).toHaveURL(/q=Ledger/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: new RegExp(`Ledger${t}`) }).first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/invoices-list.png`, fullPage: true });
  await axe(page);

  await page.goto("/invoices/aging");
  await expect(page.getByRole("heading", { level: 1, name: "A/R Aging" })).toBeVisible();
  await expect(page.getByText("90+ days").first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/ar-aging.png`, fullPage: true });
  await axe(page);

  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Month close" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/admin-finance.png`, fullPage: true });
  await axe(page);
});

test("the bookkeeper sees job costing and adds an expense with a receipt", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Desktop office screen.");
  const ctx = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: { width: 1440, height: 900 },
    storageState: "tests/e2e/.auth/bookkeeper.json",
  });
  const page = await ctx.newPage();
  await page.goto(`/jobs/${jobId}?section=financial&tab=costing`);
  await expect(page.getByRole("heading", { name: "Job costing" })).toBeVisible();
  await page.getByRole("button", { name: "Add expense" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("What").fill("Dump fee");
  await d.getByLabel("Amount ($)").fill("45.00");
  await d.getByLabel("Category").selectOption("disposal");
  // A 1×1 PNG as the receipt photo (re-encoded to JPEG on the server).
  await d.getByLabel(/Receipt/).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await d.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText("Expense added.")).toBeVisible();
  await expect(page.getByText("Dump fee")).toBeVisible();
  await expect(page.getByRole("link", { name: "Receipt" })).toBeVisible();
  await expect(page.getByText("Other expenses · $45.00")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/job-costing.png`, fullPage: true });
  await axe(page);
  await ctx.close();
});

test("on a phone: the money summary and invoices read well", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-mobile", "Phone layout.");
  await page.goto(`/jobs/${jobId}?section=financial`);
  await expect(summary(page)).toBeVisible();
  await page.getByRole("tab", { name: /Invoices/ }).click();
  await expect(page.getByText(/· Deposit/).first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/financial-mobile.png`, fullPage: true });
  await axe(page);
});
