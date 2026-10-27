import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * Approvals (SPEC §8.5): an estimator's stage-override requests reach the owner,
 * who approves (the job moves with an override tied to the request) or rejects
 * (with a note); requesters cancel their own; a hold-blocked approval stays
 * pending; estimators only see their own requests. Fake data only.
 */

const SCREENS = "docs/screens/phase-3";
const t = randomUUID().slice(0, 6);
const jobIds: string[] = [];
const accountIds: string[] = [];
const ids = { org: "", owner: "", estimator: "", office: "" };
const req = { approve: "", reject: "", cancel: "", blocked: "", other: "", stale: "" };
const job = { approve: "", reject: "", cancel: "", blocked: "", other: "", stale: "" };
const name = (k: keyof typeof job) => `Appr${t} ${k} – Test`;

async function userId(email: string): Promise<string> {
  const { data } = await adminClient().from("profiles").select("id").eq("email", email).single();
  return data!.id;
}

/** Service-role client that records the owner as the actor (for stage changes). */
function asOwner() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": ids.owner } },
    },
  );
}

async function seedJob(key: keyof typeof job, accountId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("jobs")
    .insert({
      org_id: ids.org,
      job_number: "",
      name: name(key),
      account_id: accountId,
      work_types: ["interior"],
      owner_id: ids.estimator,
    })
    .select("id")
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  return data.id;
}

async function seedRequest(
  jobId: string,
  by: string,
  from: string,
  to: string,
  reason: string,
): Promise<string> {
  const { data, error } = await adminClient()
    .from("approval_requests")
    .insert({
      org_id: ids.org,
      type: "stage_override",
      job_id: jobId,
      requested_by: by,
      reason,
      payload: {
        from_stage: from,
        to_stage: to,
        gate_reasons: [`Skipping ahead needs an owner override (${t}).`],
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function request(id: string) {
  const { data } = await adminClient()
    .from("approval_requests")
    .select("status, decided_by, decision_note")
    .eq("id", id)
    .single();
  return data as { status: string; decided_by: string | null; decision_note: string | null };
}

async function jobStage(id: string): Promise<string> {
  const { data } = await adminClient().from("jobs").select("stage").eq("id", id).single();
  return (data as { stage: string }).stage;
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

async function signedIn(browser: Browser, info: TestInfo, role: TestRole, next: string) {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    timezoneId: use.timezoneId,
    locale: use.locale,
  });
  const page = await context.newPage();
  // The test users are shared with other runs on this machine; a parallel
  // sign-in as the same user can cancel ours, so try again when bounced to /login.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await loginAs(page, role, next);
      if (!/\/(login|mfa)(\?|$)/.test(page.url())) return page;
    } catch (e) {
      if (attempt === 5) throw e;
    }
    await page.waitForTimeout(1500 + Math.random() * 2500 * attempt);
  }
  throw new Error(`Couldn't sign in as ${role}`);
}

/** Status of `path` for `role`, signing in again if a parallel run signed us out. */
async function statusAs(
  browser: Browser,
  info: TestInfo,
  role: TestRole,
  path: string,
  tries = 3,
): Promise<number | undefined> {
  const page = await signedIn(browser, info, role, "/");
  const res = await open(page, path);
  const bounced = /\/(login|mfa)(\?|$)/.test(page.url());
  await page.context().close();
  if (bounced && tries > 1) return statusAs(browser, info, role, path, tries - 1);
  return res?.status();
}

const row = (page: Page, key: keyof typeof job) =>
  page.getByTestId("approval-row").filter({ hasText: name(key) });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  ids.org = org!.id;
  ids.owner = await userId(TEST_USERS.owner.email);
  ids.estimator = await userId(TEST_USERS.estimator.email);
  ids.office = await userId(TEST_USERS.office_manager.email);
  const { data: account, error } = await db
    .from("accounts")
    .insert({ org_id: ids.org, display_name: `Appr${t} Residence`, owner_id: ids.estimator })
    .select("id")
    .single();
  if (error) throw error;
  accountIds.push(account.id);

  for (const k of Object.keys(job) as (keyof typeof job)[]) job[k] = await seedJob(k, account.id);

  // The hold-blocked job sits in Onboarding with a blocking hold.
  const { error: moveError } = await asOwner().rpc("apply_job_stage_change", {
    p_job: job.blocked,
    p_from: "walkthrough_scheduled",
    p_to: "onboarding",
    p_override: true,
    p_reason: `E2E setup ${t}: move to onboarding`,
  });
  if (moveError) throw moveError;
  const { error: holdError } = await db.from("job_holds").insert({
    org_id: ids.org,
    job_id: job.blocked,
    hold_type: "hoa",
    reason: `Waiting on HOA approval (${t})`,
    blocks_scheduling: true,
  });
  if (holdError) throw holdError;

  const why = `Customer signed the paper contract on site (${t})`;
  req.approve = await seedRequest(
    job.approve,
    ids.estimator,
    "walkthrough_scheduled",
    "estimate_sent",
    why,
  );
  req.reject = await seedRequest(job.reject, ids.estimator, "walkthrough_scheduled", "sold", why);
  req.cancel = await seedRequest(job.cancel, ids.estimator, "walkthrough_scheduled", "sold", why);
  req.blocked = await seedRequest(
    job.blocked,
    ids.estimator,
    "onboarding",
    "ready_to_schedule",
    why,
  );
  req.other = await seedRequest(job.other, ids.office, "walkthrough_scheduled", "sold", why);
  req.stale = await seedRequest(job.stale, ids.estimator, "walkthrough_scheduled", "sold", why);
});

