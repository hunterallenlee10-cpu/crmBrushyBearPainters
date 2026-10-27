import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * New Job (SPEC §8.5): pick a customer, its property and contact, work types;
 * the job starts at Walkthrough Scheduled and the page opens it. The job page
 * itself is built separately, so the redirect is checked by URL and database.
 */

const SCREENS = "docs/screens/phase-3";
const t = randomUUID().slice(0, 6);
const accountIds: string[] = [];
const jobIds: string[] = [];
const ids = { org: "", owner: "", estimator: "" };
const seed = { account: "", kirkland: "", redmond: "", contact: "", estAccount: "" };
const JOB_URL = /\/jobs\/([0-9a-f-]{36})$/;

async function userId(email: string): Promise<string> {
  const { data } = await adminClient().from("profiles").select("id").eq("email", email).single();
  return data!.id;
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

async function seedAccount(displayName: string, ownerId: string) {
  const db = adminClient();
  const { data: a, error } = await db
    .from("accounts")
    .insert({ org_id: ids.org, display_name: displayName, owner_id: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  accountIds.push(a.id);
  return a.id as string;
}

test.beforeAll(async () => {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  ids.org = org!.id;
  ids.owner = await userId(TEST_USERS.owner.email);
  ids.estimator = await userId(TEST_USERS.estimator.email);

  seed.account = await seedAccount(`Newjob${t} Residence`, ids.owner);
  const { data: c, error: cErr } = await db
    .from("contacts")
    .insert({
      org_id: ids.org,
      account_id: seed.account,
      first_name: "Nora",
      last_name: `Newjob${t}`,
    })
    .select("id")
    .single();
  if (cErr) throw cErr;
  seed.contact = c.id;
  await db.from("accounts").update({ primary_contact_id: c.id }).eq("id", seed.account);
  const { data: props, error: pErr } = await db
    .from("properties")
    .insert([
      {
        org_id: ids.org,
        account_id: seed.account,
        is_primary: true,
        street: "1 Sample Ln",
        city: "Kirkland",
        state: "WA",
        zip: "98033",
      },
      {
        org_id: ids.org,
        account_id: seed.account,
        is_primary: false,
        street: "2 Sample Ct",
        city: "Redmond",
        state: "WA",
        zip: "98052",
      },
    ])
    .select("id, city");
  if (pErr) throw pErr;
  seed.kirkland = props!.find((p) => p.city === "Kirkland")!.id;
  seed.redmond = props!.find((p) => p.city === "Redmond")!.id;

  seed.estAccount = await seedAccount(`Estjob${t} Residence`, ids.estimator);
});

test.afterAll(async () => {
  const { data } = await adminClient().from("jobs").select("id").in("account_id", accountIds);
  await deleteJobs([...new Set([...jobIds, ...(data ?? []).map((j: { id: string }) => j.id)])]);
  await deleteAccounts(accountIds);
});

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("New Job (owner)", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop; layout is checked below");
  let page: Page;
  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    page = await signedIn(browser, info, "owner", "/jobs/new");
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("creates a job at Walkthrough Scheduled and opens it", async () => {
    await open(page, "/jobs/new");
    await expect(page.getByRole("heading", { level: 1, name: "New Job" })).toBeVisible();
    await page.getByLabel("Search customers").fill(`Newjob${t}`);
    await page.getByRole("button", { name: new RegExp(`Newjob${t} Residence`) }).click();
    await expect(page.getByTestId("chosen-account")).toHaveText(`Newjob${t} Residence`);
    await expect(page.getByLabel("Primary contact")).toHaveValue(seed.contact);
    await expect(page.getByLabel("Property")).toHaveValue(seed.kirkland);
    await page.getByLabel("Property").selectOption(seed.redmond);

    // Work types are required.
    await page.getByRole("button", { name: "Create job" }).click();
    await expect(page.getByText("Pick at least one work type.")).toBeVisible();

    await page.getByLabel("Interior", { exact: true }).check();
    await page.getByLabel("Cabinets", { exact: true }).check();
    await expect(page.getByLabel("Job name")).toHaveValue(
      `Newjob${t} – Redmond – Interior, Cabinets`,
    );
    await expect(page.getByLabel("Owner")).toHaveValue(ids.owner);
    await page.getByLabel("Priority").selectOption("high");
    const season = String(new Date().getFullYear() + 1);
    await page.getByLabel("Target season").selectOption(season);
    await page.getByLabel("Lead source").selectOption({ index: 1 });
    await expect(page.getByText("Some fields need attention.")).toBeHidden({ timeout: 15_000 });
    await page.setViewportSize({ width: 1440, height: 1150 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SCREENS}/jobs-new.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await seriousAxe(page)).toEqual([]);

    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(JOB_URL, { timeout: 60_000 });
    const id = JOB_URL.exec(page.url())![1]!;
    jobIds.push(id);
    const { data: job } = await adminClient()
      .from("jobs")
      .select(
        "stage, account_id, property_id, primary_contact_id, work_types, name, owner_id, priority, target_season, job_number, lead_source, created_by",
      )
      .eq("id", id)
      .single();
    expect(job).toMatchObject({
      stage: "walkthrough_scheduled",
      account_id: seed.account,
      property_id: seed.redmond,
      primary_contact_id: seed.contact,
      work_types: ["interior", "cabinets"],
      name: `Newjob${t} – Redmond – Interior, Cabinets`,
      owner_id: ids.owner,
      priority: "high",
      target_season: Number(season),
      created_by: ids.owner,
    });
    expect(job!.job_number).toMatch(/^BB-\d{4}-\d{4,}$/);
    expect(job!.lead_source).toBeTruthy();
    const { data: history } = await adminClient()
      .from("stage_history")
      .select("from_stage, to_stage")
      .eq("job_id", id);
    expect(history).toEqual([{ from_stage: null, to_stage: "walkthrough_scheduled" }]);
  });

  test("?account= preselects the customer and an edited name is kept", async () => {
    await open(page, `/jobs/new?account=${seed.account}`);
    await expect(page.getByTestId("chosen-account")).toHaveText(`Newjob${t} Residence`);
    await page.getByLabel("Exterior", { exact: true }).check();
    await page.getByLabel("Job name").fill(`Newjob${t} garage refresh`);
    await page.getByLabel("Deck & Fence", { exact: true }).check();
    await expect(page.getByLabel("Job name")).toHaveValue(`Newjob${t} garage refresh`);
    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(JOB_URL, { timeout: 60_000 });
    const id = JOB_URL.exec(page.url())![1]!;
    jobIds.push(id);
    const { data: job } = await adminClient()
      .from("jobs")
      .select("name, work_types, property_id")
      .eq("id", id)
      .single();
    expect(job).toEqual({
      name: `Newjob${t} garage refresh`,
      work_types: ["exterior", "deck_fence"],
      property_id: seed.kirkland,
    });
  });
});

test.describe("New Job permissions and layout", () => {
  test("an estimator owns the jobs they create", async ({ browser, isMobile }, info) => {
    test.skip(isMobile, "Desktop only");
    const page = await signedIn(browser, info, "estimator", `/jobs/new?account=${seed.estAccount}`);
    await open(page, `/jobs/new?account=${seed.estAccount}`);
    await expect(page.getByTestId("chosen-account")).toHaveText(`Estjob${t} Residence`);
    await expect(page.getByLabel("Owner")).toBeDisabled();
    await page.getByLabel("Interior", { exact: true }).check();
    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(JOB_URL, { timeout: 60_000 });
    const id = JOB_URL.exec(page.url())![1]!;
    jobIds.push(id);
    const { data: job } = await adminClient().from("jobs").select("owner_id").eq("id", id).single();
    expect(job).toEqual({ owner_id: ids.estimator });
    await page.context().close();
  });

  test("no sideways scroll at 390px", async ({ browser }, info) => {
    const page = await signedIn(browser, info, "owner", `/jobs/new?account=${seed.account}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `/jobs/new?account=${seed.account}`);
    await expect(page.getByTestId("chosen-account")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await seriousAxe(page)).toEqual([]);
    await page.context().close();
  });

  test("people who can't create jobs get a 404", async ({ browser }, info) => {
    expect(await statusAs(browser, info, "painter", "/jobs/new")).toBe(404);
  });
});
