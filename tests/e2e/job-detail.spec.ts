import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { formatInTimeZone } from "date-fns-tz";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * Job Detail (SPEC §8.5): shell and sections, the stage gate, walkthrough
 * result → auto-advance, owner override (with and without a reason), the
 * estimator's "Ask an owner", holds blocking Ready to Schedule, Admin dates and
 * contract baseline, Close as lost, and row security (a painter who isn't on
 * the job gets a 404). Obviously fake data, removed afterwards.
 */

const TZ = "America/Los_Angeles";
const SCREENS = "docs/screens/phase-3";
const t = randomUUID().slice(0, 6);
const jobIds: string[] = [];
const accountIds: string[] = [];

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

/** Account + contact + property + job, straight into the database (service role). */
async function seedJob(label: string, owner: TestRole): Promise<{ id: string; number: string }> {
  const db = adminClient();
  const org = await orgId();
  const ownerId = await userId(owner);
  const { data: account, error: aErr } = await db
    .from("accounts")
    .insert({ org_id: org, display_name: `Testfield ${label} ${t} Residence`, owner_id: ownerId })
    .select("id")
    .single();
  if (aErr) throw aErr;
  accountIds.push(account.id);
  const { data: contact, error: cErr } = await db
    .from("contacts")
    .insert({
      org_id: org,
      account_id: account.id,
      first_name: "Tess",
      last_name: `Testfield${t}`,
      mobile: `+142555502${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
      email: `tess-${label.toLowerCase()}-${t}@example.com`,
    })
    .select("id")
    .single();
  if (cErr) throw cErr;
  const { data: property, error: pErr } = await db
    .from("properties")
    .insert({
      org_id: org,
      account_id: account.id,
      is_primary: true,
      street: "456 Example Ave",
      city: "Kirkland",
      zip: "98033",
      year_built: 1965,
      stories: 2,
      siding_type: "cedar_wood",
      has_hoa: true,
      hoa_name: "Sample Ridge HOA",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;
  const { data: job, error } = await db
    .from("jobs")
    .insert({
      org_id: org,
      name: `Testfield – Kirkland – ${label} ${t}`,
      account_id: account.id,
      property_id: property.id,
      primary_contact_id: contact.id,
      work_types: ["exterior", "interior"],
      owner_id: ownerId,
      point_of_contact_id: ownerId,
      lead_source: "website",
    })
    .select("id, job_number")
    .single();
  if (error) throw error;
  jobIds.push(job.id);
  return { id: job.id, number: job.job_number };
}

async function jobRow(id: string) {
  const { data } = await adminClient().from("jobs").select("*").eq("id", id).single();
  return data as Record<string, unknown>;
}

async function history(id: string) {
  const { data } = await adminClient()
    .from("stage_history")
    .select("from_stage, to_stage, override, reason")
    .eq("job_id", id)
    .order("seq", { ascending: true });
  return (data ?? []) as {
    from_stage: string | null;
    to_stage: string;
    override: boolean;
    reason: string | null;
  }[];
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
 * Opens a page, retrying the shared dev server's transient 500s, and waits for
 * hydration. The shared test machine sometimes runs out of memory and Chromium
 * kills the tab; then the same signed-in context opens a fresh tab.
 */
async function open(page: Page, path: string): Promise<Page> {
  for (let attempt = 0; ; attempt++) {
    try {
      let res = await page.goto(path);
      for (let i = 0; i < 3 && res?.status() === 500; i++) {
        await page.waitForTimeout(2000);
        res = await page.goto(path);
      }
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      return page;
    } catch (e) {
      if (attempt >= 2 || !/crash/i.test(String(e))) throw e;
      page = await page.context().newPage();
    }
  }
}

/** Waits for the toast, then reloads (proves the change was saved). */
async function afterSave(page: Page, toast: string | RegExp, path: string): Promise<Page> {
  await expect(page.getByText(toast).first()).toBeVisible({ timeout: 45_000 });
  return open(page, path);
}

async function signedInPage(browser: Browser, info: TestInfo, role: TestRole, next: string) {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport ?? { width: 1440, height: 900 },
    timezoneId: use.timezoneId,
    locale: use.locale,
  });
  const page = await context.newPage();
  // Other worktrees sign in as the same test users on this machine; a sign-in
  // that lands back on /login or /mfa is retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    await loginAs(page, role, next);
    if (!/^\/(login|mfa)$/.test(new URL(page.url()).pathname)) break;
  }
  return page;
}

const header = (page: Page) =>
  page
    .locator("header")
    .filter({ has: page.locator("h1") })
    .last();
const stagePanel = (page: Page) => page.getByRole("region", { name: "Milestones" });

test.afterAll(async () => {
  await deleteJobs(jobIds);
  await deleteAccounts(accountIds);
});

test.describe("Job Detail (owner)", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop; phones are checked below");
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let job = { id: "", number: "" };
  let path = "";
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    job = await seedJob("Main", "owner");
    path = `/jobs/${job.id}`;
    page = await signedInPage(browser, info, "owner", path);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("header, section nav and empty sections render", async () => {
    page = await open(page, path);
    await expect(
      page.getByRole("heading", { level: 1, name: `Testfield – Kirkland – Main ${t}` }),
    ).toBeVisible();
    await expect(header(page).getByText(`Job #${job.number}`)).toBeVisible();
    await expect(header(page).getByText(`Testfield Main ${t} Residence`)).toBeVisible();
    await expect(header(page)).toContainText("· 1 job");
    await expect(header(page).getByText("Walkthrough Scheduled")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Job sections" });
    await expect(nav.getByRole("link")).toHaveCount(16);
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Property quick info: built 1965 → lead-safe; HOA.
    await expect(page.getByText("Lead-safe practices apply")).toBeVisible();
    await expect(page.getByText(/Yes · Sample Ridge HOA/)).toBeVisible();
    // Money is visible to owners; Paid/Balance wait for Phase 7.
    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    await expect(page.getByText("Arrives with Money (Phase 7)").first()).toBeVisible();
    // Build Estimate opens the Estimate & Scope section (Phase 4).
    await expect(page.getByRole("link", { name: "Build Estimate" }).first()).toHaveAttribute(
      "href",
      /section=estimate/,
    );

    await nav.getByRole("link", { name: "Photos" }).click();
    await expect(page).toHaveURL(/section=photos/);
    await expect(page.locator("#job-section-title")).toHaveText("Photos");
    await expect(page.getByRole("heading", { name: "No photos yet" })).toBeVisible();
    await nav.getByRole("link", { name: "Notes" }).click();
    await expect(page).toHaveURL(/section=notes/);
    await expect(page.locator("#job-section-title")).toHaveText("Notes");
  });

  test("the gate blocks Advance with a clear reason", async () => {
    page = await open(page, path);
    const panel = stagePanel(page);
    await expect(panel.getByText("Next: Walkthrough Complete.")).toBeVisible();
    await expect(
      panel.getByText("The walkthrough hasn't been completed with the result “Measured” yet."),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Advance to/ })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Override…" })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/job-detail-overview.png` });
    expect(await seriousAxe(page)).toEqual([]);
  });

  test("completing the walkthrough as Measured moves the job to Walkthrough Complete", async () => {
    page = await open(page, path);
    await page.getByRole("button", { name: "Book appointment" }).click();
    const dialog = page.getByRole("dialog", { name: "Book an appointment" });
    const tomorrow = formatInTimeZone(new Date(Date.now() + 86_400_000), TZ, "yyyy-MM-dd");
    await dialog.getByLabel("Date").fill(tomorrow);
    await dialog.getByLabel("Time (Pacific)").fill("10:00");
    await dialog.getByRole("button", { name: "Book appointment" }).click();
    page = await afterSave(page, "Walkthrough / Estimate booked.", path);

    const schedule = page.getByRole("region", { name: "Schedule" });
    await expect(schedule.getByText("Walkthrough / Estimate")).toBeVisible();
    await expect(schedule.getByRole("button", { name: "Mark completed" })).toBeVisible();
    // The "Result Walkthrough" shortcut opens the result dialog for the open walkthrough.
    await page.getByRole("link", { name: "Result Walkthrough" }).click();
    const result = page.getByRole("dialog", { name: "Result the walkthrough" });
    await result.getByRole("button", { name: "Save result" }).click();
    await expect(result.getByText("Pick the walkthrough result.")).toBeVisible();
    await result.getByLabel("Measured").check();
    await result.getByRole("button", { name: "Save result" }).click();
    page = await afterSave(page, /Job moved to Walkthrough Complete/, path);

    await expect(header(page).getByText("Walkthrough Complete")).toBeVisible();
    expect((await jobRow(job.id)).stage).toBe("walkthrough_complete");
    const rows = await history(job.id);
    expect(rows.at(-1)).toMatchObject({
      from_stage: "walkthrough_scheduled",
      to_stage: "walkthrough_complete",
      override: false,
    });
  });

  test("an override without a reason is refused", async () => {
    page = await open(page, path);
    const panel = stagePanel(page);
    await expect(panel.getByText("No estimate has been sent yet.")).toBeVisible();
    await panel.getByRole("button", { name: "Override…" }).click();
    const dialog = page.getByRole("dialog", { name: "Override: move to Estimate Sent" });
    await expect(dialog.getByText("What the gate is waiting on:")).toBeVisible();
    await dialog.getByRole("button", { name: "Override and move" }).click();
    await expect(
      dialog.getByText("Say why you're overriding (at least 10 characters)."),
    ).toBeVisible();
    await dialog.getByLabel(/Why are you overriding/).fill("too short");
    await dialog.getByRole("button", { name: "Override and move" }).click();
    await expect(
      dialog.getByText("Say why you're overriding (at least 10 characters)."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await jobRow(job.id)).stage).toBe("walkthrough_complete");
  });

  test("an owner override with a reason moves the job and shows in history and activity", async () => {
    page = await open(page, path);
    await stagePanel(page).getByRole("button", { name: "Override…" }).click();
    const dialog = page.getByRole("dialog", { name: "Override: move to Estimate Sent" });
    const reason = `Estimate emailed outside the CRM ${t}`;
    await dialog.getByLabel(/Why are you overriding/).fill(reason);
    await page.screenshot({ path: `${SCREENS}/job-detail-advance.png` });
    await dialog.getByRole("button", { name: "Override and move" }).click();
    page = await afterSave(page, "Moved to Estimate Sent.", path);

    await expect(header(page).getByText("Estimate Sent")).toBeVisible();
    const rows = await history(job.id);
    expect(rows.at(-1)).toMatchObject({
      from_stage: "walkthrough_complete",
      to_stage: "estimate_sent",
      override: true,
      reason,
    });
    await page.getByText(/Stage history \(\d+\)/).click();
    const list = page.getByRole("list", { name: "Stage history" });
    await expect(list.getByText("Owner override").first()).toBeVisible();
    await expect(list.getByText(reason, { exact: false })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Recent activity" }).getByText(/owner override/),
    ).toBeVisible();
  });

  test("an HOA hold shows a pill and blocks Ready to Schedule even for the owner", async () => {
    // Owner moves the job to Onboarding first (Move to stage…, with a reason).
    page = await open(page, path);
    await stagePanel(page).getByRole("button", { name: "More stage actions" }).click();
    await page.getByRole("menuitem", { name: "Move to stage…" }).click();
    const move = page.getByRole("dialog", { name: "Move to another stage" });
    await move.getByLabel("Move to").selectOption("onboarding");
    await move.getByLabel(/Why are you overriding/).fill(`Signed on paper, deposit by check ${t}`);
    await move.getByRole("button", { name: "Override and move" }).click();
    page = await afterSave(page, "Moved to Onboarding.", path);
    await expect(header(page).getByText("Onboarding", { exact: true })).toBeVisible();

    page = await open(page, `${path}?section=onboarding`);
    await page.getByRole("tab", { name: /Holds/ }).click();
    await page.getByRole("button", { name: "Place hold" }).click();
    const place = page.getByRole("dialog", { name: "Place a hold" });
    await place.getByRole("button", { name: "Place hold" }).click();
    await expect(place.getByText("Pick the kind of hold.")).toBeVisible();
    await place.getByLabel("Hold type").selectOption("hoa");
    await place.getByLabel("What is it waiting on?").fill("Waiting on HOA color approval");
    await expect(place.getByRole("switch", { name: "Blocks scheduling" })).toBeChecked();
    await place.getByRole("button", { name: "Place hold" }).click();
    page = await afterSave(page, "Hold placed.", `${path}?section=onboarding&tab=holds`);

    await expect(header(page).getByText("HOA Hold", { exact: true })).toBeVisible();
    await expect(page.getByText("Waiting on HOA color approval")).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/job-detail-holds.png` });
    expect(await seriousAxe(page)).toEqual([]);

    page = await open(page, path);
    const panel = stagePanel(page);
    await expect(panel.getByText(/Holds stop scheduling even with an override/)).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Advance to Ready to Schedule" }),
    ).toHaveAttribute("aria-disabled", "true");
    // Even Move to stage… refuses it while the hold is on.
    await panel.getByRole("button", { name: "More stage actions" }).click();
    await page.getByRole("menuitem", { name: "Move to stage…" }).click();
    const move2 = page.getByRole("dialog", { name: "Move to another stage" });
    await move2.getByLabel("Move to").selectOption("ready_to_schedule");
    await expect(move2.getByText("This move is blocked:")).toBeVisible();
    await expect(move2.getByRole("button", { name: "Move job" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await move2.getByRole("button", { name: "Cancel" }).click();
    expect((await jobRow(job.id)).stage).toBe("onboarding");

    // Releasing the hold clears the pill and the block.
    page = await open(page, `${path}?section=onboarding&tab=holds`);
    await page.getByRole("button", { name: /^Release/ }).click();
    const release = page.getByRole("dialog", { name: /Release the HOA Hold/ });
    await release.getByLabel("Note (optional)").fill("HOA approved the colors");
    await release.getByRole("button", { name: "Release hold" }).click();
    page = await afterSave(page, "Hold released.", path);
    await expect(header(page).getByText("HOA Hold", { exact: true })).toHaveCount(0);
    await expect(stagePanel(page).getByRole("button", { name: "Override…" })).toBeVisible();
  });

  test("the owner edits a milestone date and the contract baseline in Admin", async () => {
    page = await open(page, `${path}?section=admin`);
    await expect(
      page.getByText("Changes here save immediately and are audit-logged."),
    ).toBeVisible();
    const signed = page.getByLabel("Contract signed", { exact: true });
    await signed.fill("2026-10-20T09:30");
    await signed.blur();
    await expect(page.getByText("Contract signed saved.").first()).toBeVisible({
      timeout: 45_000,
    });
    await expect
      .poll(async () => {
        const v = (await jobRow(job.id)).contract_signed_at as string | null;
        return v ? new Date(v).toISOString() : null;
      })
      .toBe("2026-10-20T16:30:00.000Z");

    await page.getByLabel("Amount (USD)").fill("12,500");
    await page.getByRole("button", { name: "Save amount" }).click();
    page = await afterSave(page, "Contract baseline saved.", `${path}?section=admin`);
    const { data: fin } = await adminClient()
      .from("job_financials")
      .select("contract_baseline_cents")
      .eq("job_id", job.id)
      .single();
    expect(fin?.contract_baseline_cents).toBe(1_250_000);
    await expect(page.getByLabel("Contract signed", { exact: true })).toHaveValue(
      "2026-10-20T09:30",
    );
    await page.screenshot({ path: `${SCREENS}/job-detail-admin.png`, fullPage: true });
    expect(await seriousAxe(page)).toEqual([]);

    page = await open(page, path);
    await expect(page.getByRole("region", { name: "Money" }).getByText("$12,500.00")).toBeVisible();
  });

  test("390px wide: no sideways scroll; sections switch from a select", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    page = await open(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${SCREENS}/job-detail-mobile.png` });
    await page.getByLabel("Section", { exact: true }).selectOption("admin");
    await expect(page).toHaveURL(/section=admin/);
    await noSideScroll(page);
    expect(await seriousAxe(page)).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("closing as lost needs a lost reason", async () => {
    page = await open(page, path);
    await stagePanel(page).getByRole("button", { name: "More stage actions" }).click();
    await page.getByRole("menuitem", { name: "Close as lost…" }).click();
    const dialog = page.getByRole("dialog", { name: "Close this job as lost" });
    await dialog.getByRole("button", { name: "Close as lost" }).click();
    await expect(dialog.getByText("Pick a lost reason.")).toBeVisible();
    expect((await jobRow(job.id)).stage).toBe("onboarding");
    await dialog.getByLabel("Lost reason").selectOption("price");
    await dialog.getByRole("button", { name: "Close as lost" }).click();
    page = await afterSave(page, "Job closed as lost.", path);
    await expect(header(page).getByText("Closed Lost")).toBeVisible();
    const row = await jobRow(job.id);
    expect(row.stage).toBe("closed_lost");
    expect(row.lost_reason).toBe("price");
  });
});

