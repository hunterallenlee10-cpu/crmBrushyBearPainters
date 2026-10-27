import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { onboardingRequirements } from "../../lib/domain/estimating/outputs";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * Phase 5 (SPEC §6.4, §8.5 #2/#7, §8.7, §8.13): a sold exterior job with its
 * onboarding checklist and a Deposit Hold. The checks verify what the data
 * shows; the board refuses to move it while the deposit is out; clearing the
 * deposit releases the hold; uploading the HOA approval and sending prep
 * instructions (simulated) clear those items; clearing the rest by hand moves
 * the job to Ready to Schedule on its own. Then the Documents section and page.
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-5";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let orgId = "";
let ownerId = "";
let accountId = "";
let jobId = "";
let jobNumber = "";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function asOwner() {
  // Service role acting as the owner (so the stage override is attributed and allowed).
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
    .insert({ org_id: orgId, display_name: `Onboard${t} Residence` })
    .select("id")
    .single();
  if (e1) throw e1;
  accountId = acct!.id;
  const mobile = `+1425556${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const { data: contact, error: e2 } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: "Rosa",
      last_name: `Onboard${t}`,
      mobile,
      email: `rosa-${t}@example.com`,
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
      street: `${Math.floor(Math.random() * 900) + 100} Board Ln`,
      city: "Redmond",
      state: "WA",
      zip: "98052",
      year_built: 1994,
      has_hoa: true,
      hoa_name: "Sample Hills HOA",
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const year = new Date().getFullYear() + 1;
  const { data: job, error: e4 } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `Onboard${t} – Redmond – Exterior`,
      account_id: accountId,
      property_id: prop!.id,
      primary_contact_id: contact!.id,
      work_types: ["exterior"],
      owner_id: ownerId,
      point_of_contact_id: ownerId,
      promised_start_date: `${year}-07-13`,
    })
    .select("id, job_number")
    .single();
  if (e4) throw e4;
  jobId = job!.id;
  jobNumber = job!.job_number;

  // As if the customer accepted: the job is in Onboarding with its checklist,
  // a draft deposit invoice, a Deposit Hold, a placed paint order and colors.
  const { error: e5 } = await asOwner().rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: "walkthrough_scheduled",
    p_to: "onboarding",
    p_override: true,
    p_reason: "E2E seed: accepted on paper before the CRM",
  });
  if (e5) throw e5;
  const rows = onboardingRequirements({
    workTypes: ["exterior"],
    hasHoa: true,
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
  const { data: inv, error: e7 } = await db
    .from("invoices")
    .insert({ org_id: orgId, job_id: jobId, invoice_type: "deposit", status: "draft" })
    .select("id")
    .single();
  if (e7) throw e7;
  await db.from("invoice_lines").insert({
    org_id: orgId,
    invoice_id: inv!.id,
    description: "Deposit (30%)",
    quantity: 1,
    unit_price_cents: 300_000,
  });
  await db.from("job_holds").insert({
    org_id: orgId,
    job_id: jobId,
    hold_type: "deposit",
    reason: "Waiting for the deposit.",
    blocks_scheduling: true,
  });
  await db.from("paint_orders").insert({ org_id: orgId, job_id: jobId, status: "ordered" });
  await db.from("color_selections").insert([
    {
      org_id: orgId,
      job_id: jobId,
      area: "Front",
      surface: "Body siding",
      status: "selected",
      color_name: "Sample Green",
    },
    { org_id: orgId, job_id: jobId, area: "Front", surface: "Trim", status: "needed" },
  ]);
}

test.beforeAll(seed);

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  const db = adminClient();
  await db.from("paint_orders").delete().eq("job_id", jobId);
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

const item = (page: Page, key: string) => page.getByTestId(`requirement-${key}`);

test("the checks verify what the data shows", async ({ page }, info) => {
  test.skip(
    info.project.name !== "e2e-desktop",
    "Mutations run once; the phone view is checked below.",
  );
  await page.goto(`/jobs/${jobId}?section=onboarding&tab=checklist`);
  await page.getByRole("button", { name: "Re-verify all" }).click();
  await expect(page.getByText(/Re-verified/)).toBeVisible();
  await expect(item(page, "paint_ordered").getByTestId("requirement-status")).toHaveText(
    "Auto-verified",
  );
  await expect(item(page, "start_in_season").getByTestId("requirement-status")).toHaveText(
    "Auto-verified",
  );
  await expect(item(page, "contact_reachable").getByTestId("requirement-status")).toHaveText(
    "Auto-verified",
  );
  await expect(item(page, "deposit_received")).toContainText("Phase 7");
  await expect(item(page, "colors_selected")).toContainText("1 of 2 surfaces have a color");
  await expect(item(page, "hoa_approval").getByTestId("requirement-status")).toHaveText("Missing");
  await expect(page.getByTestId("onboarding-summary")).toContainText(
    "3/10 cleared · 3 auto-verified · 4 need attention",
  );
  await page.screenshot({ path: `${SCREENS}/onboarding-checklist.png`, fullPage: true });
  await axe(page);
});

test("the board won't move a job waiting for its deposit, and says why", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Drag and drop on desktop.");
  await page.goto("/schedule/onboarding");
  await expect(page.getByRole("heading", { level: 1, name: "Onboarding Board" })).toBeVisible();
  const card = page.getByTestId(`board-card-${jobNumber}`);
  await expect(
    page.getByTestId("lane-deposit_hold").getByTestId(`board-card-${jobNumber}`),
  ).toBeVisible();
  const grip = card.getByRole("button", { name: `Move ${jobNumber}` });
  const target = page.getByTestId("lane-ready");
  const from = (await grip.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/Waiting for the deposit/).first()).toBeVisible();
  await expect(
    page.getByTestId("lane-deposit_hold").getByTestId(`board-card-${jobNumber}`),
  ).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/onboarding-board.png`, fullPage: true });
  await axe(page);
});

