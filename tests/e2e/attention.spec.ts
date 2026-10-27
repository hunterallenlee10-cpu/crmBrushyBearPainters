import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { formatInTimeZone } from "date-fns-tz";
import { deleteAccounts, deleteLeadsAndJobs } from "./support/cleanup";
import {
  adminClient,
  createThrowawayUser,
  loginAs,
  signInWithMagicLink,
  TEST_USERS,
  type TestRole,
} from "./support/users";

/**
 * Attention Center (SPEC §8.9, §9): items OPEN when a lead or job stalls and
 * AUTO-RESOLVE when the condition clears, plus the manual flows (start, assign,
 * snooze → wake, resolve with a note and stay resolved).
 *
 * Time-of-day independent: the rules used here don't depend on business hours
 * (aging lead counts Pacific calendar days since the last activity; start date
 * missed compares Pacific dates). The local database is shared with other test
 * runs that also run the worker, so every assertion is about records seeded
 * here (tagged `t`), never global counts.
 */

// Every page signs in fresh (loginAs) so sessions never leak between roles.
test.use({ storageState: { cookies: [], origins: [] } });

const TZ = "America/Los_Angeles";
const SCREENS = "docs/screens/phase-3";
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const DAY = 24 * 3_600_000;
const t = randomUUID().slice(0, 6);
const seededLeads: string[] = [];
const throwawayUsers: string[] = [];

async function orgId(): Promise<string> {
  const { data } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  return data!.id;
}

async function userId(role: TestRole): Promise<string> {
  const { data } = await adminClient()
    .from("profiles")
    .select("id")
    .eq("email", TEST_USERS[role].email)
    .single();
  return data!.id;
}

