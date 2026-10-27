import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, TEST_USERS } from "./support/users";

/**
 * Phase 6 — Production (SPEC §5.4, §6.2 gates 6–9, §8.5, §8.6, §8.8, §1.3).
 * PLAN "done when":
 *  - a conflicting schedule is blocked with a clear reason;
 *  - Publish sends simulated customer and crew notices (outbox rows);
 *  - (the 7 pm missed-daily-log rule is a unit test with a fixed clock).
 * Plus: the daily log from a phone (cleanup check + photo required, works
 * offline), the field screens, the job's production sections, and the
 * customer's punch-list sign-off moving the job to Completed.
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-6";
mkdirSync(SCREENS, { recursive: true });

test.describe.configure({ mode: "serial", timeout: 240_000 });

const pacificToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const x = new Date(`${iso}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const nextMonday = (iso: string) => {
  let d = iso;
  while (dow(d) !== 1) d = addDays(d, 1);
  return d;
};

const today = pacificToday();
const isWeekday = dow(today) >= 1 && dow(today) <= 5;
/** A Monday at least a week out: the blocker is booked Mon–Tue. */
const MON = nextMonday(addDays(today, 7));

let orgId = "";
let ownerId = "";
let painterId = "";
let accountId = "";
let crewId = "";
const crewName = `Crew ${t}`;
const jobs = { a: "", blocker: "", live: "", punch: "" };
const labels = { a: "", blocker: "", live: "", punch: "" };

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

async function photo(color: string): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

async function makeJob(
  key: keyof typeof jobs,
  name: string,
  propertyId: string,
  contactId: string,
  stage: string,
) {
  const db = adminClient();
  const { data: job, error } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `${name}${t} – Redmond – Interior`,
      account_id: accountId,
      property_id: propertyId,
      primary_contact_id: contactId,
      work_types: ["interior"],
      owner_id: ownerId,
      point_of_contact_id: ownerId,
      estimated_duration_days: 2,
    })
    .select("id, job_number, name")
    .single();
  if (error) throw error;
  jobs[key] = job!.id;
  labels[key] = `${job!.job_number} · ${job!.name}`;
  const now = Date.now();
  await db.from("appointments").insert({
    org_id: orgId,
    job_id: job!.id,
    type: "walkthrough",
    starts_at: new Date(now - 7_200_000).toISOString(),
    ends_at: new Date(now - 3_600_000).toISOString(),
    status: "completed",
    result: "measured",
  });
  const { error: e2 } = await asOwner().rpc("apply_job_stage_change", {
    p_job: job!.id,
    p_from: "walkthrough_scheduled",
    p_to: stage,
    p_override: true,
    p_reason: "E2E seed: production test",
  });
  if (e2) throw e2;
}