test("clearing items moves the job to Ready to Schedule on its own", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Mutations run once.");
  await page.goto(`/jobs/${jobId}?section=onboarding&tab=checklist`);

  // Deposit: cleared by hand (payments arrive in Phase 7) → the Deposit Hold releases.
  await item(page, "deposit_received")
    .getByRole("button", { name: /^Mark cleared/ })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("How was it cleared?")
    .fill("Check #1042 received at the office");
  await page.getByRole("dialog").getByRole("button", { name: "Mark cleared" }).click();
  await expect(item(page, "deposit_received").getByTestId("requirement-status")).toHaveText(
    "Cleared",
  );
  await expect(item(page, "deposit_received")).toContainText("Check #1042");
  const { data: hold } = await adminClient()
    .from("job_holds")
    .select("released_at")
    .eq("job_id", jobId)
    .eq("hold_type", "deposit")
    .single();
  expect(hold?.released_at).toBeTruthy();

  // HOA approval: uploaded from the item → Documents → auto-verified.
  await item(page, "hoa_approval")
    .getByRole("button", { name: /^Upload/ })
    .click();
  const upload = page.getByRole("dialog");
  await upload
    .getByLabel("File")
    .setInputFiles({ name: "HOA approval.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(upload.getByLabel("Category")).toHaveValue("hoa");
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Document uploaded.")).toBeVisible();
  await expect(item(page, "hoa_approval").getByTestId("requirement-status")).toHaveText(
    "Auto-verified",
  );

  // Prep instructions: requested from the customer (simulated) → verified by the logged message.
  await item(page, "prep_instructions_sent")
    .getByRole("button", { name: /^Request/ })
    .click();
  const req = page.getByRole("dialog");
  await expect(req.getByText("Draft wording – owner to approve", { exact: false })).toBeVisible();
  await expect(req.getByLabel("Message")).toContainText("3 feet around the house");
  await req.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Recorded in the outbox (simulated – not sent).")).toBeVisible();
  await expect(item(page, "prep_instructions_sent").getByTestId("requirement-status")).toHaveText(
    "Auto-verified",
  );

  // Create a task from an item.
  await item(page, "access_confirmed").getByRole("button", { name: /^Task/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created.")).toBeVisible();
  await expect(item(page, "access_confirmed")).toContainText("Task created");

  // The rest by hand; the last one moves the job.
  for (const key of ["signed_contract", "access_confirmed", "colors_selected", "crew_assigned"]) {
    await item(page, key)
      .getByRole("button", { name: /^Mark cleared/ })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("How was it cleared?")
      .fill(`Confirmed by phone (${key})`);
    await page.getByRole("dialog").getByRole("button", { name: "Mark cleared" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await expect(page.getByText(/moved to Ready to Schedule/).first()).toBeVisible();
  await page.reload();
  await expect(
    page.locator("header").getByText("Ready to Schedule", { exact: true }),
  ).toBeVisible();
  const { data: job } = await adminClient().from("jobs").select("stage").eq("id", jobId).single();
  expect(job?.stage).toBe("ready_to_schedule");
  const { data: history } = await adminClient()
    .from("stage_history")
    .select("override, to_stage")
    .eq("job_id", jobId)
    .eq("to_stage", "ready_to_schedule")
    .single();
  expect(history?.override).toBe(false);

  await page.goto("/schedule/onboarding");
  await expect(page.getByTestId("lane-ready").getByTestId(`board-card-${jobNumber}`)).toBeVisible();
});

test("documents: the job's section, rename, the Documents page", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Mutations run once.");
  await page.goto(`/jobs/${jobId}?section=documents`);
  await expect(page.getByText("Total documents")).toBeVisible();
  const list = page.getByRole("list", { name: "Documents" });
  await expect(list.getByRole("button", { name: "HOA approval", exact: true })).toBeVisible();

  // Upload a second document, rename it, then delete it.
  await page.getByRole("button", { name: "Upload" }).click();
  const dlg = page.getByRole("dialog");
  await dlg
    .getByLabel("File")
    .setInputFiles({ name: "receipt-paint.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(dlg.getByLabel("Category")).toHaveValue("receipt");
  await dlg.getByRole("button", { name: "Upload" }).click();
  await expect(list.getByRole("button", { name: "receipt paint", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Actions for receipt paint" }).click();
  await page.getByRole("menuitem", { name: "Rename or move" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill(`Paint receipt ${t}`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("button", { name: `Paint receipt ${t}`, exact: true })).toBeVisible();

  // Preview streams through the permission-checked route.
  await list.getByRole("button", { name: `Paint receipt ${t}`, exact: true }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toBeVisible();
  const res = await page.request.get(
    (await page.getByRole("dialog").getByRole("link", { name: "Download" }).getAttribute("href"))!,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("attachment");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.screenshot({ path: `${SCREENS}/job-documents.png`, fullPage: true });
  await axe(page);

  await page.getByRole("button", { name: `Actions for Paint receipt ${t}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByLabel("Why?").fill("Uploaded to the wrong job");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(list.getByRole("button", { name: `Paint receipt ${t}`, exact: true })).toBeHidden();

  // The Documents page finds it, with the linked job.
  await page.goto(`/documents?q=${encodeURIComponent("HOA approval")}`);
  await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  await expect(page.getByText("Storage used")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(jobNumber) }).first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/documents-page.png`, fullPage: true });
  await axe(page);
});

test("on a phone: the checklist, the board and documents fit the screen", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-mobile", "Phone layout.");
  for (const path of [
    `/jobs/${jobId}?section=onboarding&tab=checklist`,
    `/jobs/${jobId}?section=documents`,
    "/documents",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.goto(`/jobs/${jobId}?section=onboarding&tab=checklist`);
  await page.screenshot({ path: `${SCREENS}/onboarding-checklist-mobile.png`, fullPage: true });
  await axe(page);
  await page.goto("/schedule/onboarding");
  await expect(page.getByTestId("lane-deposit_hold")).toBeVisible();
  await axe(page);
});