test.afterAll(async () => {
  const db = adminClient();
  await db.from("notifications").delete().ilike("title", `%Appr${t}%`);
  await deleteJobs(jobIds);
  await deleteAccounts(accountIds);
});

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("Approvals as the estimator (requester)", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop");
  let page: Page;
  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    page = await signedIn(browser, info, "estimator", "/jobs/approvals");
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("sees only their own requests and no Approve buttons", async () => {
    await open(page, "/jobs/approvals");
    await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
    await expect(row(page, "approve")).toBeVisible();
    await expect(row(page, "blocked")).toBeVisible();
    await expect(row(page, "other")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All requests", exact: true })).toHaveCount(0);
    await expect(row(page, "approve").getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(
      row(page, "approve").getByText(`Skipping ahead needs an owner override (${t}).`),
    ).toBeVisible();
  });

  test("cancels their pending request", async () => {
    await row(page, "cancel").getByRole("button", { name: "Cancel request" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel your request" });
    await dialog.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByText("Request canceled.").first()).toBeVisible({ timeout: 30_000 });
    expect((await request(req.cancel)).status).toBe("canceled");
    await expect(row(page, "cancel")).toHaveCount(0);
  });
});

test.describe("Approvals as the owner", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop; layout is checked below");
  let page: Page;
  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    page = await signedIn(browser, info, "owner", "/jobs/approvals");
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("sees everyone's pending requests grouped by requester", async () => {
    await open(page, "/jobs/approvals");
    await expect(row(page, "approve")).toBeVisible();
    await expect(row(page, "other")).toBeVisible();
    await expect(row(page, "cancel")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: new RegExp(TEST_USERS.estimator.fullName) }),
    ).toBeVisible();
    await expect(row(page, "approve").getByText("Walkthrough Scheduled")).toBeVisible();
    await expect(row(page, "approve").getByText("Estimate Sent")).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/approvals.png`, fullPage: false });
    expect(await seriousAxe(page)).toEqual([]);
  });

  test("approve moves the job with an override tied to the request", async () => {
    await row(page, "approve").getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve override" });
    await dialog.getByLabel("Note (optional)").fill("Go ahead");
    await dialog.getByRole("button", { name: "Approve and move job" }).click();
    await expect(page.getByText(/^Approved\./).first()).toBeVisible({ timeout: 45_000 });
    expect(await jobStage(job.approve)).toBe("estimate_sent");
    const r = await request(req.approve);
    expect(r).toMatchObject({
      status: "approved",
      decided_by: ids.owner,
      decision_note: "Go ahead",
    });
    const { data: history } = await adminClient()
      .from("stage_history")
      .select("from_stage, to_stage, override, reason, approval_request_id, changed_by")
      .eq("job_id", job.approve)
      .eq("to_stage", "estimate_sent")
      .single();
    expect(history).toMatchObject({
      from_stage: "walkthrough_scheduled",
      override: true,
      approval_request_id: req.approve,
      changed_by: ids.owner,
    });
    expect(history!.reason).toBe(
      `Customer signed the paper contract on site (${t}) (approved by ${TEST_USERS.owner.fullName})`,
    );
  });

  test("reject needs a note", async () => {
    await open(page, "/jobs/approvals");
    await row(page, "reject").getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject request" });
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(dialog.getByText("Say why you're rejecting it.")).toBeVisible();
    expect((await request(req.reject)).status).toBe("pending");
    await dialog.getByLabel(/Why are you rejecting it/).fill("Wait for the signed estimate");
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByText("Request rejected.", { exact: false }).first()).toBeVisible({
      timeout: 45_000,
    });
    expect(await request(req.reject)).toMatchObject({
      status: "rejected",
      decision_note: "Wait for the signed estimate",
    });
    expect(await jobStage(job.reject)).toBe("walkthrough_scheduled");
  });

  test("a request blocked by a hold shows the error and stays pending", async () => {
    await open(page, "/jobs/approvals");
    await row(page, "blocked").getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve override" });
    await dialog.getByRole("button", { name: "Approve and move job" }).click();
    await expect(dialog.getByText(/Release the HOA Hold/)).toBeVisible({
      timeout: 45_000,
    });
    expect((await request(req.blocked)).status).toBe("pending");
    expect(await jobStage(job.blocked)).toBe("onboarding");
  });

  test("a request the job already moved past can't be approved and is rejected as out of date", async () => {
    await open(page, "/jobs/approvals");
    await expect(row(page, "stale")).toBeVisible();
    // An owner moves the job another way after the page loaded.
    const { error } = await asOwner().rpc("apply_job_stage_change", {
      p_job: job.stale,
      p_from: "walkthrough_scheduled",
      p_to: "walkthrough_complete",
      p_override: true,
      p_reason: `E2E ${t}: moved on the job page`,
    });
    if (error) throw error;
    await row(page, "stale").getByRole("button", { name: "Approve" }).click();
    let dialog = page.getByRole("dialog", { name: "Approve override" });
    await dialog.getByRole("button", { name: "Approve and move job" }).click();
    await expect(
      dialog.getByText(/This job moved from Walkthrough Scheduled to Walkthrough Complete/).first(),
    ).toBeVisible({ timeout: 45_000 });
    await dialog.getByRole("button", { name: "Reject as out of date" }).click();
    dialog = page.getByRole("dialog", { name: "Reject request" });
    await expect(dialog.getByLabel(/Why are you rejecting it/)).toHaveValue(/^Out of date: /);
    await dialog.getByRole("button", { name: "Back" }).click();
    expect((await request(req.stale)).status).toBe("pending");
    expect(await jobStage(job.stale)).toBe("walkthrough_complete");

    // After a reload the row says so and Approve explains why it's unavailable.
    await open(page, "/jobs/approvals");
    await expect(
      row(page, "stale").getByText(/Job already moved from Walkthrough Scheduled/),
    ).toBeVisible();
    await expect(row(page, "stale").getByRole("button", { name: "Approve" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await row(page, "stale").getByRole("button", { name: "Reject" }).click();
    dialog = page.getByRole("dialog", { name: "Reject request" });
    await expect(dialog.getByLabel(/Why are you rejecting it/)).toHaveValue(
      /^Out of date: The job already moved from Walkthrough Scheduled to Walkthrough Complete/,
    );
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByText("Request rejected.", { exact: false }).first()).toBeVisible({
      timeout: 45_000,
    });
    const r = await request(req.stale);
    expect(r.status).toBe("rejected");
    expect(r.decision_note).toMatch(/^Out of date: /);
  });

  test("decided requests show on the Decided tab", async () => {
    await open(page, "/jobs/approvals?status=decided");
    await expect(row(page, "approve").getByText("Approved", { exact: true })).toBeVisible();
    await expect(row(page, "reject").getByText("Wait for the signed estimate")).toBeVisible();
  });
});

test.describe("Approvals layout", () => {
  test("no sideways scroll at 390px and no serious accessibility issues", async ({
    browser,
  }, info) => {
    const page = await signedIn(browser, info, "owner", "/jobs/approvals");
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/jobs/approvals");
    await expect(row(page, "blocked")).toBeVisible();
    await noSideScroll(page);
    expect(await seriousAxe(page)).toEqual([]);
    await page.context().close();
  });

  test("people who can't move stages get a 404", async ({ browser }, info) => {
    expect(await statusAs(browser, info, "painter", "/jobs/approvals")).toBe(404);
  });
});
