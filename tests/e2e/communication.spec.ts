import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { signatureHeader } from "../../lib/intake/signature";
import { deleteAccounts, deleteLeadsAndJobs } from "./support/cleanup";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * Phase 8 — Communication & growth (SPEC §11, §8.11, §8.16, §8.18, §8.19,
 * §13.2), against the local stack as the owner:
 *  - Workflows: the 17 seeded workflows, a dry run, the on/off switch
 *  - Templates: a new template with merge fields, preview, SMS counter, approval
 *  - Inbound text → unread conversation → Messages inbox → read; STOP / START
 *  - Composer template picker on a job
 *  - Warranty case: open, acknowledge, book the visit, resolve
 *  - Follow-up lists: power dialer, callback disposition
 *  - Campaign: audience rule, checks, test, send, unsubscribe link
 *  - Bear Champions, Reviews, Notifications settings
 *  - No double sends: a booked walkthrough confirms once, however often the worker runs
 * Everything is simulated (outbox only). Test rows are tagged and removed.
 */

const SCREENS = "docs/screens/phase-8";
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const INBOUND_SECRET = process.env.INBOUND_MESSAGES_SECRET ?? "";
const t = randomUUID().slice(0, 6);

test.describe.configure({ mode: "serial", timeout: 180_000 });

let orgId = "";
let ownerId = "";
let leadId = "";
let jobId = "";
let jobName = "";
let accountId = "";
let contactId = "";
let mobile = "";
let hotLeadId = "";
let hotMobile = "";
let caseId = "";
let campaignId = "";
let templateId = "";
const lastName = `Comm${t}`;
const re = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const hotName = `Hollis Hot${t}`;

async function freePhone(): Promise<string> {
  const db = adminClient();
  for (let i = 0; i < 30; i++) {
    const candidate = `+1425555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    const [{ count: c1 }, { count: c2 }] = await Promise.all([
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .or(`mobile.eq.${candidate},phone.eq.${candidate}`),
      db.from("leads").select("id", { count: "exact", head: true }).eq("mobile", candidate),
    ]);
    if (!c1 && !c2) return candidate;
  }
  throw new Error("no free test phone number");
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
  mobile = await freePhone();
  const { data: lead, error } = await db
    .from("leads")
    .insert({
      org_id: orgId,
      first_name: "Casey",
      last_name: lastName,
      mobile,
      email: `casey-${t}@example.com`,
      street: `${Math.floor(Math.random() * 900) + 100} Sample Ln`,
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      services: ["interior"],
      lead_source: "website",
      owner_id: ownerId,
    })
    .select("id")
    .single();
  if (error) throw error;
  leadId = lead.id;
  const actor = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": ownerId } },
    },
  );
  const { data: newJob, error: convErr } = await actor.rpc("convert_lead_to_job", {
    p_lead: leadId,
  });
  if (convErr) throw convErr;
  jobId = newJob as string;
  const { data: job } = await db
    .from("jobs")
    .select("name, account_id, primary_contact_id")
    .eq("id", jobId)
    .single();
  jobName = job!.name;
  accountId = job!.account_id;
  contactId = job!.primary_contact_id;
  await db.from("contacts").update({ sms_opt_in: true, email_opt_in: true }).eq("id", contactId);

  hotMobile = await freePhone();
  const { data: hot, error: hotErr } = await db
    .from("leads")
    .insert({
      org_id: orgId,
      first_name: "Hollis",
      last_name: `Hot${t}`,
      mobile: hotMobile,
      email: `hollis-${t}@example.com`,
      city: "Redmond",
      state: "WA",
      zip: "98052",
      services: ["exterior"],
      lead_source: "website",
      owner_id: ownerId,
    })
    .select("id")
    .single();
  if (hotErr) throw hotErr;
  hotLeadId = hot.id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  mkdirSync(SCREENS, { recursive: true });
  await seed();
});

test.afterAll(async () => {
  const db = adminClient();
  if (campaignId) {
    await db.from("campaign_recipients").delete().eq("campaign_id", campaignId);
    const { data: msgs } = await db
      .from("messages")
      .select("id, outbox_id")
      .eq("campaign_id", campaignId);
    await db.from("messages").delete().eq("campaign_id", campaignId);
    const outbox = (msgs ?? []).map((m) => m.outbox_id).filter((x): x is string => !!x);
    if (outbox.length) await db.from("integration_outbox").delete().in("id", outbox);
    await db
      .from("integration_outbox")
      .delete()
      .eq("related_type", "campaign")
      .eq("related_id", campaignId);
    await db.from("campaigns").delete().eq("id", campaignId);
  }
  if (templateId) await db.from("message_templates").delete().eq("id", templateId);
  if (caseId) {
    await db.from("appointments").delete().eq("case_id", caseId);
    await db.from("cases").delete().eq("id", caseId);
  }
  const ids = [leadId, hotLeadId].filter(Boolean);
  if (!ids.length) return;
  const { accountIds } = await deleteLeadsAndJobs(ids);
  await deleteAccounts([...new Set([...accountIds, accountId].filter(Boolean))]);
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

async function runWorker(): Promise<void> {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status, "worker should accept the cron secret").toBe(200);
}

const shot = (page: Page, name: string, mobileView: boolean) =>
  page.screenshot({ path: `${SCREENS}/${name}${mobileView ? "-mobile" : ""}.png`, fullPage: true });

async function inbound(body: string, from = mobile) {
  const raw = JSON.stringify({
    channel: "sms",
    from,
    body,
    provider_message_id: `e2e-${t}-${randomUUID().slice(0, 8)}`,
  });
  return fetch(`${BASE}/api/public/messages/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-signature": signatureHeader(INBOUND_SECRET, raw),
    },
    body: raw,
  });
}

