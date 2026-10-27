import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";
import { signatureHeader } from "../../lib/intake/signature";
import { deleteAccounts, deleteJobs, deleteLeadsAndJobs } from "./support/cleanup";
import { screens, signedIn } from "./support/helpers";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * SPEC §19 "also test": a missed start (not weather) drafts the $250 credit,
 * an owner approves it and it lands on the final invoice; a pre-1978 lead
 * needs a certified renovator on the crew; an out-of-area ZIP is flagged; a
 * duplicate web submission joins the existing lead; the crew can't see
 * contract amounts; View as is read-only and logged. (Bulk update preview →
 * apply → revert is in hardening.spec.ts.)
 */

const t = randomUUID().slice(0, 6);
const TZ = "America/Los_Angeles";
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const SECRET = process.env.LEAD_INTAKE_HMAC_SECRET ?? "";
const shot = screens("docs/screens/phase-10");
const day = (offset: number) =>
  formatInTimeZone(new Date(Date.now() + offset * 86_400_000), TZ, "yyyy-MM-dd");

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(({ isMobile }) => isMobile, "Data-changing checks run once (desktop).");

let orgId = "";
let ownerId = "";
let painterId = "";
const jobIds: string[] = [];
const leadIds: string[] = [];
const accountIds: string[] = [];
const crewIds: string[] = [];

async function runWorker() {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status).toBe(200);
}