async function publishEntry(jobId: string, startsOn: string, endsOn: string) {
  const db = adminClient();
  const { error } = await db.from("schedule_entries").insert({
    org_id: orgId,
    job_id: jobId,
    crew_id: crewId,
    starts_on: startsOn,
    ends_on: endsOn,
    status: "published",
    published_at: new Date().toISOString(),
    work_type: "interior_production",
  });
  if (error) throw error;
  const { error: e2 } = await db.from("jobs").update({ crew_id: crewId }).eq("id", jobId);
  if (e2) throw e2;
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

  const { data: acct, error: e1 } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `Prod${t} Residence` })
    .select("id")
    .single();
  if (e1) throw e1;
  accountId = acct!.id;
  const mobile = `+1425557${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const { data: contact, error: e2 } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: "June",
      last_name: `Prod${t}`,
      mobile,
      email: `june-${t}@example.com`,
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
      street: `${Math.floor(Math.random() * 900) + 100} Crew Way`,
      city: "Redmond",
      state: "WA",
      zip: "98052",
      year_built: 2001,
      access_notes: "Lockbox on the side gate (sample)",
    })
    .select("id")
    .single();
  if (e3) throw e3;

  // A crew led by the painter test user, with the interior skill.
  const { data: crew, error: e4 } = await db
    .from("crews")
    .insert({ org_id: orgId, name: crewName, lead_user_id: painterId, max_jobs_per_day: 1 })
    .select("id")
    .single();
  if (e4) throw e4;
  crewId = crew!.id;
  const { data: skill } = await db
    .from("skills")
    .select("id")
    .eq("org_id", orgId)
    .eq("key", "interior")
    .single();
  await db.from("crew_skills").insert({ org_id: orgId, crew_id: crewId, skill_id: skill!.id });
  await db.from("crew_members").insert([
    { org_id: orgId, crew_id: crewId, user_id: painterId, role: "lead" },
    { org_id: orgId, crew_id: crewId, display_name: "Sam Helper", role: "helper" },
  ]);

  await makeJob("a", "Sched", prop!.id, contact!.id, "ready_to_schedule");
  await makeJob("blocker", "Booked", prop!.id, contact!.id, "scheduled");
  await publishEntry(jobs.blocker, MON, addDays(MON, 1));
  await makeJob("live", "Live", prop!.id, contact!.id, "in_progress");
  await publishEntry(jobs.live, addDays(today, -2), addDays(today, 4));
  await db.from("color_selections").insert({
    org_id: orgId,
    job_id: jobs.live,
    area: "Living room",
    surface: "Walls",
    status: "selected",
    color_name: "Sample Oat",
  });
  await makeJob("punch", "Punch", prop!.id, contact!.id, "final_walkthrough");
});

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  const db = adminClient();
  const ids = Object.values(jobs).filter(Boolean);
  await db.from("paint_orders").delete().in("job_id", ids);
  await deleteJobs(ids);
  await db.from("integration_outbox").delete().eq("related_type", "crew").eq("related_id", crewId);
  await db.from("notifications").delete().eq("user_id", painterId).eq("type", "schedule");
  await db.from("crews").delete().eq("id", crewId);
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

test("a conflicting schedule is blocked with a clear reason; Publish sends simulated notices", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Publish is org-wide; run it once.");
  const db = adminClient();
  await page.goto(`/schedule/master?date=${MON}`);
  await expect(page.getByRole("heading", { level: 1, name: "Master Schedule" })).toBeVisible();
  const card = page.getByTestId(`tray-${jobs.a}`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Schedule job" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Schedule job" })).toBeVisible();
  await dialog.getByLabel("Crew", { exact: true }).selectOption(crewId);
  await dialog.getByLabel("First day").fill(MON);
  await dialog.getByLabel("Last day").fill(addDays(MON, 1));
  await dialog.getByRole("button", { name: "Save draft" }).click();
  // Blocked, with the reason: the crew is already booked on the other job.
  await expect(dialog.getByRole("status")).toContainText(
    `${crewName} is already booked on ${labels.blocker}`,
  );
  await page.screenshot({ path: `${SCREENS}/master-schedule-conflict.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByText("These drafts can't be published yet:")).toBeVisible();
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText(/already booked|can't be published/i).first()).toBeVisible();
  const { data: draft } = await db
    .from("schedule_entries")
    .select("id, status, draft_action")
    .eq("job_id", jobs.a)
    .single();
  expect(draft!.status).toBe("draft");
  const { count: nothingSent } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("subject_type", "job")
    .eq("subject_id", jobs.a);
  expect(nothingSent).toBe(0);

  // Move it to Wed–Thu: no conflicts, then publish.
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByTestId(`bar-${draft!.id}`)
    .getByRole("button", { name: new RegExp(`^(Conflict ?)?${esc(labels.a)}`) })
    .click();
  await expect(dialog.getByRole("heading", { name: "Edit schedule entry" })).toBeVisible();
  await dialog.getByLabel("First day").fill(addDays(MON, 2));
  await dialog.getByLabel("Last day").fill(addDays(MON, 3));
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("These drafts can't be published yet:")).toBeHidden();
  await page.screenshot({ path: `${SCREENS}/master-schedule-draft.png`, fullPage: true });
  await axe(page);
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByText(/Published \d+ change/)).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("schedule_entries")
        .select("status, starts_on, ends_on")
        .eq("job_id", jobs.a)
        .single();
      return data;
    })
    .toMatchObject({ status: "published", starts_on: addDays(MON, 2), ends_on: addDays(MON, 3) });
  const { data: job } = await db
    .from("jobs")
    .select("stage, promised_start_date, guarantee_start_date, crew_id")
    .eq("id", jobs.a)
    .single();
  expect(job).toMatchObject({
    stage: "scheduled",
    promised_start_date: addDays(MON, 2),
    guarantee_start_date: addDays(MON, 2),
    crew_id: crewId,
  });
  // Customer notice (text) and crew notice (crew lead), both simulated in the outbox.
  const { data: msgs } = await db
    .from("messages")
    .select("outbox_id")
    .eq("subject_type", "job")
    .eq("subject_id", jobs.a);
  const outboxIds = (msgs ?? []).map((m) => m.outbox_id).filter((x): x is string => !!x);
  expect(outboxIds.length).toBeGreaterThanOrEqual(1);
  const { data: customer } = await db
    .from("integration_outbox")
    .select("status, domain")
    .in("id", outboxIds);
  expect(customer!.every((r) => r.status === "simulated")).toBe(true);
  const { data: crewRows } = await db
    .from("integration_outbox")
    .select("status, recipient")
    .eq("related_type", "crew")
    .eq("related_id", crewId);
  expect(crewRows!.length).toBeGreaterThanOrEqual(1);
  expect(crewRows!.every((r) => r.status === "simulated")).toBe(true);
  expect(crewRows!.some((r) => r.recipient === TEST_USERS.painter.email)).toBe(true);
});

