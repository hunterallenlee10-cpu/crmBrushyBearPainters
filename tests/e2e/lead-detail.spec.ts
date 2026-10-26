import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { adminClient, loginAs, TEST_USERS } from "./support/users";

/**
 * Lead Detail (SPEC §8.4): header, tabs, composer (simulated sends), notes,
 * comments with mentions, tasks, status, Book Walkthrough, edit and delete.
 * Signed in as the Owner unless a test uses loginAs. Fake data only.
 */

const TZ = "America/Los_Angeles";
const SCREENS = "docs/screens/phase-2";
const t = randomUUID().slice(0, 6);
const seeded: string[] = [];

async function orgId(): Promise<string> {
  const { data } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  return data!.id;
}

async function userId(email: string): Promise<string> {
  const { data } = await adminClient().from("profiles").select("id").eq("email", email).single();
  return data!.id;
}

async function seedLead(fields: Record<string, unknown> = {}): Promise<string> {
  const owner = await userId(TEST_USERS.owner.email);
  const { data, error } = await adminClient()
    .from("leads")
    .insert({
      org_id: await orgId(),
      first_name: "Lena",
      last_name: `Detail${t}`,
      mobile: `+142555501${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
      email: `lena-${t}@example.com`,
      street: "123 Sample St",
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      services: ["exterior", "interior"],
      timeline: "1_3_months",
      home_built: "before_1978",
      lead_source: "website",
      owner_id: owner,
      score: 72,
      grade: "B",
      temperature: "warm",
      score_factors: [
        { factor: "in_service_area", label: "In our service area", points: 10 },
        { factor: "timeline_1_3_months", label: "Timeline: 1–3 months", points: 8 },
        { factor: "has_mobile", label: "Has a mobile number", points: 5 },
      ],
      scored_at: new Date().toISOString(),
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw error;
  seeded.push(data.id);
  return data.id;
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

/**
 * Opens a page and waits for hydration so typed input reaches React state.
 * Retries the shared dev server's transient 500s (it rebuilds while other work runs).
 */
async function open(page: Page, path: string) {
  let res = await page.goto(path);
  for (let i = 0; i < 3 && res?.status() === 500; i++) {
    await page.waitForTimeout(2000);
    res = await page.goto(path);
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  return res;
}

/**
 * Waits for the success toast, then reloads. The shared dev server hot-reloads
 * while other work is going on, which can leave a revalidation pending; a reload
 * also proves the change was saved.
 */
async function afterSave(page: Page, toast: string | RegExp, path: string) {
  await expect(page.getByText(toast).first()).toBeVisible({ timeout: 45_000 });
  await open(page, path);
}

async function statusOf(page: Page, path: string): Promise<number | undefined> {
  return (await open(page, path))?.status();
}

async function lead(id: string) {
  const { data } = await adminClient().from("leads").select("*").eq("id", id).single();
  return data as Record<string, unknown>;
}

test.afterAll(async () => {
  if (!seeded.length) return;
  const db = adminClient();
  const { data: msgs } = await db
    .from("messages")
    .select("outbox_id")
    .eq("subject_type", "lead")
    .in("subject_id", seeded);
  const outboxIds = (msgs ?? []).map((m) => m.outbox_id).filter(Boolean);
  // Messages are append-only for people; the service role may delete them
  // (migration 20261026000900), then the outbox rows they referenced.
  await db.from("messages").delete().eq("subject_type", "lead").in("subject_id", seeded);
  if (outboxIds.length) await db.from("integration_outbox").delete().in("id", outboxIds);
  await db.from("integration_outbox").delete().eq("related_type", "lead").in("related_id", seeded);
  for (const table of ["notes", "comments", "tasks"]) {
    await db.from(table).delete().eq("subject_type", "lead").in("subject_id", seeded);
  }
  await db
    .from("notifications")
    .delete()
    .in(
      "link",
      seeded.map((id) => `/leads/${id}`),
    );
  await db.from("activity").delete().eq("subject_type", "lead").in("subject_id", seeded);
  await db.from("leads").delete().in("id", seeded);
});

test.describe("Lead Detail (owner)", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "Flow runs once on desktop; mobile layout is checked below",
  );
  // One lead walks through the whole flow; the shared dev server can be slow.
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let id = "";
  // One signed-in page for the whole flow: a fresh owner session, so other specs
  // that sign the shared owner out (or rotate its refresh token) can't break it.
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    id = await seedLead();
    const use = info.project.use;
    const context = await browser.newContext({
      baseURL: use.baseURL,
      viewport: use.viewport,
      timezoneId: use.timezoneId,
      locale: use.locale,
    });
    page = await context.newPage();
    await loginAs(page, "owner", `/leads/${id}`);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("header shows status, grade badge and the details tab", async () => {
    await open(page, `/leads/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: `Lena Detail${t}` })).toBeVisible();
    const header = page.locator("header").filter({ hasText: `Lena Detail${t}` });
    await expect(header.getByLabel("Grade B, score 72 out of 100")).toBeVisible();
    await expect(header.getByText("72/100 · Warm Lead")).toBeVisible();
    await expect(header.getByText("New", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Convert to Job" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // Details: score factors, maps link, lead-safe note.
    await expect(page.getByText("In our service area")).toBeVisible();
    const maps = page.getByRole("link", { name: /Open in Maps/ });
    await expect(maps).toHaveAttribute("href", /google\.com\/maps\/search\/\?api=1&query=123/);
    await expect(maps).toHaveAttribute("target", "_blank");
    await expect(page.getByText(/plan for lead-safe work practices/)).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/lead-detail.png`, fullPage: false });
    expect(await seriousAxe(page)).toEqual([]);
  });

  test("390px wide: no sideways scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `/leads/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: `Lena Detail${t}` })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${SCREENS}/lead-detail-mobile.png` });
    await page.getByRole("tab", { name: "Activity" }).click();
    await noSideScroll(page);
    expect(await seriousAxe(page)).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("send an SMS: simulated in the outbox, lead becomes Contacted", async () => {
    await open(page, `/leads/${id}`);
    await page
      .getByRole("group", { name: "Lead actions" })
      .getByRole("button", { name: "SMS" })
      .click();
    await expect(page).toHaveURL(/tab=activity/);
    const box = page.getByLabel("Text message");
    await expect(box).toBeFocused();
    const body = `Hi Lena, this is Brushy Bear. When works for a walkthrough? ${t}`;
    await box.fill(body);
    await expect(page.getByText(/ \/ 160 · 1 text/)).toBeVisible();
    await page.getByRole("button", { name: "Send text" }).click();
    await afterSave(page, /Text recorded in the outbox/, `/leads/${id}?tab=activity`);
    const item = page.getByRole("listitem").filter({ hasText: body });
    await expect(item).toBeVisible();
    await expect(item.getByText("Simulated – not sent")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Contacted");

    const db = adminClient();
    const { data: msg } = await db
      .from("messages")
      .select("channel, status, outbox_id, to_address")
      .eq("subject_type", "lead")
      .eq("subject_id", id)
      .eq("channel", "sms")
      .single();
    expect(msg).toMatchObject({ channel: "sms", status: "simulated" });
    expect(msg!.outbox_id).toBeTruthy();
    const { data: outbox } = await db
      .from("integration_outbox")
      .select("status, domain, related_type, related_id, rendered_body")
      .eq("id", msg!.outbox_id)
      .single();
    expect(outbox).toMatchObject({
      status: "simulated",
      domain: "sms_voice",
      related_type: "lead",
      related_id: id,
      rendered_body: body,
    });
    const row = await lead(id);
    expect(row.status).toBe("contacted");
    expect(row.speed_to_lead_seconds).not.toBeNull();
    expect(row.first_contacted_at).not.toBeNull();
  });

  test("log a call with an outcome; it becomes the disposition", async () => {
    await open(page, `/leads/${id}?tab=activity`);
    await page.getByRole("button", { name: "Log call", exact: true }).first().click();
    await page.getByLabel("Outcome").selectOption({ label: "Left voicemail" });
    await page.getByLabel("Duration (minutes)").fill("3");
    await page.getByLabel("Call notes").fill(`Left a message about colors ${t}`);
    await page.getByRole("button", { name: "Log call" }).last().click();
    await afterSave(page, "Call logged.", `/leads/${id}?tab=activity`);
    const item = page.getByRole("listitem").filter({ hasText: `Left a message about colors ${t}` });
    await expect(item).toBeVisible();
    await expect(item).toContainText("Outcome: Left voicemail · 3 min");
    expect((await lead(id)).disposition).toBe("left_voicemail");
    await page.screenshot({ path: `${SCREENS}/lead-detail-activity.png` });
  });

  test("add a note", async () => {
    await open(page, `/leads/${id}?tab=notes`);
    await page.getByLabel("Note", { exact: true }).fill(`Gate code is with the neighbor ${t}`);
    await page.getByLabel("Priority").selectOption("high");
    await page.getByLabel("Pin to top").check();
    await page.getByRole("button", { name: "Add note" }).click();
    await afterSave(page, "Note added.", `/leads/${id}?tab=notes`);
    const note = page.getByRole("list", { name: "Notes" }).getByRole("listitem").first();
    await expect(note).toContainText(`Gate code is with the neighbor ${t}`);
    await expect(note).toContainText("Pinned");
    await expect(note).toContainText("High");
  });

  test("comment mentioning the office manager notifies them", async () => {
    const officeId = await userId(TEST_USERS.office_manager.email);
    await open(page, `/leads/${id}?tab=comments`);
    await page.getByRole("button", { name: "Mention someone" }).click();
    await page.getByLabel("Find a teammate").fill("Otto");
    await page.getByRole("option", { name: TEST_USERS.office_manager.fullName }).click();
    const box = page.getByLabel("Comment", { exact: true });
    await expect(box).toHaveValue(new RegExp(`@${TEST_USERS.office_manager.fullName}`));
    await box.pressSequentially(`can you call the HOA? ${t}`);
    await page.getByLabel("Category").selectOption("office");
    await page.getByRole("button", { name: "Add comment" }).click();
    await afterSave(page, "Comment added.", `/leads/${id}?tab=comments`);
    const comment = page.getByRole("list", { name: "Comments" }).getByRole("listitem").first();
    await expect(comment).toContainText(`can you call the HOA? ${t}`);
    await expect(comment).toContainText(`Mentioned:@${TEST_USERS.office_manager.fullName}`);
    await expect(comment).toContainText("Office");

    const { data: notes } = await adminClient()
      .from("notifications")
      .select("type, link")
      .eq("user_id", officeId)
      .eq("link", `/leads/${id}`);
    expect(notes).toEqual([{ type: "mention", link: `/leads/${id}` }]);
  });

  test("add and complete a task", async () => {
    await open(page, `/leads/${id}?tab=tasks`);
    await expect(
      page.getByText("No tasks yet. Add a follow-up to stay on top of this lead."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add Task" }).first().click();
    const title = `Send color samples ${t}`;
    await page.getByRole("textbox", { name: "Task", exact: true }).fill(title);
    const tomorrow = formatInTimeZone(new Date(Date.now() + 86_400_000), TZ, "yyyy-MM-dd");
    await page.getByLabel("Due date").fill(tomorrow);
    await page.getByLabel("Time (Pacific)").fill("10:15");
    await page.getByRole("button", { name: "Add task" }).click();
    await afterSave(page, "Task added.", `/leads/${id}?tab=tasks`);
    const list = page.getByRole("list", { name: "Tasks" });
    await expect(list).toContainText(title);
    await page.getByRole("checkbox", { name: `Mark “${title}” done` }).click();
    await afterSave(page, "Task done.", `/leads/${id}?tab=tasks`);
    await expect(page.getByText("All caught up")).toBeVisible();
    await page.getByLabel(/Show completed/).click();
    await expect(page.getByRole("checkbox", { name: `Reopen “${title}”` })).toBeChecked();

    const { data: task } = await adminClient()
      .from("tasks")
      .select("status, due_at, completed_at")
      .eq("subject_id", id)
      .single();
    expect(task!.status).toBe("done");
    expect(task!.completed_at).not.toBeNull();
    expect(new Date(task!.due_at as string).toISOString()).toBe(
      fromZonedTime(`${tomorrow}T10:15:00`, TZ).toISOString(),
    );
  });

  test("changing status to Nurture requires a check-back date", async () => {
    await open(page, `/leads/${id}`);
    await page.getByRole("button", { name: "Change status" }).click();
    const dialog = page.getByRole("dialog", { name: "Change status" });
    await dialog.getByLabel("Status").selectOption("nurture");
    await dialog.getByRole("button", { name: "Save status" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Pick a date to check back in.");
    const later = formatInTimeZone(new Date(Date.now() + 60 * 86_400_000), TZ, "yyyy-MM-dd");
    await dialog.getByLabel("Check back on").fill(later);
    await dialog.getByLabel("Disposition").selectOption({ label: "Just planning" });
    await dialog.getByRole("button", { name: "Save status" }).click();
    await afterSave(page, "Status updated.", `/leads/${id}`);
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Nurture");
    const row = await lead(id);
    expect(row).toMatchObject({
      status: "nurture",
      nurture_until: later,
      disposition: "just_planning",
    });
  });

  test("?book=1 opens Book Walkthrough and stores the right UTC instant", async () => {
    await open(page, `/leads/${id}?book=1`);
    const dialog = page.getByRole("dialog", { name: "Book walkthrough" });
    await expect(dialog).toBeVisible();
    await expect(page).not.toHaveURL(/book=1/);
    await expect(dialog).toContainText("arrive with scheduling (Phase 6)");
    const date = formatInTimeZone(new Date(Date.now() + 14 * 86_400_000), TZ, "yyyy-MM-dd");
    await dialog.getByLabel("Date").fill(date);
    await dialog.getByLabel("Time (Pacific)").fill("09:30");
    await dialog.getByLabel("Notes for the walkthrough").fill(`Side gate is locked ${t}`);
    await page.screenshot({ path: `${SCREENS}/lead-detail-book-walkthrough.png` });
    await dialog.getByRole("button", { name: "Book walkthrough" }).click();
    await afterSave(page, "Walkthrough booked.", `/leads/${id}`);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText(
      "Walkthrough Scheduled",
    );
    const row = await lead(id);
    expect(row.status).toBe("walkthrough_scheduled");
    expect(row.disposition).toBe("walkthrough_scheduled");
    expect(new Date(row.walkthrough_at as string).toISOString()).toBe(
      fromZonedTime(`${date}T09:30:00`, TZ).toISOString(),
    );
    const { data: notes } = await adminClient()
      .from("notes")
      .select("body")
      .eq("subject_id", id)
      .ilike("body", "%Side gate%");
    expect(notes).toHaveLength(1);
  });

  test("edit the email", async () => {
    await open(page, `/leads/${id}`);
    await page.getByRole("button", { name: "Edit lead" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit lead" });
    const email = `lena.new-${t}@example.com`;
    await dialog.getByLabel("Email").fill(email.toUpperCase());
    await dialog.getByRole("button", { name: "Save lead" }).click();
    await afterSave(page, "Lead saved.", `/leads/${id}`);
    await expect(page.getByText(email)).toBeVisible();
    expect((await lead(id)).email).toBe(email);
  });

  test("delete with a reason soft-deletes and returns to the list", async () => {
    await open(page, `/leads/${id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Delete lead/ }).click();
    const dialog = page.getByRole("dialog", { name: /Delete Lena/ });
    await dialog.getByRole("button", { name: "Delete lead" }).click();
    await expect(dialog.getByRole("alert")).toContainText("at least 3 characters");
    await dialog.getByLabel("Reason").fill("E2E test lead");
    await dialog.getByRole("button", { name: "Delete lead" }).click();
    await expect(page).toHaveURL(/\/leads\/list/);
    const row = await lead(id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.delete_reason).toBe("E2E test lead");
    expect(await statusOf(page, `/leads/${id}`)).toBe(404);
  });
});

test.describe("Lead Detail access", () => {
  test.skip(({ isMobile }) => isMobile, "Access checks run once on desktop");
  let id = "";
  test.beforeAll(async () => {
    id = await seedLead({ last_name: `Access${t}` });
  });

  test("painter gets a 404", async ({ page }) => {
    await loginAs(page, "painter");
    expect(await statusOf(page, `/leads/${id}`)).toBe(404);
  });

  test("estimator gets a 404 on a lead they don't own", async ({ page }) => {
    await loginAs(page, "estimator");
    expect(await statusOf(page, `/leads/${id}`)).toBe(404);
  });
});