async function intake(body: Record<string, unknown>) {
  const raw = JSON.stringify({
    client_ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    ...body,
  });
  return fetch(`${BASE}/api/public/leads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bb-signature": signatureHeader(SECRET, raw) },
    body: raw,
  });
}

/** A job (account, contact, property) moved to `stage` by an owner override. */
async function seedJob(
  label: string,
  stage: string,
  extra: { workTypes?: string[]; yearBuilt?: number; contractCents?: number } = {},
) {
  const db = adminClient();
  const { data: acct } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `${label}${t} Residence` })
    .select("id")
    .single();
  accountIds.push(acct!.id);
  const { data: contact } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: acct!.id,
      first_name: label,
      last_name: `Edge${t}`,
      email: `${label.toLowerCase()}-${t}@example.com`,
      email_opt_in: true,
    })
    .select("id")
    .single();
  const { data: prop } = await db
    .from("properties")
    .insert({
      org_id: orgId,
      account_id: acct!.id,
      street: `${Math.floor(Math.random() * 900) + 100} Edge Ln`,
      city: "Redmond",
      state: "WA",
      zip: "98052",
      year_built: extra.yearBuilt ?? 1995,
    })
    .select("id")
    .single();
  const { data: job, error } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `${label}${t} – Redmond – Interior`,
      account_id: acct!.id,
      property_id: prop!.id,
      primary_contact_id: contact!.id,
      work_types: extra.workTypes ?? ["interior"],
      owner_id: ownerId,
      point_of_contact_id: ownerId,
    })
    .select("id")
    .single();
  if (error) throw error;
  jobIds.push(job!.id);
  if (extra.contractCents) {
    await db
      .from("job_financials")
      .insert({ job_id: job!.id, org_id: orgId, contract_baseline_cents: extra.contractCents });
  }
  const { error: moveError } = await adminClient(ownerId).rpc("apply_job_stage_change", {
    p_job: job!.id,
    p_from: "walkthrough_scheduled",
    p_to: stage,
    p_override: true,
    p_reason: "E2E seed: edge-case checks",
  });
  if (moveError) throw moveError;
  return job!.id as string;
}

test.beforeAll(async () => {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  orgId = org!.id;
  const { data: people } = await db
    .from("profiles")
    .select("id, email")
    .in("email", [TEST_USERS.owner.email, TEST_USERS.painter.email]);
  ownerId = people!.find((p) => p.email === TEST_USERS.owner.email)!.id;
  painterId = people!.find((p) => p.email === TEST_USERS.painter.email)!.id;
});

test.afterAll(async () => {
  const db = adminClient();
  await db.from("schedule_entries").delete().in("job_id", jobIds);
  await deleteJobs(jobIds);
  const { accountIds: fromLeads } = await deleteLeadsAndJobs(leadIds);
  await deleteAccounts([...accountIds, ...fromLeads]);
  if (crewIds.length) await db.from("crews").delete().in("id", crewIds);
});

test("a missed start (not weather) drafts the $250 credit; once approved it's on the final invoice", async ({
  page,
}) => {
  test.skip(!process.env.CRON_SECRET, "needs CRON_SECRET");
  const db = adminClient();
  const jobId = await seedJob("Missy", "scheduled", { contractCents: 800_000 });
  // Promised (guaranteed) three days ago; nobody started.
  await db
    .from("jobs")
    .update({ guarantee_start_date: day(-3), promised_start_date: day(-3) })
    .eq("id", jobId);
  let credit: { status: string; amount_cents: number } | null = null;
  for (let i = 0; i < 4 && !credit; i++) {
    await runWorker();
    const { data } = await db
      .from("on_time_credits")
      .select("status, amount_cents")
      .eq("job_id", jobId)
      .maybeSingle();
    credit = data;
  }
  expect(credit).toMatchObject({ amount_cents: 25_000 });

  await page.goto(`/jobs/${jobId}?section=schedule`);
  await page.getByRole("button", { name: "Approve $250.00 credit" }).click();
  await expect(
    page.getByText(/credit approved\. It goes on the final invoice/).first(),
  ).toBeVisible();
  await shot(page, "edge-on-time-credit");

  // Production finished; the final invoice carries the credit.
  await adminClient(ownerId).rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: "scheduled",
    p_to: "completed",
    p_override: true,
    p_reason: "E2E: production finished outside this test",
  });
  await page.goto(`/jobs/${jobId}?section=financial`);
  const { count } = await db
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("invoice_type", "final");
  if (!count) {
    await page.getByRole("button", { name: "Draft the final invoice" }).click();
    await expect(page.getByText("Final invoice drafted.").first()).toBeVisible();
  }
  await page.goto(`/jobs/${jobId}?section=financial`);
  await page.getByRole("tab", { name: /Invoices/ }).click();
  const final = page
    .locator("li")
    .filter({ hasText: /· Final/ })
    .first();
  await expect(final).toContainText("On-Time Guarantee credit");
  await expect(final).toContainText("−$250.00");
  await expect(final).toContainText("$7,750.00");
});

test("a pre-1978 home needs a certified renovator on the crew", async ({ page }) => {
  test.skip(!SECRET, "needs LEAD_INTAKE_HMAC_SECRET");
  // The website lead says "Before 1978"; the property is flagged lead-safe.
  const res = await intake({
    name: `Leah Leadsafe${t}`,
    email: `leah-${t}@example.com`,
    location: "77 Old Mill Rd, Redmond, WA 98052",
    services: ["Interior"],
    home_built: "Before 1978",
  });
  expect(res.status).toBe(201);
  const { leadId } = (await res.json()) as { leadId: string };
  leadIds.push(leadId);
  const { data: lead } = await adminClient()
    .from("leads")
    .select("home_built")
    .eq("id", leadId)
    .single();
  expect(lead!.home_built).toBe("before_1978");

  const jobId = await seedJob("Leah", "ready_to_schedule", { yearBuilt: 1962 });
  const { data: job } = await adminClient()
    .from("jobs")
    .select("properties!jobs_property_id_fkey(lead_safe_required)")
    .eq("id", jobId)
    .single();
  expect(
    (job as unknown as { properties: { lead_safe_required: boolean } }).properties
      .lead_safe_required,
  ).toBe(true);
  // A crew with the interior skill but no RRP certification.
  const db = adminClient();
  const { data: crew } = await db
    .from("crews")
    .insert({ org_id: orgId, name: `No RRP crew ${t}`, max_jobs_per_day: 1 })
    .select("id")
    .single();
  crewIds.push(crew!.id);
  const { data: skill } = await db
    .from("skills")
    .select("id")
    .eq("org_id", orgId)
    .eq("key", "interior")
    .single();
  await db.from("crew_skills").insert({ org_id: orgId, crew_id: crew!.id, skill_id: skill!.id });

  await page.goto(`/schedule/master?date=${day(7)}`);
  await page.getByTestId(`tray-${jobId}`).getByRole("button", { name: "Schedule job" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Crew", { exact: true }).selectOption(crew!.id);
  await dialog.getByLabel("First day").fill(day(7));
  await dialog.getByLabel("Last day").fill(day(8));
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    `No RRP crew ${t} doesn't have the Lead-safe RRP certified renovator skill. Pre-1978 home (lead-safe work) needs it.`,
  );
  await shot(page, "edge-lead-safe-renovator");
  await page.keyboard.press("Escape");
  // The draft can't be published while the rule blocks it.
  await db.from("schedule_entries").delete().eq("job_id", jobId);
});