test("the job's Schedule and Work Orders sections", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Office screen.");
  await page.goto(`/jobs/${jobs.live}?section=schedule`);
  await expect(page.getByRole("region", { name: "Dispatch readiness" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Crew" })).toContainText(crewName);
  await expect(page.getByRole("region", { name: "Schedule entries" })).toContainText("Published");
  await expect(page.getByRole("region", { name: "On-time start guarantee" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/job-schedule.png`, fullPage: true });
  await axe(page);
  await page.goto(`/jobs/${jobs.live}?section=work-orders`);
  await expect(page.getByRole("region", { name: "Paint orders" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/job-work-orders.png`, fullPage: true });
  await axe(page);
});

test("Production Center pages and Schedule Admin load", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Office screens.");
  const pages: [string, string, string][] = [
    ["/schedule", "Command Center", "command-center"],
    ["/schedule/readiness", "Readiness Queue", "readiness-queue"],
    ["/schedule/crew-queue", "Crew Queue", "crew-queue"],
    ["/schedule/dispatch", "Field Dispatch", "field-dispatch"],
    ["/schedule/paint-orders", "Paint Orders", "paint-orders"],
    ["/schedule/exceptions", "Exceptions", "exceptions"],
    ["/schedule/recommendations", "Recommendations", "recommendations"],
    ["/schedule/resources", "Resources", "resources"],
    ["/schedule/work-orders", "Work Orders", "work-orders"],
    ["/schedule/weather", "Weather", "weather"],
    ["/admin/schedule", "Schedule Admin", "admin-schedule"],
    ["/admin/subcontractors", "Subcontractors", "admin-subcontractors"],
  ];
  for (const [href, title, file] of pages) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/${file}.png`, fullPage: true });
    await axe(page);
  }
  await page.goto("/schedule/weather");
  await expect(page.getByText(/Weather not connected/i).first()).toBeVisible();
});

test("on a phone: Today and My Projects for the crew", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "e2e-mobile", "Crew screens.");
  await page.goto("/field/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  if (isWeekday) {
    const card = page.getByRole("article", { name: labels.live });
    await expect(card).toContainText("Lockbox on the side gate");
    await expect(card).toContainText("Sample Oat");
  }
  await page.screenshot({ path: `${SCREENS}/field-today-mobile.png`, fullPage: true });
  await axe(page);

  await page.goto(`/schedule/my-projects?job=${jobs.live}`);
  await expect(page.getByRole("heading", { level: 1, name: "My Projects" })).toBeVisible();
  await expect(page.getByRole("article", { name: labels.live })).toBeVisible();
  await expect(page.getByRole("list", { name: "Project list" })).toContainText("stages complete");
  await page.screenshot({ path: `${SCREENS}/my-projects-mobile.png`, fullPage: true });
  await axe(page);

  // The painter (crew lead) sees the crew's job — and only jobs they're on.
  const ctx = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: { width: 412, height: 915 },
    storageState: "tests/e2e/.auth/painter.json",
  });
  const p2 = await ctx.newPage();
  await p2.goto("/schedule/my-projects");
  await expect(p2.getByRole("list", { name: "Project list" })).toContainText(`Live${t}`);
  await ctx.close();
});

test("on a phone: the daily log needs the cleanup check and photo, and works offline", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "e2e-mobile", "Crew screen.");
  const db = adminClient();
  await page.goto(`/field/daily-log?job=${jobs.live}`);
  await expect(page.getByRole("heading", { level: 1, name: "Daily Log" })).toBeVisible();
  await expect(page.getByTestId("sync-indicator").first()).toContainText(/Offline ready|synced/);
  await expect(page.getByRole("combobox", { name: "Job" })).toHaveValue(jobs.live);
  await page.getByLabel("Finished today").fill("Primed the living room walls and cut in trim.");
  await page.getByRole("button", { name: "Post daily log" }).click();
  await expect(page.getByText("a clean house every evening")).toBeVisible();
  await expect(page.getByText("Take the cleanup photo.")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/daily-log-required-mobile.png`, fullPage: true });

  await page.getByLabel("Next up").fill("Two coats on the walls.");
  await page.getByRole("checkbox", { name: "Cleanup done" }).check();
  await page
    .locator("#dl-cleanup-photo")
    .setInputFiles([
      { name: "cleanup.jpg", mimeType: "image/jpeg", buffer: await photo("#e0e0d0") },
    ]);
  await page.getByRole("button", { name: "Post daily log" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Daily log sent" })).toBeVisible();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("daily_logs")
          .select("customer_update_status, cleanup_done, cleanup_photo_id")
          .eq("job_id", jobs.live);
        return data?.[0] ?? null;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ customer_update_status: "simulated", cleanup_done: true });
  const { data: msgs } = await db
    .from("messages")
    .select("outbox_id")
    .eq("subject_type", "job")
    .eq("subject_id", jobs.live);
  const outboxIds = (msgs ?? []).map((m) => m.outbox_id).filter((x): x is string => !!x);
  const { data: rows } = await db
    .from("integration_outbox")
    .select("status")
    .in("id", outboxIds.length ? outboxIds : ["00000000-0000-0000-0000-000000000000"]);
  expect(rows!.length).toBeGreaterThanOrEqual(1);
  expect(rows!.every((r) => r.status === "simulated")).toBe(true);

  // Offline: it waits on the phone, then uploads on reconnect.
  await context.setOffline(true);
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await page.getByLabel("Finished today").fill("Second coat in the hallway.");
  await page.getByRole("checkbox", { name: "Cleanup done" }).check();
  await page
    .locator("#dl-cleanup-photo")
    .setInputFiles([
      { name: "cleanup2.jpg", mimeType: "image/jpeg", buffer: await photo("#d0d0c0") },
    ]);
  await page.getByRole("button", { name: "Post daily log" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this phone" })).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/daily-log-offline-mobile.png`, fullPage: true });
  const { count: whileOffline } = await db
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobs.live);
  expect(whileOffline).toBe(1);
  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        (
          await db
            .from("daily_logs")
            .select("id", { count: "exact", head: true })
            .eq("job_id", jobs.live)
            .eq("source", "offline")
        ).count,
      { timeout: 45_000 },
    )
    .toBe(1);

  await page.goto(`/jobs/${jobs.live}?section=daily-logs`);
  const timeline = page.getByRole("list", { name: "Daily log timeline" });
  await expect(timeline.getByRole("listitem").first()).toContainText("Cleanup done");
  await expect(timeline).toContainText("Customer update sent (simulated)");
  await page.screenshot({ path: `${SCREENS}/job-daily-logs-mobile.png`, fullPage: true });
  await axe(page);
});

