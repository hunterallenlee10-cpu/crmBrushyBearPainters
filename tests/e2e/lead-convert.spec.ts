import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { formatInTimeZone } from "date-fns-tz";
import { deleteAccounts, deleteLeadsAndJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * Lead → job conversion UI (SPEC §6.1): Convert to Job confirms work types and
 * opens the job; a converted lead shows a banner and is read-only; booking a
 * walkthrough (auto-convert on) opens the new job. The job page is built
 * separately, so redirects are checked by URL and database.
 */

const SCREENS = "docs/screens/phase-3";
const TZ = "America/Los_Angeles";
const t = randomUUID().slice(0, 6);
const seeded: string[] = [];
const JOB_URL = /\/jobs\/([0-9a-f-]{36})$/;

async function seedLead(fields: Record<string, unknown> = {}): Promise<string> {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  const { data: owner } = await db
    .from("profiles")
    .select("id")
    .eq("email", TEST_USERS.owner.email)
    .single();
  const { data, error } = await db
    .from("leads")
    .insert({
      org_id: org!.id,
      first_name: "Cora",
      last_name: `Convert${t}`,
      email: `cora-${t}-${seeded.length}@example.com`,
      street: `${100 + seeded.length} Sample Way`,
      city: "Bellevue",
      state: "WA",
      zip: "98004",
      services: ["interior", "other"],
      timeline: "asap",
      lead_source: "website",
      owner_id: owner!.id,
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw error;
  seeded.push(data.id);
  return data.id;
}

async function lead(id: string) {
  const { data } = await adminClient()
    .from("leads")
    .select("status, converted_job_id")
    .eq("id", id)
    .single();
  return data as { status: string; converted_job_id: string | null };
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

/** Shared test users: a parallel sign-in elsewhere can cancel ours, so retry. */
async function signIn(page: Page, role: TestRole, next: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await loginAs(page, role, next);
      if (!/\/(login|mfa)(\?|$)/.test(page.url())) return;
    } catch (e) {
      if (attempt === 5) throw e;
    }
    await page.waitForTimeout(1500 + Math.random() * 2500 * attempt);
  }
  throw new Error(`Couldn't sign in as ${role}`);
}

test.afterAll(async () => {
  const { accountIds } = await deleteLeadsAndJobs(seeded);
  await deleteAccounts(accountIds);
});

test.describe("Lead conversion (owner)", () => {
  test.skip(({ isMobile }) => isMobile, "Flow runs once on desktop");
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let page: Page;
  let leadId = "";
  let jobId = "";

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(180_000);
    leadId = await seedLead();
    const use = info.project.use;
    const context = await browser.newContext({
      baseURL: use.baseURL,
      viewport: use.viewport,
      timezoneId: use.timezoneId,
      locale: use.locale,
    });
    page = await context.newPage();
    await signIn(page, "owner", `/leads/${leadId}`);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("Convert to Job confirms work types and opens the job", async () => {
    await open(page, `/leads/${leadId}`);
    const convert = page.getByRole("button", { name: "Convert to Job" });
    await expect(convert).not.toHaveAttribute("aria-disabled", "true");
    await convert.click();
    const dialog = page.getByRole("dialog", { name: "Convert to Job" });
    await expect(dialog.getByLabel("Interior", { exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Add-on Only", { exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Exterior", { exact: true })).not.toBeChecked();
    await page.waitForTimeout(500); // let the dialog finish opening
    await page.screenshot({ path: `${SCREENS}/lead-convert.png` });
    expect(await seriousAxe(page)).toEqual([]);

    // At least one work type.
    await dialog.getByLabel("Interior", { exact: true }).uncheck();
    await dialog.getByLabel("Add-on Only", { exact: true }).uncheck();
    await dialog.getByRole("button", { name: "Convert to Job" }).click();
    await expect(dialog.getByText("Pick at least one work type.")).toBeVisible();
    await dialog.getByLabel("Interior", { exact: true }).check();
    await dialog.getByLabel("Add-on Only", { exact: true }).check();

    await dialog.getByRole("button", { name: "Convert to Job" }).click();
    await expect(page.getByText(/Converted to job BB-\d{4}-\d+\./).first()).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForURL(JOB_URL, { timeout: 60_000 });
    jobId = JOB_URL.exec(page.url())![1]!;
    const row = await lead(leadId);
    expect(row).toEqual({ status: "converted", converted_job_id: jobId });
    const { data: job } = await adminClient()
      .from("jobs")
      .select("stage, work_types, lead_id")
      .eq("id", jobId)
      .single();
    expect(job).toEqual({
      stage: "walkthrough_scheduled",
      work_types: ["interior", "add_on_only"],
      lead_id: leadId,
    });
  });

  test("a converted lead shows the banner and is read-only", async () => {
    const { data: job } = await adminClient()
      .from("jobs")
      .select("job_number")
      .eq("id", jobId)
      .single();
    await open(page, `/leads/${leadId}`);
    const banner = page.getByTestId("converted-banner");
    await expect(banner).toContainText(`This lead is now job ${job!.job_number}`);
    await expect(banner.getByRole("link", { name: "Open job" })).toHaveAttribute(
      "href",
      `/jobs/${jobId}`,
    );
    await expect(page.getByRole("button", { name: "Convert to Job" })).toHaveCount(0);
    for (const name of ["Edit lead", "Change status", "Book walkthrough"]) {
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await page.screenshot({ path: `${SCREENS}/lead-convert-banner.png` });
    expect(await seriousAxe(page)).toEqual([]);
    // aria-disabled buttons stay focusable and explain themselves when pressed.
    await page.getByRole("button", { name: "Edit lead" }).click({ force: true });
    await expect(page.getByRole("dialog", { name: "Edit lead" })).toHaveCount(0);
    await expect(
      page.getByText(`This lead is now job ${job!.job_number}. Make changes on the job.`).first(),
    ).toBeVisible();
  });

  test("booking a walkthrough converts the lead and opens the new job", async () => {
    const auto = await adminClient()
      .from("company_settings")
      .select("auto_convert_on_walkthrough")
      .limit(1)
      .single();
    test.skip(
      auto.data?.auto_convert_on_walkthrough === false,
      "Company Settings → auto-convert is off",
    );
    const bookId = await seedLead({ last_name: `Book${t}` });
    await open(page, `/leads/${bookId}?book=1`);
    const dialog = page.getByRole("dialog", { name: "Book walkthrough" });
    await expect(dialog).toBeVisible();
    const date = formatInTimeZone(new Date(Date.now() + 10 * 86_400_000), TZ, "yyyy-MM-dd");
    await dialog.getByLabel("Date").fill(date);
    await dialog.getByLabel("Time (Pacific)").fill("10:30");
    await dialog.getByRole("button", { name: "Book walkthrough" }).click();
    await expect(
      page.getByText(/Walkthrough booked\. Job BB-\d{4}-\d+ created\./).first(),
    ).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForURL(JOB_URL, { timeout: 60_000 });
    const id = JOB_URL.exec(page.url())![1]!;
    expect(await lead(bookId)).toEqual({ status: "converted", converted_job_id: id });
  });
});

test.describe("Lead conversion permissions", () => {
  test("someone who can't edit the lead can't convert it", async ({ browser, isMobile }, info) => {
    test.skip(isMobile, "Desktop only");
    // The estimator can read leads they own; this one belongs to the owner.
    const id = await seedLead({ last_name: `Other${t}` });
    const use = info.project.use;
    const context = await browser.newContext({
      baseURL: use.baseURL,
      viewport: use.viewport,
      timezoneId: use.timezoneId,
      locale: use.locale,
    });
    const page = await context.newPage();
    await signIn(page, "bookkeeper", `/leads/${id}`);
    const res = await open(page, `/leads/${id}`);
    if (res?.status() === 404) {
      await context.close();
      test.skip(true, "Bookkeeper can't open this lead");
      return;
    }
    await expect(page.getByRole("button", { name: "Convert to Job" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await context.close();
  });
});
