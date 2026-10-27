import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient } from "./support/users";

/**
 * Phase 4 (SPEC §7): build an estimate in the builder, send it (simulated),
 * then the customer opens the link on a 390px phone, toggles an add-on,
 * signs, and acceptance produces the signed PDF, the deposit invoice and the
 * onboarding checklist. One fake job, removed in afterAll.
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-4";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let orgId = "";
let accountId = "";
let jobId = "";
let proposalUrl = "";

async function seedJob() {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  orgId = org!.id;
  const { data: acct, error: e1 } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `Estimate${t} Residence` })
    .select("id")
    .single();
  if (e1) throw e1;
  accountId = acct!.id;
  const phone = `+1425555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const { data: contact, error: e2 } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: "Maya",
      last_name: `Estimate${t}`,
      mobile: phone,
      email: `maya-${t}@example.com`,
      sms_opt_in: true,
      email_opt_in: true,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  const { data: prop, error: e3 } = await db
    .from("properties")
    .insert({
      org_id: orgId,
      account_id: accountId,
      street: `${Math.floor(Math.random() * 900) + 100} Sample Ln`,
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      year_built: 1962,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const { data: job, error: e4 } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `Estimate${t} – Kirkland – Exterior`,
      account_id: accountId,
      property_id: prop!.id,
      primary_contact_id: contact!.id,
      work_types: ["exterior"],
    })
    .select("id")
    .single();
  if (e4) throw e4;
  jobId = job!.id;
  const now = Date.now();
  await db.from("appointments").insert({
    org_id: orgId,
    job_id: jobId,
    type: "walkthrough",
    starts_at: new Date(now - 7_200_000).toISOString(),
    ends_at: new Date(now - 3_600_000).toISOString(),
    status: "completed",
    result: "measured",
  });
  const { error: e5 } = await db.rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: "walkthrough_scheduled",
    p_to: "walkthrough_complete",
  });
  if (e5) throw e5;
}

test.beforeAll(seedJob);

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return; // debugging: leave the job in place
  const db = adminClient();
  const { data: docs } = await db.from("documents").select("storage_path").eq("job_id", jobId);
  const paths = (docs ?? []).map((d: { storage_path: string }) => d.storage_path);
  if (paths.length) await db.storage.from("documents").remove(paths);
  await db.from("approval_requests").delete().eq("job_id", jobId);
  await deleteJobs([jobId]);
  await deleteAccounts([accountId]);
});

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.help} ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 5)
          .join(" | ")}`,
    ),
  ).toEqual([]);
}

test("builds an estimate and sends it for signature (simulated)", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "One build per run; the phone part is next.");
  await page.goto(`/jobs/${jobId}?section=estimate`);
  await expect(page.getByRole("heading", { name: "No estimate yet" })).toBeVisible();
  await page.getByRole("button", { name: "Start the estimate" }).click();
  await page.waitForURL(/\/estimate\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EST-");
  await expect(page.getByText("Sample", { exact: true }).first()).toBeVisible();

  // An area, then a production-rate line measured with the helper.
  await page.getByLabel("New area").fill("Front of house");
  await page.getByRole("button", { name: "Add area" }).click();
  await expect(page.getByRole("region", { name: "Front of house" })).toBeVisible();
  const area = page.getByRole("region", { name: "Front of house" });
  await area.getByRole("button", { name: "Add line" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Search the price book").fill("cedar");
  await picker.getByRole("button", { name: /cedar/i }).first().click();

  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel(/Quantity/)).toBeVisible();
  await editor.getByRole("button", { name: "Measurement helper" }).click();
  await editor.getByLabel("What to measure").selectOption("exterior_wall");
  await editor.getByLabel("Width (ft)").fill("40");
  await editor.getByLabel("Height (ft)").fill("18");
  await editor.getByRole("button", { name: "Use this quantity" }).click();
  await expect(editor.getByLabel(/Quantity/)).not.toHaveValue("0");
  await editor.getByRole("button", { name: "Save line" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(area.getByRole("button", { name: /cedar/i })).not.toContainText(" 0 sq ft");

  // An optional add-on the customer can switch on.
  await page.getByRole("button", { name: "Add add-on" }).click();
  await page.getByRole("dialog").getByLabel("Search the price book").fill("rot");
  await page.getByRole("dialog").getByRole("button", { name: /rot/i }).first().click();
  await expect(page.getByRole("dialog").getByLabel(/Quantity/)).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel(/Quantity/)
    .fill("4");
  await page.getByRole("dialog").getByRole("button", { name: "Save line" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(page.getByRole("region", { name: "Optional add-ons" })).toContainText("4 lin ft");
  const total = page.getByRole("region", { name: "Customer total" });
  await expect(total).toContainText("$");
  await expect(page.getByRole("region", { name: "Margin (internal)" })).toContainText("floor");
  await page.screenshot({ path: `${SCREENS}/estimate-builder-desktop.png`, fullPage: true });
  await axe(page);

  // Send (simulated): the link comes back in the dialog.
  await page.getByRole("button", { name: "Send for signature" }).click();
  const send = page.getByRole("dialog");
  await expect(send.getByText(/simulated/)).toBeVisible();
  await send.getByRole("button", { name: "Send", exact: true }).click();
  await expect(send.getByRole("heading", { name: "Sent" })).toBeVisible({ timeout: 30_000 });
  proposalUrl = await send.getByLabel("Proposal link").inputValue();
  expect(proposalUrl).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
  await send.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/Sent versions are frozen/)).toBeVisible();

  const db = adminClient();
  const { data: job } = await db
    .from("jobs")
    .select("stage, estimate_sent_at")
    .eq("id", jobId)
    .single();
  expect(job!.stage).toBe("estimate_sent");
  expect(job!.estimate_sent_at).not.toBeNull();
  const { data: outbox } = await db
    .from("messages")
    .select("channel, outbox:integration_outbox(status)")
    .eq("subject_type", "job")
    .eq("subject_id", jobId);
  expect((outbox ?? []).length).toBeGreaterThan(0);
});

test("the customer signs on a phone; acceptance makes the PDF, deposit invoice and onboarding", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Runs once, at 390px.");
  expect(proposalUrl).not.toBe("");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto(new URL(proposalUrl).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi Maya");
  const total = page.getByTestId("proposal-total");
  const before = await total.textContent();
  await page.getByRole("switch").first().check();
  await expect(total).not.toHaveText(before ?? "");
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${SCREENS}/proposal-390.png`, fullPage: true });
  await axe(page);

  await page.getByLabel("Your full name").fill(`Maya Estimate${t}`);
  const pad = page.getByTestId("signature-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 30 + i * 20, box.y + 100 - Math.sin(i) * 30);
  }
  await page.mouse.up();
  await page.getByRole("checkbox", { name: /agree to sign electronically/ }).check();
  await page.getByRole("button", { name: "Accept & sign" }).click();
  await expect(page.getByText("You're booked in. Thank you!")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("link", { name: "Download your signed copy" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/proposal-signed-390.png`, fullPage: true });

  const pdf = await page.request.get(`${new URL(proposalUrl).pathname}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  await ctx.close();

  const db = adminClient();
  const { data: job } = await db
    .from("jobs")
    .select("stage, contract_signed_at")
    .eq("id", jobId)
    .single();
  expect(job!.stage).toBe("onboarding");
  expect(job!.contract_signed_at).not.toBeNull();
  const { data: docs } = await db
    .from("documents")
    .select("category, status, size_bytes")
    .eq("job_id", jobId);
  expect(docs).toEqual(
    expect.arrayContaining([expect.objectContaining({ category: "contract", status: "signed" })]),
  );
  const { data: invoices } = await db
    .from("invoices")
    .select("invoice_type, total_cents, status")
    .eq("job_id", jobId);
  expect(invoices).toHaveLength(1);
  expect(invoices![0]).toMatchObject({ invoice_type: "deposit", status: "draft" });
  expect(invoices![0]!.total_cents).toBeGreaterThan(0);
  const { count } = await db
    .from("onboarding_requirements")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  expect(count).toBeGreaterThan(5);
});

test("the office sees the signed contract, deposit invoice and checklist", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Follows the signing above.");
  await page.goto(`/jobs/${jobId}?section=estimate`);
  await expect(page.getByText("Accepted").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signed documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Colors" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/job-estimate-section.png`, fullPage: true });
  const docLink = page
    .getByRole("region", { name: /Signed documents/ })
    .getByRole("link")
    .first();
  const href = await docLink.getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  await page.goto(`/jobs/${jobId}?section=financial`);
  await expect(page.getByText(/· Deposit/)).toBeVisible();
  await page.goto(`/jobs/${jobId}?section=onboarding&tab=checklist`);
  await expect(page.getByText("Required items cleared")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/onboarding-checklist.png`, fullPage: true });
});