test("workflows: the 17 seeded workflows, a dry run against a job, and the switch", async ({
  page,
  isMobile,
}) => {
  await page.goto("/admin/workflows");
  const table = page.getByRole("table", { name: "System workflows" });
  await expect(table.locator("tbody tr")).toHaveCount(17);
  await shot(page, "workflows", isMobile);
  await axe(page);

  await page.goto("/admin/workflows/paid_in_full#test");
  await page.getByLabel("Record").selectOption(jobId);
  await page.getByRole("button", { name: "Run test" }).click();
  const result = page.locator('[aria-live="polite"]').filter({ has: page.locator("ol") });
  await expect(result.locator("li").first()).toBeVisible();
  await expect(result).toContainText("Thank-you with warranty info");
  await shot(page, "workflow-test", isMobile);

  if (isMobile) return; // the switch is shared: flip it once
  await page.goto("/admin/workflows");
  await page.getByRole("switch", { name: /^Turn off Subcontractor paperwork/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(dialog.getByText(/at least 5 characters/)).toBeVisible();
  await dialog.getByLabel("Why?").fill(`E2E check ${t}`);
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText(`Off: E2E check ${t}`)).toBeVisible();
  await page.getByRole("switch", { name: /^Turn on Subcontractor paperwork/ }).click();
  await expect(page.getByText(`Off: E2E check ${t}`)).toBeHidden();
});

test("templates: write one with merge fields, preview it, count the text, approve it", async ({
  page,
  isMobile,
}) => {
  await page.goto("/admin/templates");
  await expect(page.getByText(/still “Draft – owner to approve”/)).toBeVisible();
  await page.goto("/admin/templates/new");
  await page.getByLabel("Name", { exact: true }).fill(`E2E note ${t}`);
  await page.getByLabel("Key", { exact: true }).fill(`e2e_note_${t}`);
  await page
    .getByLabel("Message", { exact: true })
    .fill("Hi {{contact.first_name}}, this is {{company.name}}. See you soon!");
  await expect(page.getByText(/1 text/).first()).toBeVisible();
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page).toHaveURL(/\/admin\/templates\/[0-9a-f-]{36}/);
  templateId = page.url().split("/").pop()!.split(/[?#]/)[0]!;
  await expect(page.getByText("Draft – owner to approve").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" })).toContainText("this is Brushy Bear");
  await page.getByRole("button", { name: "Approve wording" }).click();
  await expect(page.getByText(/^Approved/).first()).toBeVisible();
  await shot(page, "template-editor", isMobile);
  await axe(page);
});

test("an inbound text opens an unread conversation; reading it clears it; STOP and START", async ({
  page,
  isMobile,
}) => {
  test.skip(!INBOUND_SECRET, "INBOUND_MESSAGES_SECRET is not set for this run");
  const db = adminClient();
  const res = await inbound(`Is Tuesday still on? ${t}`);
  expect(res.status).toBe(200);
  await expect
    .poll(async () => {
      const { data } = await db
        .from("message_threads")
        .select("unread")
        .eq("subject_type", "job")
        .eq("subject_id", jobId)
        .maybeSingle();
      return data?.unread ?? null;
    })
    .toBe(true);

  await page.goto("/messages");
  const conv = page.getByRole("region", { name: "Conversations" });
  await expect(conv.getByRole("link", { name: re(jobName) })).toBeVisible();
  await shot(page, "inbox", isMobile);
  await conv.getByRole("link", { name: re(jobName) }).click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toContainText(
    `Is Tuesday still on? ${t}`,
  );
  await expect
    .poll(async () => {
      const { data } = await db
        .from("message_threads")
        .select("unread")
        .eq("subject_type", "job")
        .eq("subject_id", jobId)
        .single();
      return data?.unread;
    })
    .toBe(false);
  await shot(page, "inbox-thread", isMobile);
  await axe(page);

  // STOP opts the number out of texts everywhere it's on file; START opts back in.
  expect((await inbound("STOP")).status).toBe(200);
  await expect
    .poll(async () => {
      const { data } = await db
        .from("contacts")
        .select("opted_out_at")
        .eq("id", contactId)
        .single();
      return !!data?.opted_out_at;
    })
    .toBe(true);
  await page.goto(`/jobs/${jobId}?section=messages`);
  await expect(page.getByText(/replied STOP|opted out/i).first()).toBeVisible();
  expect((await inbound("START")).status).toBe(200);
  await expect
    .poll(async () => {
      const { data } = await db
        .from("contacts")
        .select("opted_out_at")
        .eq("id", contactId)
        .single();
      return data?.opted_out_at ?? null;
    })
    .toBeNull();
});

test("job composer: start a text from a template", async ({ page }) => {
  await page.goto(`/jobs/${jobId}?section=messages`);
  const picker = page.getByLabel("Start from a template");
  await picker.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByLabel("Text message")).not.toHaveValue("");
});

test("warranty case: open it from the job, book the visit, tell the customer, resolve it", async ({
  page,
  isMobile,
}) => {
  const db = adminClient();
  await page.goto(`/cases/new?job=${jobId}`);
  await page.getByLabel("What's the issue?").fill(`Peeling on the back door ${t}`);
  await page.getByLabel("Tell the customer we got it").selectOption("email");
  await page.getByRole("button", { name: "Open case" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  caseId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: `Peeling on the back door ${t}` })).toBeVisible();
  await expect
    .poll(async () => {
      const { count } = await db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("subject_type", "job")
        .eq("subject_id", jobId)
        .eq("template_key", "case_received");
      return count;
    })
    .toBe(1);

  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  await page.getByLabel("Date", { exact: true }).fill(tomorrow);
  await page.getByLabel("Time", { exact: true }).fill("10:00");
  await page.getByLabel("Confirm with the customer").selectOption("sms");
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByText("Warranty visit booked.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Warranty visits" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("scheduled");
  const { data: visit } = await db
    .from("appointments")
    .select("type, job_id")
    .eq("case_id", caseId)
    .single();
  expect(visit).toMatchObject({ type: "warranty_visit", job_id: jobId });
  await shot(page, "case", isMobile);
  await axe(page);

  await page.getByLabel("Status", { exact: true }).selectOption("resolved");
  await page.getByLabel("What was done").fill("Sanded and repainted the door trim.");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText(/^Resolved/).first()).toBeVisible();
  const { data: c } = await db
    .from("cases")
    .select("status, resolved_at")
    .eq("id", caseId)
    .single();
  expect(c?.status).toBe("resolved");

  await page.goto(`/jobs/${jobId}?section=onboarding&tab=cases`);
  await expect(page.getByRole("link", { name: `Peeling on the back door ${t}` })).toBeVisible();
  await page.goto("/cases?filter=resolved");
  await expect(page.getByRole("link", { name: `Peeling on the back door ${t}` })).toBeVisible();
  await shot(page, "cases", isMobile);
});

test("follow-up lists: work Hot New Leads in the power dialer and set a callback", async ({
  page,
  isMobile,
}) => {
  const db = adminClient();
  await page.goto("/follow-ups");
  await expect(page.getByRole("link", { name: /Hot New Leads/ })).toBeVisible();
  await shot(page, "follow-up-lists", isMobile);
  await page.getByRole("link", { name: /Hot New Leads/ }).click();
  await page
    .getByRole("navigation", { name: "Queue" })
    .getByRole("button", { name: re(hotName) })
    .click();
  await expect(page.getByRole("heading", { name: hotName })).toBeVisible();
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect(page.getByText(/Simulated – not placed/)).toBeVisible();
  await page.getByRole("button", { name: "Call back later" }).click();
  await page.getByRole("button", { name: /Save & next/ }).click();
  await expect(page.getByText("Pick when to call back.")).toBeVisible();
  const when = new Date(Date.now() + 86_400_000)
    .toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" })
    .slice(0, 10);
  await page.getByLabel(/Call back at/).fill(`${when}T10:30`);
  await page.getByLabel("Notes (optional)", { exact: true }).fill(`Asked to call tomorrow ${t}`);
  await shot(page, "power-dialer", isMobile);
  await page.getByRole("button", { name: /Save & next/ }).click();
  await expect(page.getByText("Logged: Call back later.")).toBeVisible();
  const { data: attempt } = await db
    .from("follow_up_attempts")
    .select("disposition_key, disposition_group, callback_at, message_id")
    .eq("subject_id", hotLeadId)
    .single();
  expect(attempt).toMatchObject({ disposition_key: "call_back", disposition_group: "callback" });
  expect(attempt?.callback_at).not.toBeNull();
  expect(attempt?.message_id).not.toBeNull();
  const { data: lead } = await db.from("leads").select("disposition").eq("id", hotLeadId).single();
  expect(lead?.disposition).toBe("call_back");
  await axe(page);
});

test("no double sends: a booked walkthrough confirms once, however often the worker runs", async ({
  isMobile,
}) => {
  test.skip(isMobile, "API test: runs once on desktop");
  const db = adminClient();
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const { error } = await db.from("appointments").insert({
    org_id: orgId,
    lead_id: hotLeadId,
    type: "walkthrough",
    title: "Walkthrough",
    starts_at: start,
    ends_at: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
    assigned_user_ids: [ownerId],
  });
  if (error) throw error;
  const count = async () => {
    const { data } = await db
      .from("messages")
      .select("channel")
      .eq("template_key", "walkthrough_confirmation")
      .in("to_address", [hotMobile, `hollis-${t}@example.com`]);
    return (data ?? []).map((m) => m.channel).sort();
  };
  await expect
    .poll(
      async () => {
        await runWorker();
        return count();
      },
      { timeout: 60_000 },
    )
    .toEqual(["email", "sms"]);
  await runWorker();
  await runWorker();
  expect(await count()).toEqual(["email", "sms"]);
  const { data: runs } = await db
    .from("workflow_runs")
    .select("id, workflows!inner(key)")
    .eq("workflows.key", "walkthrough_booked")
    .eq("subject_type", "appointment")
    .in(
      "subject_id",
      ((await db.from("appointments").select("id").eq("lead_id", hotLeadId)).data ?? []).map(
        (a) => a.id,
      ),
    );
  expect(runs ?? []).toHaveLength(1);
});

test("campaign: audience rule, checks, test to me, send, and the unsubscribe link", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "builds and sends one campaign on desktop");
  const db = adminClient();
  // The STOP earlier cleared all marketing consent (SPEC §13.2); they opted in again.
  await db.from("contacts").update({ email_opt_in: true }).eq("id", contactId);
  await page.goto("/campaigns");
  await shot(page, "campaigns", false);
  await page.goto("/campaigns/new");
  await page.getByLabel("Name (only the team sees it)").fill(`Spring dates ${t}`);
  await page.getByRole("button", { name: "Advanced" }).click();
  const dialog = page.getByRole("dialog", { name: "Advanced filter" });
  await dialog.getByRole("combobox", { name: "Rule 1 field" }).selectOption({ label: "Last name" });
  await dialog.getByRole("textbox", { name: "Rule 1 value" }).fill(lastName);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Spring painting dates are open");
  await page
    .getByLabel("Email", { exact: true })
    .fill("Hi {{contact.first_name}}, spring dates are open. Reply to grab one. {{company.name}}");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
  campaignId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Run checks" }).click();
  const checks = page.getByRole("region", { name: "Audience & checks" });
  await expect(checks).toContainText("1 of 1 can get it");
  await expect(checks).toContainText("unsubscribe link");
  await shot(page, "campaign-editor", false);
  await axe(page);
  await page.getByRole("button", { name: "Send a test to me" }).click();
  await expect(page.getByText(/Test recorded for/)).toBeVisible();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(/Sending to 1 people/)).toBeVisible();

  await expect
    .poll(
      async () => {
        await runWorker();
        const { data } = await db.from("campaigns").select("status").eq("id", campaignId).single();
        return data?.status;
      },
      { timeout: 60_000 },
    )
    .toBe("sent");
  const { data: msg } = await db
    .from("messages")
    .select("body, status, subject_type, subject_id, message_type")
    .eq("campaign_id", campaignId)
    .single();
  expect(msg).toMatchObject({
    status: "simulated",
    subject_type: "contact",
    subject_id: contactId,
    message_type: "marketing",
  });
  expect(msg?.body).toContain("Hi Casey, spring dates are open.");
  const link = /\/u\/[A-Za-z0-9_.-]+/.exec(msg?.body ?? "")?.[0];
  expect(link).toBeTruthy();
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByText("Sent (simulated)")).toBeVisible();
  await shot(page, "campaign-sent", false);

  await page.goto(link!);
  await expect(
    page.getByRole("heading", { name: "Unsubscribe from marketing emails?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByText("You're unsubscribed.", { exact: false })).toBeVisible();
  const { data: contact } = await db
    .from("contacts")
    .select("email_opted_out_at")
    .eq("id", contactId)
    .single();
  expect(contact?.email_opted_out_at).not.toBeNull();
  await shot(page, "unsubscribe", false);
});

test("Bear Champions, Reviews and notification settings", async ({ page, isMobile }) => {
  const db = adminClient();
  await page.goto("/referrals");
  if (!isMobile) {
    await page.getByLabel("Make a customer a Bear Champion").selectOption(contactId);
    await page.getByRole("button", { name: "Add champion" }).click();
    await expect(page.getByText(/Bear Champion added with code BEAR-/)).toBeVisible();
    const { data: champ } = await db
      .from("referral_champions")
      .select("code")
      .eq("contact_id", contactId)
      .single();
    expect(champ?.code).toMatch(/^BEAR-[A-Z0-9]{4}$/);
    await expect(page.getByText(champ!.code)).toBeVisible();
  }
  await shot(page, "referrals", isMobile);
  await axe(page);
  await page.goto("/referrals?tab=settings");
  await expect(page.getByLabel("Code prefix")).toHaveValue("BEAR");

  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await shot(page, "reviews", isMobile);
  await axe(page);

  await page.goto("/r/not-a-real-review-token-000000");
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Notifications" }).click();
  await expect(page.getByRole("checkbox", { name: /Mentions: in-app/ })).toBeDisabled();
  await shot(page, "settings-notifications", isMobile);
  await page.goto("/admin/notifications");
  await expect(page.getByRole("checkbox", { name: "Mentions: in-app required" })).toBeChecked();
  await shot(page, "admin-notifications", isMobile);
  await axe(page);
});