/** A contacted lead (no untouched-lead item) whose last activity was `idleDays` ago. */
async function seedLead(first: string, last: string, idleDays: number): Promise<string> {
  const admin = adminClient();
  const owner = await userId("estimator");
  const now = Date.now();
  const { data, error } = await admin
    .from("leads")
    .insert({
      org_id: await orgId(),
      first_name: first,
      last_name: last,
      mobile: `+142555502${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
      email: `${last.toLowerCase()}@example.com`,
      street: "500 Sample Ave",
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      services: ["interior"],
      lead_source: "website",
      status: "contacted",
      owner_id: owner,
      first_contacted_at: new Date(now - (idleDays + 1) * DAY).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  seededLeads.push(data.id);
  // Set after insert so no default or trigger overrides it.
  const { error: uError } = await admin
    .from("leads")
    .update({ last_activity_at: new Date(now - idleDays * DAY).toISOString() })
    .eq("id", data.id);
  if (uError) throw uError;
  return data.id;
}

/** Converts a lead with the owner recorded as the actor (as the app does). */
async function convert(leadId: string): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": await userId("owner") } },
    },
  );
  const { data, error } = await db.rpc("convert_lead_to_job", { p_lead: leadId });
  if (error) throw error;
  return data as string;
}

type Item = {
  id: string;
  status: string;
  priority: string;
  title: string;
  owner_id: string | null;
  resolution: string | null;
  resolution_note: string | null;
  snoozed_until: string | null;
  dedupe_key: string;
};

/** Latest item of a rule for one lead/job. */
async function itemFor(subjectId: string, rule: string): Promise<Item | null> {
  const { data } = await adminClient()
    .from("attention_items")
    .select(
      "id, status, priority, title, owner_id, resolution, resolution_note, snoozed_until, dedupe_key",
    )
    .eq("subject_id", subjectId)
    .eq("rule_key", rule)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Item | null) ?? null;
}

async function openItemsFor(subjectId: string): Promise<Item[]> {
  const { data } = await adminClient()
    .from("attention_items")
    .select(
      "id, status, priority, title, owner_id, resolution, resolution_note, snoozed_until, dedupe_key",
    )
    .eq("subject_id", subjectId)
    .neq("status", "resolved");
  return (data as Item[] | null) ?? [];
}

/** Runs the background worker (attention sweep) the way Vercel Cron does. */
async function runWorker(): Promise<void> {
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status, "worker should accept the cron secret").toBe(200);
  const body = (await res.json()) as { ok?: boolean; attention?: { error?: boolean } };
  expect(body.ok).toBe(true);
}

/**
 * Runs the worker until the database shows the expected state. Other test runs
 * sweep at the same time; two sweeps racing on the same item can make one of
 * them skip a round, so a second run settles it.
 */
async function sweepUntil<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 4 && !ok(value); i++) {
    await runWorker();
    value = await read();
  }
  expect(ok(value), `state after the worker: ${JSON.stringify(value)}`).toBe(true);
  return value;
}

function pacificDate(offsetDays: number): string {
  return formatInTimeZone(new Date(Date.now() + offsetDays * DAY), TZ, "yyyy-MM-dd");
}

async function open(page: Page, path: string) {
  let res = await page.goto(path);
  for (let i = 0; i < 3 && res?.status() === 500; i++) {
    await page.waitForTimeout(2000);
    res = await page.goto(path);
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  return res;
}

async function newPage(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    timezoneId: use.timezoneId,
    locale: use.locale,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  });
  return context.newPage();
}

/**
 * `loginAs` with retries: other test runs sign in as the same shared users at
 * the same time, which can cancel our magic link or reuse a TOTP window.
 */
async function signIn(page: Page, role: TestRole, next: string) {
  const authScreen = (url: URL) => ["/login", "/mfa", "/auth/confirm"].includes(url.pathname);
  for (let attempt = 1; ; attempt++) {
    try {
      await loginAs(page, role, next);
    } catch (error) {
      if (attempt >= 4) throw error;
    }
    const signedIn = await page
      .waitForURL((url) => !authScreen(url), { timeout: 15_000, waitUntil: "commit" })
      .then(
        () => true,
        () => false,
      );
    if (signedIn) return;
    if (attempt >= 4) throw new Error(`Could not sign in as ${role}: ended on ${page.url()}`);
    const onMfa = new URL(page.url()).pathname === "/mfa";
    await page.waitForTimeout(
      onMfa ? 30_500 - (Date.now() % 30_000) : 1_000 + Math.random() * 3_000,
    );
  }
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

const row = (page: Page, title: string) =>
  page.getByRole("list", { name: "Attention items" }).getByRole("listitem", { name: title });

const listed = (page: Page) =>
  page.getByRole("list", { name: "Attention items" }).getByRole("listitem");

test.afterAll(async () => {
  if (seededLeads.length) {
    const { accountIds } = await deleteLeadsAndJobs(seededLeads);
    await deleteAccounts(accountIds);
  }
  if (throwawayUsers.length) {
    await adminClient().from("profiles").update({ is_active: false }).in("id", throwawayUsers);
  }
});

test.describe("Attention Center: items open and auto-resolve", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop; the phone layout is below");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let agingLead = "";
  let manualLead = "";
  let jobLead = "";
  let jobId = "";
  let titles = { aging: "", manual: "", job: "" };
  let owner: Page;
  const search = `/attention?q=${t}`;

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(240_000);
    mkdirSync(SCREENS, { recursive: true });
    agingLead = await seedLead("Ada", `Aging${t}`, 8);
    manualLead = await seedLead("Cy", `Manual${t}`, 8);
    // A lead converted to a job whose promised start was yesterday (Pacific).
    jobLead = await seedLead("Jo", `Jobby${t}`, 0);
    jobId = await convert(jobLead);
    const { error } = await adminClient()
      .from("jobs")
      .update({ promised_start_date: pacificDate(-1) })
      .eq("id", jobId);
    if (error) throw error;

    owner = await newPage(browser, info);
    await signIn(owner, "owner", search);
  });

  test.afterAll(async () => {
    await owner?.context().close();
  });

  test("the worker opens items for a stalled lead and a missed start date", async () => {
    const estimator = await userId("estimator");
    const aging = await sweepUntil(
      () => itemFor(agingLead, "aging_lead"),
      (i) => i?.status === "pending",
    );
    expect(aging).toMatchObject({ priority: "high", owner_id: estimator });
    expect(aging!.title).toBe(`8 days without activity: Ada Aging${t}`);
    const manual = await sweepUntil(
      () => itemFor(manualLead, "aging_lead"),
      (i) => i?.status === "pending",
    );
    const job = await sweepUntil(
      () => itemFor(jobId, "start_date_missed"),
      (i) => i?.status === "pending",
    );
    expect(job).toMatchObject({ priority: "critical", owner_id: estimator });
    expect(job!.title).toMatch(new RegExp(`^Start date missed: Jobby${t}`));
    // The converted lead itself raises nothing (it's no longer an open lead).
    expect(await openItemsFor(jobLead)).toEqual([]);
    titles = { aging: aging!.title, manual: manual!.title, job: job!.title };
  });

  test("owner sees them, critical first; Prioritize re-sorts by urgency", async () => {
    await open(owner, search);
    await expect(
      owner.getByRole("heading", { level: 1, name: "Jobs don't stall past attention." }),
    ).toBeVisible();
    for (const label of [
      "Needs Attention Now",
      "Overdue / At-Risk",
      "Awaiting Response",
      "In Progress",
    ]) {
      await expect(owner.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(listed(owner)).toHaveCount(3);
    await expect(listed(owner).first()).toHaveAccessibleName(titles.job);

    const job = row(owner, titles.job);
    await expect(job.getByText("Critical priority", { exact: true })).toBeVisible();
    await expect(job.getByRole("link", { name: /^Open Job: Jobby/ })).toHaveAttribute(
      "href",
      `/jobs/${jobId}`,
    );
    const aging = row(owner, titles.aging);
    await expect(aging.getByText("High priority", { exact: true })).toBeVisible();
    await expect(aging.getByText(/^opened /)).toBeVisible();
    await expect(aging.getByText("Eli Estimator")).toBeVisible();
    await expect(aging.getByRole("link", { name: `Open Lead: Ada Aging${t}` })).toHaveAttribute(
      "href",
      `/leads/${agingLead}`,
    );
    await expect(owner.getByText("Sorted by priority, then due time.")).toBeVisible();

    await owner.getByRole("link", { name: "Prioritize" }).click();
    await expect(owner).toHaveURL(/sort=urgency/);
    await expect(
      owner.getByText("Sorted by urgency: priority, then how overdue, then age."),
    ).toBeVisible();
    await expect(listed(owner).first()).toHaveAccessibleName(titles.job);
    await expect(listed(owner)).toHaveCount(3);

    await open(owner, search);
    await owner.screenshot({ path: `${SCREENS}/attention.png`, fullPage: true });
    expect(await seriousAxe(owner)).toEqual([]);
  });

  test("390px wide: cards stack with 44px buttons and no sideways scroll", async () => {
    await owner.setViewportSize({ width: 390, height: 844 });
    try {
      await open(owner, search);
      await expect(row(owner, titles.aging)).toBeVisible();
      await noSideScroll(owner);
      const resolve = row(owner, titles.aging).getByRole("button", { name: "Resolve" });
      const box = await resolve.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    } finally {
      await owner.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test("the estimator sees items on their records; others don't", async ({ browser }, info) => {
    const est = await newPage(browser, info);
    try {
      await signIn(est, "estimator", search);
      await open(est, search);
      await expect(row(est, titles.aging)).toBeVisible();
      await expect(row(est, titles.job)).toBeVisible();
      await expect(listed(est)).toHaveCount(3);
    } finally {
      await est.context().close();
    }

    // Another estimator ("own" scope): not their leads or jobs, not assigned to them.
    const other = await createThrowawayUser("estimator", "attn");
    throwawayUsers.push(other.id);
    const otherPage = await newPage(browser, info);
    try {
      await signInWithMagicLink(otherPage, other.email, search);
      await otherPage.waitForLoadState("networkidle");
      await open(otherPage, search);
      await expect(
        otherPage.getByRole("heading", { level: 1, name: "Jobs don't stall past attention." }),
      ).toBeVisible();
      await expect(otherPage.getByText("Nothing matches these filters")).toBeVisible();
      await expect(listed(otherPage)).toHaveCount(0);
    } finally {
      await otherPage.context().close();
    }

    // The painter has no Attention permission: the page doesn't exist for them.
    const painter = await newPage(browser, info);
    try {
      await signIn(painter, "painter", "/");
      const res = await open(painter, "/attention");
      expect(res?.status()).toBe(404);
    } finally {
      await painter.context().close();
    }
  });

  test("start and assign; Only mine for the office manager", async ({ browser }, info) => {
    await open(owner, search);
    const item = row(owner, titles.manual);
    await item.getByRole("button", { name: "Start" }).click();
    await expect(owner.getByText("Marked in progress.", { exact: true }).first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(item.getByText("In progress", { exact: true })).toBeVisible();
    expect((await itemFor(manualLead, "aging_lead"))?.status).toBe("in_progress");

    await item.getByRole("button", { name: "Assign" }).click();
    await owner.getByRole("menuitemradio", { name: TEST_USERS.office_manager.fullName }).click();
    await expect(
      owner.getByText(`Assigned to ${TEST_USERS.office_manager.fullName}.`).first(),
    ).toBeVisible({ timeout: 45_000 });
    expect((await itemFor(manualLead, "aging_lead"))?.owner_id).toBe(
      await userId("office_manager"),
    );

    const office = await newPage(browser, info);
    try {
      await signIn(office, "office_manager", search);
      await open(office, search);
      await expect(listed(office)).toHaveCount(3);
      await office.getByRole("switch", { name: "Only mine" }).click();
      await expect(office).toHaveURL(/mine=1/);
      await expect(listed(office)).toHaveCount(1);
      await expect(row(office, titles.manual)).toBeVisible();
      await expect(row(office, titles.manual).getByText("Otto Office")).toBeVisible();
    } finally {
      await office.context().close();
    }
  });

  test("a lead item auto-resolves once the lead has activity", async () => {
    // A note on the lead counts as activity (database trigger bumps last_activity_at).
    const { error } = await adminClient()
      .from("notes")
      .insert({
        org_id: await orgId(),
        subject_type: "lead",
        subject_id: agingLead,
        body: "Left a voicemail about colors.",
      });
    if (error) throw error;
    const { data: lead } = await adminClient()
      .from("leads")
      .select("last_activity_at")
      .eq("id", agingLead)
      .single();
    expect(Date.now() - new Date(lead!.last_activity_at).getTime()).toBeLessThan(DAY);

    const item = await sweepUntil(
      () => itemFor(agingLead, "aging_lead"),
      (i) => i?.status === "resolved",
    );
    expect(item?.resolution).toBe("auto");
    expect(await openItemsFor(agingLead)).toEqual([]);

    await open(owner, search);
    await expect(row(owner, titles.job)).toBeVisible();
    await expect(row(owner, titles.aging)).toHaveCount(0);

    await open(owner, `/attention?status=resolved&q=${t}`);
    const resolved = row(owner, titles.aging);
    await expect(resolved).toBeVisible();
    await expect(resolved.getByText("Cleared automatically", { exact: true })).toBeVisible();
    await expect(resolved.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  });

  test("a job item auto-resolves when the start date moves forward", async () => {
    const { error } = await adminClient()
      .from("jobs")
      .update({ promised_start_date: pacificDate(14) })
      .eq("id", jobId);
    if (error) throw error;
    const item = await sweepUntil(
      () => itemFor(jobId, "start_date_missed"),
      (i) => i?.status === "resolved",
    );
    expect(item?.resolution).toBe("auto");
    expect(await openItemsFor(jobId)).toEqual([]);

    await open(owner, search);
    await expect(row(owner, titles.job)).toHaveCount(0);
    await open(owner, `/attention?status=resolved&q=${t}`);
    await expect(row(owner, titles.job)).toBeVisible();
  });

  test("snooze hides it from Pending; it comes back when the time passes", async () => {
    await open(owner, search);
    const item = row(owner, titles.manual);
    await item.getByRole("button", { name: "Snooze" }).click();
    await owner.getByRole("menuitem", { name: /^1 hour/ }).click();
    await expect(owner.getByText("Snoozed.", { exact: true }).first()).toBeVisible({
      timeout: 45_000,
    });
    const snoozed = await itemFor(manualLead, "aging_lead");
    expect(snoozed?.status).toBe("snoozed");
    const until = new Date(snoozed!.snoozed_until!).getTime() - Date.now();
    expect(until).toBeGreaterThan(50 * 60_000);
    expect(until).toBeLessThan(61 * 60_000);

    await open(owner, search);
    await expect(row(owner, titles.manual)).toHaveCount(0);
    await open(owner, `/attention?status=pending&q=${t}`);
    await expect(row(owner, titles.manual)).toHaveCount(0);
    await open(owner, `/attention?status=snoozed&q=${t}`);
    await expect(row(owner, titles.manual).getByText(/^Snoozed until /)).toBeVisible();

    // Time passes: the snooze ends, and the worker puts it back in Pending.
    const { error } = await adminClient()
      .from("attention_items")
      .update({ snoozed_until: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", snoozed!.id);
    if (error) throw error;
    const woke = await sweepUntil(
      () => itemFor(manualLead, "aging_lead"),
      (i) => i?.status === "pending",
    );
    expect(woke?.id).toBe(snoozed!.id);
    expect(woke?.snoozed_until).toBeNull();

    await open(owner, `/attention?status=pending&q=${t}`);
    await expect(row(owner, titles.manual)).toBeVisible();
  });

  test("resolve needs a note, and a resolved item stays resolved", async () => {
    await open(owner, search);
    const item = row(owner, titles.manual);
    await item.getByRole("button", { name: "Resolve" }).click();
    const dialog = owner.getByRole("dialog", { name: "Resolve item" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Resolve item" }).click();
    await expect(dialog.getByText("Add a short note saying how it was resolved.")).toBeVisible();
    expect((await itemFor(manualLead, "aging_lead"))?.status).toBe("pending");
    await owner.screenshot({ path: `${SCREENS}/attention-resolve.png` });
    expect(await seriousAxe(owner)).toEqual([]);

    const note = "Called Cy and booked a walkthrough for Friday.";
    await dialog.getByLabel("How was it resolved?").fill(note);
    await dialog.getByRole("button", { name: "Resolve item" }).click();
    await expect(owner.getByText("Resolved.", { exact: true }).first()).toBeVisible({
      timeout: 45_000,
    });
    const resolved = await itemFor(manualLead, "aging_lead");
    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: "manual",
      resolution_note: note,
    });

    // The lead is still idle, but a person resolved it: the worker leaves it closed.
    await runWorker();
    await runWorker();
    const after = await itemFor(manualLead, "aging_lead");
    expect(after).toMatchObject({ id: resolved!.id, status: "resolved", resolution: "manual" });
    expect(await openItemsFor(manualLead)).toEqual([]);

    await open(owner, search);
    await expect(row(owner, titles.manual)).toHaveCount(0);
    await expect(owner.getByText("Nothing matches these filters")).toBeVisible();
    await open(owner, `/attention?status=resolved&q=${t}`);
    const done = row(owner, titles.manual);
    await expect(
      done.getByText(new RegExp(`Resolved by ${TEST_USERS.owner.fullName}`)),
    ).toBeVisible();
    await expect(done.getByText(note)).toBeVisible();
  });
});

test.describe("Attention Center on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "Phone layout check");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("cards stack, buttons are 44px, no sideways scroll", async ({ browser }, info) => {
    mkdirSync(SCREENS, { recursive: true });
    const lead = await seedLead("Mo", `Mobile${t}`, 15);
    const item = await sweepUntil(
      () => itemFor(lead, "aging_lead"),
      (i) => i?.status === "pending",
    );
    expect(item?.title).toBe(`14+ days without activity: Mo Mobile${t}`);

    const page = await newPage(browser, info);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, "owner", `/attention?q=${t}`);
      await open(page, `/attention?q=${t}`);
      const card = row(page, item!.title);
      await expect(card).toBeVisible();
      await noSideScroll(page);
      for (const name of ["Assign", "Start", "Snooze", "Resolve"]) {
        const box = await card.getByRole("button", { name }).boundingBox();
        expect(box?.height ?? 0, `${name} button height`).toBeGreaterThanOrEqual(44);
      }
      const open_ = await card.getByRole("link", { name: /^Open Lead/ }).boundingBox();
      expect(open_?.height ?? 0).toBeGreaterThanOrEqual(44);
      // Stacked: the actions sit below the title, not beside it.
      const title = await card.getByRole("heading", { name: item!.title }).boundingBox();
      const resolveBox = await card.getByRole("button", { name: "Resolve" }).boundingBox();
      expect(resolveBox!.y).toBeGreaterThan(title!.y + title!.height);
      await page.screenshot({ path: `${SCREENS}/attention-mobile.png`, fullPage: true });
      expect(await seriousAxe(page)).toEqual([]);
    } finally {
      await page.context().close();
    }
  });
});