test("an out-of-area ZIP is flagged, and a repeat web submission joins the existing lead", async ({
  page,
}) => {
  test.skip(!SECRET, "needs LEAD_INTAKE_HMAC_SECRET");
  const phone = `(206) 55${Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const first = await intake({
    name: `Otto Outside${t}`,
    phone,
    location: "12 Harbor St, Tacoma, WA 98402",
    services: ["Exterior"],
  });
  expect(first.status).toBe(201);
  const { leadId } = (await first.json()) as { leadId: string };
  leadIds.push(leadId);
  const { data: lead } = await adminClient()
    .from("leads")
    .select("out_of_area, territory_id")
    .eq("id", leadId)
    .single();
  expect(lead).toMatchObject({ out_of_area: true, territory_id: null });
  await page.goto(`/leads/${leadId}?tab=details`);
  await expect(page.getByText("Outside service area").first()).toBeVisible();

  const again = await intake({
    name: `Otto Outside${t}`,
    phone: phone.replace(/\D/g, ""),
    email: `otto-${t}@example.com`,
    notes: "Also the fence.",
  });
  expect(again.status).toBe(200);
  expect(((await again.json()) as { leadId: string }).leadId).toBe(leadId);
  const { count } = await adminClient()
    .from("leads")
    .select("id", { count: "exact", head: true })
    .like("last_name", `Outside${t}%`);
  expect(count, "no second lead").toBe(1);
});

test("the crew sees their job but no contract amounts", async ({ browser }, info) => {
  const jobId = await seedJob("Carl", "scheduled", { contractCents: 1_234_500 });
  await adminClient()
    .from("job_team")
    .insert({ org_id: orgId, job_id: jobId, user_id: painterId, role: "painter" });
  const crew = await signedIn(browser, info, "painter", `/jobs/${jobId}`);
  await crew.goto(`/jobs/${jobId}`);
  await expect(crew.getByRole("heading", { level: 1 })).toContainText(`Carl${t}`);
  await expect(crew.getByText("$12,345.00")).toHaveCount(0);
  await expect(crew.getByRole("region", { name: "Money summary" })).toHaveCount(0);
  await crew.goto(`/jobs/${jobId}?section=financial`);
  await expect(crew.getByText("$12,345.00")).toHaveCount(0);
  await crew.context().close();
});

test("View as is read-only and logged", async ({ browser }, info) => {
  const page = await signedIn(browser, info, "owner", "/");
  const since = new Date(Date.now() - 5_000).toISOString();
  await page.getByRole("button", { name: "View as user" }).click();
  const dialog = page.getByRole("dialog", { name: "View as user" });
  await dialog.getByRole("textbox", { name: "Search people" }).fill(TEST_USERS.painter.fullName);
  await dialog.getByRole("button", { name: new RegExp(TEST_USERS.painter.fullName) }).click();
  const banner = page.getByRole("status").filter({ hasText: "Viewing as" });
  await expect(banner).toContainText("read-only");
  // The viewed person's permissions apply (no Admin), and nothing can be saved.
  expect((await page.goto("/admin/company"))?.status()).toBe(404);
  await page.goto("/");
  await banner.getByRole("button", { name: "Exit view as" }).click();
  await expect(banner).toHaveCount(0);
  const { data: logged } = await adminClient()
    .from("activity")
    .select("type, actor_id, impersonated_by")
    .eq("subject_type", "user")
    .eq("subject_id", painterId)
    .eq("type", "view_as_started")
    .gte("created_at", since);
  expect(logged?.length).toBeGreaterThan(0);
  expect(logged!.some((l) => l.actor_id === ownerId || l.impersonated_by === ownerId)).toBe(true);
  await page.context().close();
});
