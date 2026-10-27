import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { deleteAccounts, deleteLeadsAndJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * Job Detail sections (SPEC §8.5 #10 Customer, #11 Messages, #12 Tasks &
 * Checklists, #14 Notes, #15 Activity Log), opened at
 * /jobs/<id>?section=customer|messages|tasks|notes|activity.
 *
 * One fake lead is converted to a job with the database RPC, then each role
 * signs in fresh. Everything is tagged and removed in afterAll.
 */

const SCREENS = "docs/screens/phase-3";
const t = randomUUID().slice(0, 6);
const GATE_CODE = `4521-${t}`;
const CONTRACT_CENTS = 1_234_500;

test.describe.configure({ mode: "serial", timeout: 240_000 });

let leadId = "";
let jobId = "";
let jobName = "";
let accountId = "";
let contactId = "";
const ids = {} as Record<TestRole, string>;

const url = (section: string) => `/jobs/${jobId}?section=${section}`;

function encryptForTest(plaintext: string): string {
  // Same format as lib/crypto/field-encryption.ts (that module is server-only).
  const key = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "", "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(":");
}

async function seed() {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  for (const role of Object.keys(TEST_USERS) as TestRole[]) {
    const { data } = await db
      .from("profiles")
      .select("id")
      .eq("email", TEST_USERS[role].email)
      .single();
    ids[role] = data!.id;
  }
  // A fictional 555 number nobody else uses, so conversion makes a fresh customer.
  let mobile = "";
  for (let i = 0; i < 20 && !mobile; i++) {
    const candidate = `+1425555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    const [{ count: c1 }, { count: c2 }] = await Promise.all([
      db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .or(`mobile.eq.${candidate},phone.eq.${candidate}`),
      db.from("leads").select("id", { count: "exact", head: true }).eq("mobile", candidate),
    ]);
    if (!c1 && !c2) mobile = candidate;
  }
  const { data: lead, error } = await db
    .from("leads")
    .insert({
      org_id: org!.id,
      first_name: "Jodi",
      last_name: `Sections${t}`,
      mobile,
      email: `jodi-${t}@example.com`,
      street: `${Math.floor(Math.random() * 900) + 100} Sample Ave`,
      city: "Bellevue",
      state: "WA",
      zip: "98004",
      services: ["exterior"],
      home_built: "before_1978",
      lead_source: "website",
      owner_id: ids.owner,
    })
    .select("id, org_id")
    .single();
  if (error) throw error;
  leadId = lead.id;
  // History from the lead stage: a text and a note (the note moves to the job).
  await db.from("messages").insert({
    org_id: lead.org_id,
    channel: "sms",
    direction: "inbound",
    subject_type: "lead",
    subject_id: leadId,
    body: `Lead-era text ${t}`,
    status: "received",
    simulated: true,
  });
  await db.from("notes").insert({
    org_id: lead.org_id,
    subject_type: "lead",
    subject_id: leadId,
    body: `Walkthrough notes from the lead ${t}`,
    created_by: ids.owner,
  });

  const actor = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": ids.owner } },
    },
  );
  const { data: newJob, error: convErr } = await actor.rpc("convert_lead_to_job", {
    p_lead: leadId,
  });
  if (convErr) throw convErr;
  jobId = newJob as string;
  const { data: job } = await db
    .from("jobs")
    .select("name, account_id, property_id, primary_contact_id")
    .eq("id", jobId)
    .single();
  jobName = job!.name;
  accountId = job!.account_id;
  contactId = job!.primary_contact_id;

  await db
    .from("properties")
    .update({
      occupancy: "occupied",
      pets: `Friendly lab ${t}`,
      access_notes: "Side gate on the left",
      parking: "Driveway",
    })
    .eq("id", job!.property_id);
  await db.from("property_secrets").insert({
    property_id: job!.property_id,
    org_id: lead.org_id,
    access_code_ciphertext: encryptForTest(GATE_CODE),
  });
  await db
    .from("job_financials")
    .upsert({ job_id: jobId, org_id: lead.org_id, contract_baseline_cents: CONTRACT_CENTS });
  // The estimator is on the team and owns the account, so they can open both.
  await db.from("job_team").insert({
    org_id: lead.org_id,
    job_id: jobId,
    user_id: ids.estimator,
    role: "estimator",
  });
  await db.from("accounts").update({ owner_id: ids.estimator }).eq("id", accountId);
  // An overdue task (yesterday).
  await db.from("tasks").insert({
    org_id: lead.org_id,
    subject_type: "job",
    subject_id: jobId,
    title: `Overdue follow-up ${t}`,
    due_at: new Date(Date.now() - 86_400_000).toISOString(),
    assignee_id: ids.owner,
    created_by: ids.owner,
  });
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await seed();
});

test.afterAll(async () => {
  const db = adminClient();
  // Job mentions carry no link yet (see the report), so clean them up by tag.
  await db.from("notifications").delete().eq("type", "mention").like("body", `%${t}%`);
  if (!leadId) return;
  const { accountIds } = await deleteLeadsAndJobs([leadId]);
  await deleteAccounts(accountIds.length ? accountIds : [accountId].filter(Boolean));
});

async function newPage(browser: Browser, info: TestInfo, role: TestRole, next: string) {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    timezoneId: use.timezoneId,
    locale: use.locale,
  });
  const page = await context.newPage();
  await loginAs(page, role, next);
  return page;
}

/** Opens a page and waits for hydration; retries the shared dev server's transient 500s. */
async function open(page: Page, path: string) {
  let res = await page.goto(path);
  for (let i = 0; i < 3 && res?.status() === 500; i++) {
    await page.waitForTimeout(2000);
    res = await page.goto(path);
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  return res;
}

/** Waits for the success toast, then reloads (proves the change was saved). */
async function afterSave(page: Page, toast: string | RegExp, path: string) {
  await expect(page.getByText(toast).first()).toBeVisible({ timeout: 45_000 });
  await open(page, path);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const SECTIONS = ["customer", "messages", "tasks", "notes", "activity"] as const;

test.describe("as the owner", () => {
  test.skip(({ isMobile }) => isMobile, "Flows run on desktop; mobile layout is checked below");
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    page = await newPage(browser, info, "owner", url("tasks"));
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("tasks: overdue styling, add and complete a task", async () => {
    await open(page, url("tasks"));
    await expect(page.getByText(jobName).first()).toBeVisible();
    const overdue = page.getByRole("listitem").filter({ hasText: `Overdue follow-up ${t}` });
    await expect(overdue).toContainText("overdue");
    await expect(
      page.getByText(/Checklists \(exterior prep, cabinet process, lead-safe, final walkthrough\)/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add Task" }).first().click();
    const title = `Confirm trim colors ${t}`;
    await page.getByRole("textbox", { name: "Task", exact: true }).fill(title);
    await page.getByLabel("Priority").selectOption("high");
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await afterSave(page, "Task added.", url("tasks"));
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText("High")).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/job-sections-tasks.png` });

    await page.getByRole("checkbox", { name: `Mark “${title}” done` }).click();
    await afterSave(page, "Task done.", url("tasks"));
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
    await page.getByLabel(/Show completed/).click();
    await expect(page.getByRole("checkbox", { name: `Reopen “${title}”` })).toBeChecked();
    const { data: task } = await adminClient()
      .from("tasks")
      .select("status, completed_at, subject_type")
      .eq("subject_id", jobId)
      .eq("title", title)
      .single();
    expect(task).toMatchObject({ status: "done", subject_type: "job" });
  });

  test("notes: add a pinned note and a comment that mentions a teammate", async () => {
    await open(page, url("notes"));
    // The lead's note moved to the job on conversion.
    await expect(page.getByText(`Walkthrough notes from the lead ${t}`)).toBeVisible();

    await page.getByLabel("Note", { exact: true }).fill(`Dog stays inside on paint days ${t}`);
    await page.getByLabel("Priority").selectOption("urgent");
    await page.getByLabel("Pin to top").check();
    await page.getByRole("button", { name: "Add note" }).click();
    await afterSave(page, "Note added.", url("notes"));
    const first = page.getByRole("list", { name: "Notes" }).getByRole("listitem").first();
    await expect(first).toContainText(`Dog stays inside on paint days ${t}`);
    await expect(first.getByText("Pinned")).toBeVisible();
    await expect(first.getByText("Urgent")).toBeVisible();

    await page
      .getByRole("group", { name: "Post type" })
      .getByRole("button", { name: "Comment" })
      .click();
    await expect(page.getByText("Team discussion – staff only")).toBeVisible();
    await page.getByLabel("Comment", { exact: true }).fill(`Can you confirm the colors ${t}`);
    await page.getByRole("button", { name: "Mention someone" }).click();
    await page.getByPlaceholder("Find a teammate…").fill("Otto");
    await page.getByRole("option", { name: TEST_USERS.office_manager.fullName }).click();
    await expect(page.getByRole("list", { name: "Mentioned" })).toContainText("@Otto Office");
    await page.getByRole("button", { name: "Add comment" }).click();
    await afterSave(page, "Comment added.", url("notes"));
    const comment = page
      .getByRole("listitem")
      .filter({ hasText: `Can you confirm the colors ${t}` });
    await expect(comment).toContainText("Comment · staff only");
    await expect(comment).toContainText("@Otto Office");

    const { data: notes } = await adminClient()
      .from("notifications")
      .select("type, title")
      .eq("user_id", ids.office_manager)
      .eq("type", "mention")
      .like("body", `%${t}%`);
    expect(notes).toHaveLength(1);
    expect(notes?.[0]?.title).toBe(`${TEST_USERS.owner.fullName} mentioned you`);
  });

  test("notes: unpin, filter chips and search", async () => {
    await open(page, url("notes"));
    const chips = page.getByRole("group", { name: "Filter the feed" });
    await chips.getByRole("button", { name: /^Comments/ }).click();
    const list = page.getByRole("list", { name: "Notes" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText(`Can you confirm the colors ${t}`);
    await chips.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search the feed").fill(`dog ${t}`);
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Dog stays inside");
    await page.getByLabel("Search the feed").fill("");
    await page.screenshot({ path: `${SCREENS}/job-sections-notes.png` });

    await list
      .getByRole("listitem")
      .filter({ hasText: "Dog stays inside" })
      .getByRole("button", { name: "Unpin note" })
      .click();
    await afterSave(page, "Note unpinned.", url("notes"));
    await expect(
      page.getByRole("listitem").filter({ hasText: "Dog stays inside" }).getByText("Pinned"),
    ).toHaveCount(0);
  });

  test("notes: edit a comment, delete a note, create a task from a post", async () => {
    await open(page, url("notes"));
    const comment = () => page.getByRole("listitem").filter({ hasText: `confirm the colors ${t}` });
    await comment().getByRole("button", { name: "Edit comment" }).click();
    await page.getByLabel("Comment", { exact: true }).fill(`Please confirm the colors ${t}`);
    await page.getByRole("button", { name: "Save comment" }).click();
    await afterSave(page, "Comment saved.", url("notes"));
    await expect(comment()).toContainText(`Please confirm the colors ${t}`);
    await expect(comment()).toContainText("edited");

    const leadNote = page
      .getByRole("listitem")
      .filter({ hasText: `Walkthrough notes from the lead ${t}` });
    await leadNote.getByRole("button", { name: "Delete note" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await afterSave(page, "Note deleted.", url("notes"));
    await expect(page.getByText(`Walkthrough notes from the lead ${t}`)).toHaveCount(0);

    await page
      .getByRole("listitem")
      .filter({ hasText: "Dog stays inside" })
      .getByRole("button", { name: "Create task from post" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create a task from this post" });
    await expect(dialog.getByRole("textbox", { name: "Task", exact: true })).toHaveValue(
      `Follow up: Dog stays inside on paint days ${t}`,
    );
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Task added.").first()).toBeVisible({ timeout: 45_000 });
    const { data: tasks } = await adminClient()
      .from("tasks")
      .select("title, assignee_id")
      .eq("subject_type", "job")
      .eq("subject_id", jobId)
      .like("title", "Follow up:%");
    expect(tasks).toEqual([
      { title: `Follow up: Dog stays inside on paint days ${t}`, assignee_id: ids.owner },
    ]);

    await open(page, url("notes"));
    await comment().getByRole("button", { name: "Delete comment" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await afterSave(page, "Comment deleted.", url("notes"));
    await expect(comment()).toHaveCount(0);
    const { data: gone } = await adminClient()
      .from("comments")
      .select("deleted_at")
      .eq("subject_id", jobId)
      .single();
    expect(gone?.deleted_at).not.toBeNull();
  });

  test("messages: send a text (simulated), log a call, see the lead's history", async () => {
    await open(page, url("messages"));
    await expect(
      page.getByText("Customer-facing. Internal notes and comments stay separate."),
    ).toBeVisible();
    await expect(page.getByLabel("Template")).toBeDisabled();
    const lead = page.getByRole("listitem").filter({ hasText: `Lead-era text ${t}` });
    await expect(lead.getByText("From the lead")).toBeVisible();

    const body = `Hi Jodi, the crew arrives Tuesday at 8. ${t}`;
    await page.getByLabel("Text message").fill(body);
    await expect(page.getByText(/ \/ 160 · 1 text/)).toBeVisible();
    await page.getByRole("button", { name: "Send text" }).click();
    await afterSave(page, /Text recorded in the outbox/, url("messages"));
    const sent = page.getByRole("listitem").filter({ hasText: body });
    await expect(sent.getByText("Simulated – not sent")).toBeVisible();

    const db = adminClient();
    const { data: msg } = await db
      .from("messages")
      .select("status, outbox_id, contact_id")
      .eq("subject_type", "job")
      .eq("subject_id", jobId)
      .eq("channel", "sms")
      .single();
    expect(msg).toMatchObject({ status: "simulated", contact_id: contactId });
    const { data: outbox } = await db
      .from("integration_outbox")
      .select("status, domain, related_type, related_id, rendered_body")
      .eq("id", msg!.outbox_id)
      .single();
    expect(outbox).toMatchObject({
      status: "simulated",
      domain: "sms_voice",
      related_type: "job",
      related_id: jobId,
      rendered_body: body,
    });

    await page
      .getByRole("group", { name: "Message type" })
      .getByRole("button", { name: "Log call" })
      .click();
    await expect(page.getByRole("link", { name: /Dial .* from your phone/ })).toHaveAttribute(
      "href",
      /^tel:\+1425/,
    );
    await page.getByLabel("Outcome").selectOption({ label: "Left voicemail" });
    await page.getByLabel("Duration (minutes)").fill("3");
    await page.getByLabel("Call notes").fill(`Asked about the start date ${t}`);
    await page.getByRole("button", { name: "Log call" }).last().click();
    await afterSave(page, "Call logged.", url("messages"));
    await expect(
      page.getByRole("listitem").filter({ hasText: `Asked about the start date ${t}` }),
    ).toContainText("Outcome: Left voicemail · 3 min");
    await page.screenshot({ path: `${SCREENS}/job-sections-messages.png` });
  });

  test("messages: Do Not Contact blocks sending", async () => {
    const db = adminClient();
    await db.from("contacts").update({ do_not_contact: true }).eq("id", contactId);
    try {
      await open(page, url("messages"));
      await expect(page.getByText(/asked not to be contacted/).first()).toBeVisible();
      await expect(page.getByLabel("Text message")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Send text" })).toBeDisabled();
      await page
        .getByRole("group", { name: "Message type" })
        .getByRole("button", { name: "Email" })
        .click();
      await expect(page.getByRole("button", { name: "Send email" })).toBeDisabled();
    } finally {
      await db.from("contacts").update({ do_not_contact: false }).eq("id", contactId);
    }
  });

  test("activity log: everything, including the lead's history", async () => {
    await open(page, url("activity"));
    const feed = page.getByRole("list", { name: "Activity" });
    await expect(feed.getByText("Job created from a lead")).toBeVisible();
    await expect(
      feed.getByRole("listitem").filter({ hasText: `Lead-era text ${t}` }),
    ).toBeVisible();
    await expect(feed.getByText("From the lead").first()).toBeVisible();
    const chips = page.getByRole("group", { name: "Filter the feed" });
    await expect(chips.getByRole("button", { name: /^Documents\s*0$/ })).toBeVisible();
    await chips.getByRole("button", { name: /^Messages/ }).click();
    await expect(
      feed.getByRole("listitem").filter({ hasText: "Simulated – not sent" }),
    ).toHaveCount(1);
    await chips.getByRole("button", { name: /^Photos/ }).click();
    await expect(page.getByText("Documents and photos arrive in Phase 5.")).toBeVisible();
  });

  test("customer: account numbers, gate code reveal, contacts and jobs", async () => {
    await open(page, url("customer"));
    await expect(page.getByRole("heading", { name: `Sections${t} Residence` })).toBeVisible();
    await expect(page.getByText("Lifetime contract value")).toBeVisible();
    await expect(page.getByText("$12,345.00")).toBeVisible();
    await expect(page.getByText(`Friendly lab ${t}`)).toBeVisible();
    await expect(page.getByTestId("access-code-value")).toHaveText("••••••");
    await page.getByRole("button", { name: "Show code" }).click();
    await expect(page.getByTestId("access-code-value")).toHaveText(GATE_CODE);
    const contacts = page.getByRole("list", { name: "Contacts" });
    await expect(contacts.getByRole("img", { name: "Primary contact" })).toBeVisible();
    await expect(contacts.getByRole("link", { name: `Jodi Sections${t}` })).toBeVisible();
    const jobs = page.getByRole("list", { name: "Jobs for this customer" });
    await expect(jobs.getByText("This job")).toBeVisible();
    await expect(page.getByText("Arrives with e-signature (Phase 4).")).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/job-sections-customer.png`, fullPage: true });
  });

  test("accessibility: no serious or critical issues in any section", async () => {
    for (const s of SECTIONS) {
      await open(page, url(s));
      await expect(page.getByText(jobName).first()).toBeVisible();
      expect(await seriousAxe(page), s).toEqual([]);
    }
  });
});

test.describe("internal team (office manager)", () => {
  test.skip(({ isMobile }) => isMobile, "Runs once on desktop");

  test("add a teammate, who can then open the job; remove them again", async ({
    browser,
  }, info) => {
    const office = await newPage(browser, info, "office_manager", url("customer"));
    const painter = await newPage(browser, info, "painter", "/");
    try {
      // Not on the team yet: the job is hidden from the painter.
      expect((await open(painter, url("notes")))?.status()).toBe(404);

      await open(office, url("customer"));
      await office.getByLabel("Teammate").selectOption({ label: TEST_USERS.painter.fullName });
      await office.getByLabel("Role").selectOption("painter");
      await office.getByRole("button", { name: "Add teammate" }).click();
      await afterSave(office, "Teammate added.", url("customer"));
      const team = office.getByRole("list", { name: "Internal team" });
      await expect(team.getByText(TEST_USERS.painter.fullName)).toBeVisible();
      const { data: job } = await adminClient()
        .from("jobs")
        .select("team_user_ids")
        .eq("id", jobId)
        .single();
      expect(job!.team_user_ids).toContain(ids.painter);

      expect((await open(painter, url("notes")))?.status()).toBe(200);
      await expect(painter.getByText(jobName).first()).toBeVisible();

      await office
        .getByRole("button", { name: `Remove ${TEST_USERS.painter.fullName} (Painter)` })
        .click();
      await afterSave(office, /removed from the team/, url("customer"));
      await expect(team.getByText(TEST_USERS.painter.fullName)).toHaveCount(0);
      expect((await open(painter, url("notes")))?.status()).toBe(404);

      await open(office, url("activity"));
      await expect(
        office.getByText(`${TEST_USERS.painter.fullName} added to the team as painter`),
      ).toBeVisible();
    } finally {
      await office.context().close();
      await painter.context().close();
    }
  });
});

test.describe("estimator without financials or access codes", () => {
  test.skip(({ isMobile }) => isMobile, "Runs once on desktop");

  test("sees the customer but no lifetime value and no gate code", async ({ browser }, info) => {
    const page = await newPage(browser, info, "estimator", url("customer"));
    try {
      await open(page, url("customer"));
      await expect(page.getByRole("heading", { name: `Sections${t} Residence` })).toBeVisible();
      await expect(page.getByText("Lifetime contract value")).toHaveCount(0);
      await expect(page.getByText("$12,345.00")).toHaveCount(0);
      await expect(page.getByText("Hidden for your role")).toBeVisible();
      await expect(page.getByRole("button", { name: "Show code" })).toHaveCount(0);
      await expect(page.getByText(GATE_CODE)).toHaveCount(0);
      // Estimators can't assign jobs.
      await expect(page.getByRole("button", { name: "Add teammate" })).toHaveCount(0);
      // Their own-scope task list is empty here: the friendly empty state shows.
      await open(page, url("tasks"));
      await expect(
        page.getByText("No tasks yet. Add a follow-up to stay on top of this job."),
      ).toBeVisible();
    } finally {
      await page.context().close();
    }
  });
});

test.describe("layout at 390px", () => {
  test("no sideways scroll and no serious issues in any section", async ({ browser }, info) => {
    const page = await newPage(browser, info, "owner", url("notes"));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const s of SECTIONS) {
        await open(page, url(s));
        await expect(page.getByText(jobName).first()).toBeVisible();
        await noSideScroll(page);
        expect(await seriousAxe(page), s).toEqual([]);
      }
    } finally {
      await page.context().close();
    }
  });
});