test("punch list: add, fix, and the customer's sign-off moves the job to Completed", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Mutations run once.");
  const db = adminClient();
  await page.goto(`/jobs/${jobs.punch}?section=punch-list`);
  await expect(page.getByRole("region", { name: "Final walkthrough" })).toBeVisible();
  const form = page.getByRole("form", { name: "Add punch item" });
  await form.getByLabel("Area").fill("Kitchen");
  await form.getByLabel("What needs fixing").fill("Touch up the scuff by the pantry door");
  await form.getByRole("button", { name: "Add item" }).click();
  const kitchen = page.getByRole("region", { name: "Kitchen" });
  await expect(kitchen).toContainText("Touch up the scuff");
  await expect(kitchen).toContainText("(1 open)");
  await kitchen.getByRole("button", { name: "Fixed" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark fixed" }).click();
  await expect(kitchen).toContainText("(0 open)");
  await page.screenshot({ path: `${SCREENS}/job-punch-list.png`, fullPage: true });
  await axe(page);

  await page.getByRole("button", { name: "Capture customer sign-off" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Draft wording – owner to approve");
  await dialog.getByLabel("Customer name").fill(`June Prod${t}`);
  const pad = dialog.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? -18 : 18));
  }
  await page.mouse.up();
  await page.screenshot({ path: `${SCREENS}/punch-signoff.png` });
  await dialog.getByRole("button", { name: "Save sign-off" }).click();
  await expect(page.getByText("Sign-off saved.")).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await db.from("jobs").select("stage").eq("id", jobs.punch).single();
      return data?.stage;
    })
    .toBe("completed");
  const { data: signoff } = await db
    .from("punch_signoffs")
    .select("signer_name, open_items, signature_sha256")
    .eq("job_id", jobs.punch)
    .single();
  expect(signoff).toMatchObject({ signer_name: `June Prod${t}`, open_items: 0 });
  expect(signoff!.signature_sha256).toMatch(/^[0-9a-f]{64}$/);
});
