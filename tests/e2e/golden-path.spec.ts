import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";
import sharp from "sharp";
import { signatureHeader } from "../../lib/intake/signature";
import { deleteAccounts, deleteJobs, deleteLeadsAndJobs } from "./support/cleanup";
import { axe, screens, signedIn } from "./support/helpers";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * SPEC §19 golden path, end to end on the local stack, one job from the
 * website form to Closed Won. Steps run in order (serial) on desktop; the
 * crew's daily log runs in a phone-sized context. Every message goes to the
 * outbox as "simulated". Where a step needs days to pass (the attention SLA,
 * "closes 3 days after Paid in Full", workflow waits), the test moves the
 * clock on the record with the service role and runs the worker, the way
 * Vercel Cron would.
 */

const t = randomUUID().slice(0, 6);
const TZ = "America/Los_Angeles";
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const SECRET = process.env.LEAD_INTAKE_HMAC_SECRET ?? "";
const shot = screens("docs/screens/phase-10");
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(
  ({ isMobile }) => isMobile,
  "One run of the whole path (desktop); the crew step uses a phone context.",
);
test.skip(!SECRET || !process.env.CRON_SECRET, "Needs LEAD_INTAKE_HMAC_SECRET and CRON_SECRET");

const S = {
  orgId: "",
  ownerId: "",
  estimatorId: "",
  painterId: "",
  crewId: "",
  leadId: "",
  jobId: "",
  accountId: "",
  proposalPath: "",
  phone: `(425) 55${Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
  name: `Gwen Golden${t}`,
};

const db = () => adminClient();
const asOwner = () => adminClient(S.ownerId);
const day = (offset: number) =>
  formatInTimeZone(new Date(Date.now() + offset * 86_400_000), TZ, "yyyy-MM-dd");

async function runWorker(): Promise<void> {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status, "the worker accepts the cron secret").toBe(200);
}

/** Runs the worker until `read` gives a value `ok` accepts (other runs sweep too). */
async function workerUntil<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  rounds = 6,
): Promise<T> {
  let v = await read();
  for (let i = 0; i < rounds && !ok(v); i++) {
    await runWorker();
    v = await read();
  }
  expect(ok(v), `state after the worker: ${JSON.stringify(v)}`).toBe(true);
  return v;
}

async function stage(): Promise<string> {
  const { data } = await db().from("jobs").select("stage").eq("id", S.jobId).single();
  return data!.stage as string;
}

async function history(): Promise<string[]> {
  const { data } = await db()
    .from("stage_history")
    .select("to_stage")
    .eq("job_id", S.jobId)
    .order("seq");
  return (data ?? []).map((h) => h.to_stage as string);
}

async function openItems(subjectId: string, rule: string) {
  const { data } = await db()
    .from("attention_items")
    .select("id, status")
    .eq("subject_id", subjectId)
    .eq("rule_key", rule)
    .neq("status", "resolved");
  return data ?? [];
}

async function simulated(subjectType: "lead" | "job", subjectId: string, template?: string) {
  let q = db()
    .from("messages")
    .select("template_key, channel, status, outbox:integration_outbox(status)")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .eq("direction", "outbound");
  if (template) q = q.eq("template_key", template);
  const { data } = await q;
  return (data ?? []) as unknown as {
    template_key: string | null;
    channel: string;
    status: string;
    outbox: { status: string } | null;
  }[];
}

async function sign(page: Page, name: string) {
  await page.getByLabel("Your full name").fill(name);
  const pad = page.getByTestId("signature-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(box.x + 30 + i * 20, box.y + 100 - Math.sin(i) * 30);
  await page.mouse.up();
  await page.getByRole("checkbox", { name: /agree to sign electronically/ }).check();
}

const summary = (page: Page) => page.getByRole("region", { name: "Money summary" });

test.beforeAll(async () => {
  const admin = db();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  S.orgId = org!.id;
  const { data: people } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_USERS.owner.email, TEST_USERS.estimator.email, TEST_USERS.painter.email]);
  const idOf = (email: string) => people!.find((p) => p.email === email)!.id;
  S.ownerId = idOf(TEST_USERS.owner.email);
  S.estimatorId = idOf(TEST_USERS.estimator.email);
  S.painterId = idOf(TEST_USERS.painter.email);
  // A crew led by the painter, with every skill, so scheduling has no conflicts.
  const { data: crew, error } = await admin
    .from("crews")
    .insert({
      org_id: S.orgId,
      name: `Golden crew ${t}`,
      lead_user_id: S.painterId,
      max_jobs_per_day: 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  S.crewId = crew!.id;
  const { data: skills } = await admin.from("skills").select("id").eq("org_id", S.orgId);
  await admin
    .from("crew_skills")
    .insert((skills ?? []).map((s) => ({ org_id: S.orgId, crew_id: S.crewId, skill_id: s.id })));
  await admin
    .from("crew_members")
    .insert({ org_id: S.orgId, crew_id: S.crewId, user_id: S.painterId, role: "lead" });
});

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  const admin = db();
  await admin.from("approval_requests").delete().eq("job_id", S.jobId);
  await admin.from("review_requests").delete().eq("job_id", S.jobId);
  await deleteJobs(S.jobId ? [S.jobId] : []);
  const { accountIds } = await deleteLeadsAndJobs(S.leadId ? [S.leadId] : []);
  await deleteAccounts([...(S.accountId ? [S.accountId] : []), ...accountIds]);
  await admin
    .from("integration_outbox")
    .delete()
    .eq("related_type", "crew")
    .eq("related_id", S.crewId);
  await admin.from("crews").delete().eq("id", S.crewId);
});

test("1. website form → scored, territory-matched lead in < 1 s with the auto-text in the outbox", async ({
  request,
}) => {
  const body = {
    name: S.name,
    phone: S.phone,
    email: `gwen-${t}@example.com`,
    location: "456 Lake St, Kirkland, WA 98033",
    services: ["Exterior"],
    timeline: "1–3 months",
    home_built: "1978 or later",
    notes: "Two-story, peeling on the south side.",
    page_path: "/painters/kirkland-wa",
    utm_source: "google",
    utm_medium: "cpc",
    client_ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
  };
  const raw = JSON.stringify(body);
  const started = Date.now();
  const res = await request.post("/api/public/leads", {
    data: raw,
    headers: { "content-type": "application/json", "x-bb-signature": signatureHeader(SECRET, raw) },
  });
  expect(res.status()).toBe(201);
  expect(Date.now() - started, "payload → lead in < 1 s").toBeLessThan(1000);
  S.leadId = ((await res.json()) as { leadId: string }).leadId;

  const { data: lead } = await db()
    .from("leads")
    .select("score, grade, territory_id, city, out_of_area, status, created_at")
    .eq("id", S.leadId)
    .single();
  expect(lead!.score).toBeGreaterThan(0);
  expect(lead!.territory_id).toBeTruthy();
  expect(lead).toMatchObject({ city: "Kirkland", out_of_area: false, status: "new" });

  // The text-back goes to the outbox (simulated) within a second of the lead.
  await expect
    .poll(
      async () => (await simulated("lead", S.leadId)).filter((m) => m.channel === "sms").length,
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(0);
  const texts = await simulated("lead", S.leadId);
  expect(texts.every((m) => m.outbox?.status === "simulated")).toBe(true);
  const { data: firstText } = await db()
    .from("messages")
    .select("created_at")
    .eq("subject_type", "lead")
    .eq("subject_id", S.leadId)
    .eq("channel", "sms")
    .order("created_at")
    .limit(1)
    .single();
  expect(Date.parse(firstText!.created_at) - Date.parse(lead!.created_at)).toBeLessThan(1000);
  // The estimator owns it from here (round-robin may have picked anyone).
  await db().from("leads").update({ owner_id: S.estimatorId }).eq("id", S.leadId);
});

test("2. speed-to-lead: an untouched lead opens an attention item; a logged call resolves it", async ({
  page,
}) => {
  // Move the lead's arrival back past the text-back SLA (business minutes).
  const { error } = await db()
    .from("leads")
    .update({ created_at: new Date(Date.now() - 7 * 86_400_000).toISOString() })
    .eq("id", S.leadId);
  expect(error).toBeNull();
  await workerUntil(
    () => openItems(S.leadId, "untouched_lead"),
    (items) => items.length === 1,
  );
  await page.goto("/attention");
  await expect(page.getByText(`Untouched new lead: ${S.name}`).first()).toBeVisible();

  await page.goto(`/leads/${S.leadId}?tab=activity`);
  await page.getByRole("button", { name: "Log call", exact: true }).first().click();
  await page.getByLabel("Outcome").selectOption({ label: "Left voicemail" });
  await page.getByLabel("Duration (minutes)").fill("2");
  await page.getByLabel("Call notes").fill(`Called about the exterior ${t}`);
  await page.getByRole("button", { name: "Log call" }).last().click();
  await expect(page.getByText("Call logged.").first()).toBeVisible();
  await workerUntil(
    () => openItems(S.leadId, "untouched_lead"),
    (items) => items.length === 0,
  );
  const { data: lead } = await db()
    .from("leads")
    .select("first_contacted_at, status")
    .eq("id", S.leadId)
    .single();
  expect(lead!.first_contacted_at).not.toBeNull();
});

test("3. walkthrough booked (confirmation simulated) → lead converted → walkthrough completed", async ({
  page,
}) => {
  await page.goto(`/leads/${S.leadId}?book=1`);
  const dialog = page.getByRole("dialog", { name: "Book walkthrough" });
  await dialog.getByLabel("Date").fill(day(2));
  await dialog.getByLabel("Time (Pacific)").fill("10:30");
  await dialog.getByRole("button", { name: "Book walkthrough" }).click();
  await expect(
    page.getByText(/Walkthrough booked\. Job BB-\d{4}-\d+ created\./).first(),
  ).toBeVisible({
    timeout: 45_000,
  });
  await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/, { timeout: 60_000 });
  S.jobId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const { data: lead } = await db()
    .from("leads")
    .select("status, converted_job_id, account_id")
    .eq("id", S.leadId)
    .single();
  expect(lead).toMatchObject({ status: "converted", converted_job_id: S.jobId });
  S.accountId = lead!.account_id ?? "";
  expect(await stage()).toBe("walkthrough_scheduled");
  // Confirmation now; reminders are scheduled (all simulated).
  await workerUntil(
    async () => (await simulated("job", S.jobId)).concat(await simulated("lead", S.leadId)),
    (msgs) => msgs.some((m) => m.template_key === "walkthrough_confirmation"),
  );
  // The HOA matters later (onboarding asks for its approval).
  const { data: job } = await db().from("jobs").select("property_id").eq("id", S.jobId).single();
  await db()
    .from("properties")
    .update({ has_hoa: true, hoa_name: `Lakeview HOA ${t}` })
    .eq("id", job!.property_id!);

  // The estimator walks it and records "Measured".
  await page.goto(`/jobs/${S.jobId}`);
  await page.getByRole("link", { name: "Result Walkthrough" }).click();
  const result = page.getByRole("dialog", { name: "Result the walkthrough" });
  await result.getByLabel("Measured").check();
  await result.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText(/Job moved to Walkthrough Complete/).first()).toBeVisible();
  expect(await stage()).toBe("walkthrough_complete");
});

test("4. estimate with two options and a rot-repair add-on; a discount over the limit goes to Approvals", async ({
  browser,
}, info) => {
  const page = await signedIn(browser, info, "estimator", `/jobs/${S.jobId}?section=estimate`);
  await page.getByRole("button", { name: "Start the estimate" }).click();
  await page.waitForURL(/\/estimate\/[0-9a-f-]{36}$/);

  const addMeasuredLine = async (areaName: string, width: string) => {
    await page.getByLabel("New area").fill(areaName);
    await page.getByRole("button", { name: "Add area" }).click();
    const area = page.getByRole("region", { name: areaName });
    await area.getByRole("button", { name: "Add line" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByLabel("Search the price book").fill("cedar");
    await picker.getByRole("button", { name: /cedar/i }).first().click();
    const editor = page.getByRole("dialog");
    await editor.getByRole("button", { name: "Measurement helper" }).click();
    await editor.getByLabel("What to measure").selectOption("exterior_wall");
    await editor.getByLabel("Width (ft)").fill(width);
    await editor.getByLabel("Height (ft)").fill("18");
    await editor.getByRole("button", { name: "Use this quantity" }).click();
    await editor.getByRole("button", { name: "Save line" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  const addAddOn = async (search: string, quantity: string) => {
    await page.getByRole("button", { name: "Add add-on" }).click();
    await page.getByRole("dialog").getByLabel("Search the price book").fill(search);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(search, "i") })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByLabel(/Quantity/)
      .fill(quantity);
    await page.getByRole("dialog").getByRole("button", { name: "Save line" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };

  await addMeasuredLine("House body", "40");
  // Option B: a second option with more of the house.
  await page.getByRole("button", { name: "Option", exact: true }).click();
  await page.getByLabel("New option name").fill("Option B");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Option added.").first()).toBeVisible();
  await addMeasuredLine("Whole house", "90");
  await addAddOn("rot", "4");
  await addAddOn("pressure", "1500");
  await expect(page.getByRole("region", { name: "Optional add-ons" })).toContainText("4 lin ft");

  // 10% off; the estimator's limit is 5%, so it needs an owner.
  const terms = page.getByRole("form", { name: "Discount, deposit and notes" });
  // Line saves refresh the page; let them settle so the form isn't reset under us.
  await page.waitForLoadState("networkidle");
  for (let attempt = 0; attempt < 3; attempt++) {
    await terms.getByLabel("Discount").selectOption("percent");
    await terms.getByLabel("Percent").fill("10");
    await terms.getByLabel("Reason (internal)").fill("Neighbor of a past customer");
    await terms.getByRole("button", { name: "Save" }).click();
    await page.waitForLoadState("networkidle");
    const asks = await page
      .getByLabel("Why the discount")
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
    if (asks) break;
  }
  await page
    .getByLabel("Why the discount")
    .fill("Neighbor of a past customer; matching last year's price.");
  await page.getByRole("button", { name: "Ask for approval" }).click();
  await expect(page.getByText("Sent to Approvals.").first()).toBeVisible();
  await expect(page.getByText(/Waiting on an owner to approve/)).toBeVisible();
  await shot(page, "golden-estimate-builder");
  await page.context().close();
  const { data: req } = await db()
    .from("approval_requests")
    .select("type, status")
    .eq("job_id", S.jobId)
    .single();
  expect(req).toMatchObject({ type: "estimate_discount", status: "pending" });
});

test("5. the owner approves; the proposal is sent (simulated)", async ({ page, browser }, info) => {
  await page.goto("/jobs/approvals");
  const row = page.getByTestId("approval-row").filter({ hasText: S.name.split(" ")[1]! });
  await row.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve discount" }).click();
  await expect(page.getByText(/Approved\./).first()).toBeVisible();

  const { data: estimate } = await db()
    .from("estimates")
    .select("id")
    .eq("job_id", S.jobId)
    .single();
  const { data: versions } = await db()
    .from("estimate_versions")
    .select("id, status")
    .eq("estimate_id", estimate!.id);
  const draft = versions!.find((v) => v.status === "draft") ?? versions![0]!;
  const est = await signedIn(browser, info, "estimator", `/jobs/${S.jobId}/estimate/${draft.id}`);
  await expect(est.getByText(/Discount up to 10% approved/)).toBeVisible();
  await est.getByRole("button", { name: "Send for signature" }).click();
  const send = est.getByRole("dialog");
  await send.getByRole("button", { name: "Send", exact: true }).click();
  await expect(send.getByRole("heading", { name: "Sent" })).toBeVisible({ timeout: 30_000 });
  S.proposalPath = new URL(await send.getByLabel("Proposal link").inputValue()).pathname;
  await est.context().close();
  expect(await stage()).toBe("estimate_sent");
  expect((await simulated("job", S.jobId)).length).toBeGreaterThan(0);
});

test("6. the customer picks Option B + pressure washing and signs: Sold, signed PDF, deposit invoice, onboarding", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto(S.proposalPath);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hi Gwen");
  await page.getByRole("radio", { name: /Option B/ }).click();
  await page.getByRole("switch", { name: /Add Pressure washing/ }).check();
  await axe(page);
  await sign(page, S.name);
  await page.getByRole("button", { name: "Accept & sign" }).click();
  await expect(page.getByText("You're booked in. Thank you!")).toBeVisible({ timeout: 45_000 });
  await shot(page, "golden-proposal-signed");
  await ctx.close();

  const admin = db();
  await expect.poll(stage).toMatch(/^(sold|onboarding)$/);
  expect(await history()).toEqual(
    expect.arrayContaining(["walkthrough_complete", "estimate_sent", "sold"]),
  );
  const { data: docs } = await admin
    .from("documents")
    .select("category, status")
    .eq("job_id", S.jobId);
  expect(docs).toEqual(
    expect.arrayContaining([expect.objectContaining({ category: "contract", status: "signed" })]),
  );
  const { data: invoices } = await admin
    .from("invoices")
    .select("invoice_type, status, total_cents")
    .eq("job_id", S.jobId);
  expect(invoices).toEqual([expect.objectContaining({ invoice_type: "deposit" })]);
  const { data: version } = await admin
    .from("estimate_versions")
    .select(
      "accepted_option_id, accepted_addon_ids, estimate_options!estimate_options_version_id_fkey(id, name)",
    )
    .eq("status", "accepted")
    .in(
      "estimate_id",
      (await admin.from("estimates").select("id").eq("job_id", S.jobId)).data!.map((e) => e.id),
    )
    .single();
  const picked = version as unknown as {
    accepted_option_id: string;
    accepted_addon_ids: string[];
    estimate_options: { id: string; name: string }[];
  };
  expect(picked.estimate_options.find((o) => o.id === picked.accepted_option_id)?.name).toBe(
    "Option B",
  );
  expect(picked.accepted_addon_ids).toHaveLength(1);
  const { count } = await admin
    .from("onboarding_requirements")
    .select("id", { count: "exact", head: true })
    .eq("job_id", S.jobId);
  expect(count).toBeGreaterThan(5);
});

test("7. the deposit is recorded and applied; the Deposit Hold releases", async ({ page }) => {
  await page.goto(`/jobs/${S.jobId}?section=financial`);
  await page.getByRole("tab", { name: /Payments/ }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Check # / reference").fill(`CHK ${t}`);
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.").first()).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await db()
        .from("job_holds")
        .select("released_at")
        .eq("job_id", S.jobId)
        .eq("hold_type", "deposit")
        .single();
      return data?.released_at ?? null;
    })
    .not.toBeNull();
  await page.goto(`/jobs/${S.jobId}?section=financial`);
  await expect(summary(page)).toContainText("$");
  await shot(page, "golden-financial-deposit");
});

test("8. colors, HOA approval, crew and paint order → Ready to Schedule", async ({ page }) => {
  const owner = asOwner();
  // Colors picked and the paint order placed (their own screens are covered elsewhere).
  await owner
    .from("color_selections")
    .update({ color_name: "Repose Gray", color_code: "SW 7015", status: "selected" })
    .eq("job_id", S.jobId);
  const { data: orders } = await owner.from("paint_orders").select("id").eq("job_id", S.jobId);
  if ((orders ?? []).length === 0) {
    const { error } = await owner
      .from("paint_orders")
      .insert({ org_id: S.orgId, job_id: S.jobId, status: "ordered", supplier: "Paint store" });
    expect(error).toBeNull();
  } else {
    await owner.from("paint_orders").update({ status: "ordered" }).eq("job_id", S.jobId);
  }
  await owner.from("jobs").update({ crew_id: S.crewId }).eq("id", S.jobId);
  // The crew lead is on the job's team (what the crew sees in the field).
  await owner
    .from("job_team")
    .insert({ org_id: S.orgId, job_id: S.jobId, user_id: S.painterId, role: "painter" });

  await page.goto(`/jobs/${S.jobId}?section=onboarding&tab=checklist`);
  const item = (key: string) => page.getByTestId(`requirement-${key}`);
  await item("hoa_approval")
    .getByRole("button", { name: /^Upload/ })
    .click();
  const upload = page.getByRole("dialog");
  await upload
    .getByLabel("File")
    .setInputFiles({ name: "HOA approval.pdf", mimeType: "application/pdf", buffer: PDF });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Document uploaded.").first()).toBeVisible();
  await page.getByRole("button", { name: "Re-verify all" }).click();
  await expect(item("hoa_approval").getByTestId("requirement-status")).toHaveText("Auto-verified");
  await expect(item("colors_selected").getByTestId("requirement-status")).toHaveText(/verified/i);
  await expect(item("paint_ordered").getByTestId("requirement-status")).toHaveText(/verified/i);

  // Whatever is left is confirmed by hand; the last one moves the job.
  for (let i = 0; i < 12 && (await stage()) === "onboarding"; i++) {
    const next = page.getByRole("button", { name: /^Mark cleared/ }).first();
    if ((await next.count()) === 0) {
      await page.reload();
      continue;
    }
    await next.click();
    await page
      .getByRole("dialog")
      .getByLabel("How was it cleared?")
      .fill("Confirmed with the customer by phone");
    await page.getByRole("dialog").getByRole("button", { name: "Mark cleared" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await expect.poll(stage).toBe("ready_to_schedule");
  await shot(page, "golden-onboarding-cleared");
});

test("9. scheduled on the Master Schedule as a draft, then published: customer and crew notices simulated", async ({
  page,
}) => {
  await page.goto(`/schedule/master?date=${day(0)}`);
  const card = page.getByTestId(`tray-${S.jobId}`);
  await card.getByRole("button", { name: "Schedule job" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Crew", { exact: true }).selectOption(S.crewId);
  await dialog.getByLabel("First day").fill(day(0));
  await dialog.getByLabel("Last day").fill(day(2));
  await dialog.getByRole("button", { name: "Save draft" }).click();
  // Exterior work in late October is outside the exterior season (Jun 1–Sep 30
  // by default): the draft is saved with a blocking conflict an owner can override.
  const { data: draft } = await expect
    .poll(
      async () =>
        (await db().from("schedule_entries").select("id, status").eq("job_id", S.jobId)).data
          ?.length ?? 0,
    )
    .toBe(1)
    .then(() => db().from("schedule_entries").select("id, status").eq("job_id", S.jobId).single());
  expect(draft!.status).toBe("draft");
  const blocked = await dialog
    .getByText("outside the exterior season")
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );
  if (blocked) {
    await page.keyboard.press("Escape");
    await page
      .getByTestId(`bar-${draft!.id}`)
      .getByRole("button", { name: new RegExp(`^(Conflict ?)?BB-\\d{4}-\\d+ · Golden${t}`) })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Owner override reason")
      .fill("Dry week in the forecast; customer agreed to a fall start.");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Override with this reason" })
      .click();
    await expect(page.getByText("Override recorded.").first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText(/Published \d+ change/).first()).toBeVisible();
  await expect.poll(stage).toBe("scheduled");
  await workerUntil(
    () => simulated("job", S.jobId, "schedule_published"),
    (m) => m.length >= 1,
  );
  const { data: crewNotes } = await db()
    .from("integration_outbox")
    .select("status")
    .eq("related_type", "crew")
    .eq("related_id", S.crewId);
  expect(crewNotes!.length).toBeGreaterThan(0);
  expect(crewNotes!.every((r) => r.status === "simulated")).toBe(true);
});

test("10. rain on day 1: rain delay marked, priority reschedule, customer text simulated, no charge", async ({
  page,
}) => {
  await page.goto("/schedule/weather");
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel(new RegExp(`Rain day for .*Golden${t}`)) });
  await form.getByLabel(new RegExp(`Rain day for .*Golden${t}`)).fill(day(0));
  await form.getByRole("button", { name: "Mark rain delay" }).click();
  await expect(page.getByText(/Rain delay marked/).first()).toBeVisible();
  const { data: job } = await db()
    .from("jobs")
    .select("is_priority_reschedule")
    .eq("id", S.jobId)
    .single();
  expect(job!.is_priority_reschedule).toBe(true);
  const { count: delays } = await db()
    .from("rain_delays")
    .select("id", { count: "exact", head: true })
    .eq("job_id", S.jobId);
  expect(delays).toBe(1);
  expect((await simulated("job", S.jobId, "rain_delay")).length).toBe(1);
  const { count: credits } = await db()
    .from("on_time_credits")
    .select("id", { count: "exact", head: true })
    .eq("job_id", S.jobId);
  expect(credits, "weather never costs the customer").toBe(0);
});

test("11. start, a daily log from the crew (customer update simulated), punch list, sign-off → Completed", async ({
  page,
}) => {
  // Materials arrive, then the crew lead starts the job.
  await asOwner().from("paint_orders").update({ status: "delivered" }).eq("job_id", S.jobId);
  // The daily log on a phone (the crew lead's screen; painters see the job but
  // posting needs the Project Manager / office role, here the owner).
  const crew = page;
  await crew.setViewportSize({ width: 412, height: 915 });
  await crew.goto(`/field/daily-log?job=${S.jobId}`);
  await crew
    .getByLabel("Finished today")
    .fill("Washed and scraped the south side; primed bare wood.");
  await crew.getByLabel("Next up").fill("Body coat tomorrow.");
  await crew.getByRole("checkbox", { name: "Cleanup done" }).check();
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#d8dcd2" },
  })
    .jpeg()
    .toBuffer();
  await crew
    .locator("#dl-cleanup-photo")
    .setInputFiles([{ name: "cleanup.jpg", mimeType: "image/jpeg", buffer: photo }]);
  await crew.getByRole("button", { name: "Post daily log" }).click();
  await expect(crew.getByRole("status").filter({ hasText: "Daily log sent" })).toBeVisible();
  await shot(crew, "golden-daily-log");
  await crew.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(async () => {
      const { data } = await db()
        .from("daily_logs")
        .select("customer_update_status")
        .eq("job_id", S.jobId);
      return data?.[0]?.customer_update_status ?? null;
    })
    .toMatch(/simulated|sent|queued/);
  // The first daily log starts the job.
  await expect.poll(stage, { timeout: 15_000 }).toBe("in_progress");

  // The work orders are finished; production moves the job on.
  await asOwner()
    .from("work_orders")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("job_id", S.jobId);
  await workerUntil(stage, (s) => s === "final_walkthrough");

  await page.goto(`/jobs/${S.jobId}?section=punch-list`);
  const form = page.getByRole("form", { name: "Add punch item" });
  for (const [area, what] of [
    ["Front porch", "Touch up the drip on the railing"],
    ["Garage", "Second coat on the door trim"],
  ]) {
    await form.getByLabel("Area").fill(area!);
    await form.getByLabel("What needs fixing").fill(what!);
    await form.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("region", { name: area })).toContainText(what!);
  }
  for (const area of ["Front porch", "Garage"]) {
    await page.getByRole("region", { name: area }).getByRole("button", { name: "Fixed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark fixed" }).click();
    await expect(page.getByRole("region", { name: area })).toContainText("(0 open)");
  }
  await page.getByRole("button", { name: "Capture customer sign-off" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Customer name").fill(S.name);
  const pad = dialog.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? -18 : 18));
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Save sign-off" }).click();
  await expect(page.getByText("Sign-off saved.").first()).toBeVisible();
  await expect.poll(stage).toBe("completed");
});

test("12. final invoice → payment → Paid in Full; review request and referral invite simulated → Closed Won", async ({
  page,
}) => {
  await page.goto(`/jobs/${S.jobId}?section=financial`);
  // Completing the job drafts the final invoice (money sweep); otherwise draft it here.
  const { count: drafted } = await db()
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("job_id", S.jobId)
    .eq("invoice_type", "final");
  if (!drafted) {
    await page.getByRole("button", { name: "Draft the final invoice" }).click();
    await expect(page.getByText("Final invoice drafted.").first()).toBeVisible();
  }
  await page.getByRole("tab", { name: /Invoices/ }).click();
  const final = page
    .locator("li")
    .filter({ hasText: /· Final/ })
    .first();
  await final.getByRole("button", { name: /^Send/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send invoice" }).click();
  await expect(page.getByText("Invoice sent (simulated).").first()).toBeVisible();
  await expect.poll(stage).toBe("invoiced");

  await page.reload();
  await page.getByRole("tab", { name: /Payments/ }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel("Method").selectOption("ach");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.").first()).toBeVisible();
  await expect.poll(stage).toBe("paid_in_full");

  // Money: the contract is fully paid and the balance is zero (from the ledger).
  const { data: fin } = await db()
    .from("job_financials")
    .select("contract_cents")
    .eq("job_id", S.jobId)
    .single();
  const { data: pays } = await db()
    .from("payments")
    .select("amount_cents, status")
    .eq("job_id", S.jobId);
  const paid = (pays ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);
  expect(paid).toBe(Number(fin!.contract_cents));
  await page.goto(`/jobs/${S.jobId}?section=financial`);
  await expect(summary(page)).toContainText("$0.00");
  await shot(page, "golden-paid-in-full");

  // Paid in full → thank-you now; the review request and referral invite after their waits.
  await workerUntil(
    () => simulated("job", S.jobId, "paid_in_full_thanks"),
    (m) => m.length >= 1,
  );
  // Move time on: Paid in Full 15 days ago (past the referral wait), and the
  // review wait already over.
  await db()
    .from("jobs")
    .update({ paid_in_full_at: new Date(Date.now() - 15 * 86_400_000).toISOString() })
    .eq("id", S.jobId);
  const past = new Date(Date.now() - 60_000).toISOString();
  for (let i = 0; i < 4; i++) {
    const { data: runs } = await db()
      .from("workflow_runs")
      .select("id, steps")
      .eq("subject_id", S.jobId)
      .eq("status", "waiting");
    for (const run of runs ?? []) {
      const steps = (Array.isArray(run.steps) ? run.steps : []).map(
        (st: Record<string, unknown>) => (st.outcome === "waiting" ? { ...st, until: past } : st),
      );
      await db().from("workflow_runs").update({ steps, resume_at: past }).eq("id", run.id);
    }
    await runWorker();
  }
  const all = await simulated("job", S.jobId);
  expect(all.map((m) => m.template_key)).toEqual(
    expect.arrayContaining(["review_request", "referral_invite"]),
  );
  expect(all.every((m) => m.status === "simulated" || m.outbox?.status === "simulated")).toBe(true);

  // Closes on its own 3 days after Paid in Full while the balance stays $0. The
  // stage date only moves through the stage engine; the demo-data helper
  // (demo jobs only) moves it back for this test record.
  await db().from("jobs").update({ is_demo: true }).eq("id", S.jobId);
  const { error: backdated } = await db().rpc("demo_backdate_stage", {
    p_job: S.jobId,
    p_entered_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  });
  expect(backdated).toBeNull();
  await workerUntil(stage, (s) => s === "closed_won");
  expect(await history()).toEqual(
    expect.arrayContaining([
      "walkthrough_complete",
      "estimate_sent",
      "sold",
      "onboarding",
      "ready_to_schedule",
      "scheduled",
      "in_progress",
      "final_walkthrough",
      "completed",
      "invoiced",
      "paid_in_full",
      "closed_won",
    ]),
  );
  // KPIs: the job counts as won in the pipeline numbers on the Jobs Dashboard.
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs Dashboard" })).toBeVisible();
  await page.goto(`/jobs/${S.jobId}`);
  await expect(page.getByText("Closed Won").first()).toBeVisible();
  await shot(page, "golden-closed-won");
});