test.describe("Job Detail (estimator on their own job)", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let job = { id: "", number: "" };
  let path = "";
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    job = await seedJob("Est", "estimator");
    path = `/jobs/${job.id}`;
    page = await signedInPage(browser, info, "estimator", path);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("no Admin and no money", async () => {
    page = await open(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Est ${t}`);
    const nav = page.getByRole("navigation", { name: "Job sections" });
    await expect(nav.getByRole("link")).toHaveCount(15);
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Money" })).toHaveCount(0);
    await expect(page.getByText("$")).toHaveCount(0);
    page = await open(page, `${path}?section=admin`);
    await expect(page.locator("#job-section-title")).toHaveText("Overview");
  });

  test("asks an owner to override, sees it waiting, and cancels it", async () => {
    page = await open(page, path);
    const panel = stagePanel(page);
    await expect(panel.getByRole("button", { name: "Override…" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Ask an owner to override" }).click();
    const dialog = page.getByRole("dialog", { name: /Ask an owner to move this job/ });
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("Say why (at least 10 characters).")).toBeVisible();
    const reason = `Measured on site, form was lost ${t}`;
    await dialog.getByLabel("Why should it move?").fill(reason);
    await dialog.getByRole("button", { name: "Send request" }).click();
    page = await afterSave(page, "Sent to an owner for approval.", path);

    const waiting = stagePanel(page)
      .getByRole("status")
      .filter({ hasText: "Waiting for an owner" });
    await expect(waiting).toContainText(reason);
    await expect(
      stagePanel(page).getByRole("button", { name: "Ask an owner to override" }),
    ).toHaveCount(0);
    const { data: req } = await adminClient()
      .from("approval_requests")
      .select("id, status, payload, requested_by")
      .eq("job_id", job.id)
      .single();
    expect(req?.status).toBe("pending");
    expect(req?.requested_by).toBe(await userId("estimator"));
    expect(req?.payload).toMatchObject({
      from_stage: "walkthrough_scheduled",
      to_stage: "walkthrough_complete",
    });

    await waiting.getByRole("button", { name: "Cancel request" }).click();
    page = await afterSave(page, "Request canceled.", path);
    await expect(stagePanel(page).getByText("Waiting for an owner")).toHaveCount(0);
    const { data: after } = await adminClient()
      .from("approval_requests")
      .select("status")
      .eq("id", req!.id)
      .single();
    expect(after?.status).toBe("canceled");
  });
});

test.describe("Job Detail (row security)", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");
  test.describe.configure({ timeout: 180_000 });

  test("a painter who isn't on the job gets a 404", async ({ browser }, info) => {
    test.setTimeout(180_000);
    const job = await seedJob("Hidden", "owner");
    const page = await signedInPage(browser, info, "painter", "/");
    const res = await page.goto(`/jobs/${job.id}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(`Hidden ${t}`)).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("Job Detail on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout only");
  test.describe.configure({ timeout: 180_000 });

  test("no sideways scroll; the section select and shortcuts work", async ({ browser }, info) => {
    test.setTimeout(180_000);
    const job = await seedJob("Phone", "owner");
    let page = await signedInPage(browser, info, "owner", `/jobs/${job.id}`);
    page = await open(page, `/jobs/${job.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Phone ${t}`);
    await noSideScroll(page);
    await page.getByLabel("Section", { exact: true }).selectOption("onboarding");
    await expect(page).toHaveURL(/section=onboarding/);
    await expect(page.locator("#job-section-title")).toHaveText("Onboarding");
    await noSideScroll(page);
    await page.getByText("Job shortcuts").click();
    await expect(page.getByRole("link", { name: "Order Paint" })).toBeVisible();
    expect(await seriousAxe(page)).toEqual([]);
    await page.context().close();
  });
});
