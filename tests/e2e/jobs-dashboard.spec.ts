import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { TEST_USERS, adminClient, loginAs, type TestRole } from "./support/users";
import { deleteAccounts, deleteJobs } from "./support/cleanup";

/**
 * Jobs Dashboard (/jobs), Phase 3. Seeds a few clearly fake jobs with the
 * service role (stages move only through apply_job_stage_change, as the owner
 * test user) and removes them afterwards. The local database is shared with
 * other specs, so expected totals are read from the database right before
 * comparing, and retried if someone else changes jobs meanwhile.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });

const SHOTS = join(process.cwd(), "docs", "screens", "phase-3");
mkdirSync(SHOTS, { recursive: true });

const T = `JDash${Math.random().toString(36).slice(2, 7)}`;
const jobIds: string[] = [];
const accountIds: string[] = [];

type Ids = Record<TestRole, string>;
let users: Ids;
let orgId: string;

async function profileIds(): Promise<Ids> {
  const { data } = await adminClient()
    .from("profiles")
    .select("id, email")
    .in(
      "email",
      Object.values(TEST_USERS).map((u) => u.email),
    );
  const out = {} as Ids;
  for (const [role, u] of Object.entries(TEST_USERS) as [TestRole, { email: string }][]) {
    out[role] = (data ?? []).find((p: { email: string }) => p.email === u.email)!.id;
  }
  return out;
}

/** Service-role client that records the owner as the actor (stage overrides need one). */
function actorClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-bb-actor-id": users.owner } },
    },
  );
}

async function moveStage(jobId: string, from: string, to: string, lostReason?: string) {
  const { error } = await actorClient().rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: from,
    p_to: to,
    p_override: true,
    p_reason: "E2E setup: seed a sample job stage",
    p_lost_reason: lostReason ?? null,
  });
  if (error) throw error;
}

async function seedJob(job: {
  name: string;
  workTypes: string[];
  ownerId?: string;
  pocId?: string;
  cents: number;
  path: string[];
  lostReason?: string;
}) {
  const db = adminClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      account_id: accountIds[0],
      name: job.name,
      work_types: job.workTypes,
      owner_id: job.ownerId ?? null,
      point_of_contact_id: job.pocId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  const fin = await db
    .from("job_financials")
    .upsert({ job_id: data.id, org_id: orgId, contract_baseline_cents: job.cents });
  if (fin.error) throw fin.error;
  let from = "walkthrough_scheduled";
  for (const to of job.path) {
    await moveStage(data.id, from, to, to === "closed_lost" ? job.lostReason : undefined);
    from = to;
  }
  return data.id as string;
}

/**
 * Signs in fresh as `role` (the shared session can be signed out by other
 * specs) and opens `path`. Login writes lock files under tests/e2e/.auth, which
 * makes the dev server rebuild; a render during that rebuild can fail, so the
 * page is reloaded until its H1 shows.
 */
async function open(page: Page, path: string, role: TestRole, h1 = "Jobs Dashboard") {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.context().clearCookies();
      await loginAs(page, role, path);
      await page.waitForTimeout(1500);
      for (let load = 0; load < 3; load++) {
        await page.goto(path);
        const at = new URL(page.url()).pathname;
        if (at.startsWith("/login") || at === "/mfa") break;
        const heading = page.getByRole("heading", { level: 1, name: h1 });
        const shown = await heading.waitFor({ timeout: 20_000 }).then(
          () => true,
          () => false,
        );
        if (shown) return;
      }
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await page.waitForTimeout(1500 * attempt);
  }
  throw new Error(`Could not open ${path} as ${role}`);
}

/** First visits compile the route in dev; reload once if that broke the client. */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  const crashed = page.getByRole("heading", { name: /Application error/ });
  if (await crashed.isVisible().catch(() => false)) await page.reload();
  await page.locator('[data-list-ready="true"]').waitFor({ timeout: 30_000 });
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));

/** What the owner (scope: all) should see right now, straight from the database. */
async function ownerTruth() {
  const db = adminClient();
  const base = () =>
    db.from("jobs").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const [open, inProgress, { data: fin }] = await Promise.all([
    base().not("stage", "in", "(closed_won,closed_lost)"),
    base().eq("stage", "in_progress"),
    db
      .from("job_financials")
      .select("contract_baseline_cents, jobs!inner(stage, deleted_at)")
      .is("jobs.deleted_at", null)
      .not("jobs.stage", "in", "(closed_won,closed_lost)"),
  ]);
  const pipeline = (fin ?? []).reduce(
    (n: number, r: { contract_baseline_cents: number | null }) =>
      n + (r.contract_baseline_cents ?? 0),
    0,
  );
  return { open: open.count ?? 0, inProgress: inProgress.count ?? 0, pipeline };
}

/** The big number on a KPI card (without its delta pill). */
async function kpiNumber(page: Page, label: string): Promise<string> {
  const card = page.getByRole("region", { name: "Job totals" }).getByRole("link", {
    name: new RegExp(`^${label}`),
  });
  // The number is the first text node; the delta pill follows it.
  return card
    .locator("p")
    .nth(1)
    .evaluate((el) => (el.childNodes[0]?.textContent ?? "").trim());
}

test.beforeAll(async () => {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  orgId = org!.id;
  users = await profileIds();
  const { data: acct, error } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `Sample Household ${T}` })
    .select("id")
    .single();
  if (error) throw error;
  accountIds.push(acct.id);
  await seedJob({
    name: `Sample Exterior ${T}`,
    workTypes: ["exterior"],
    ownerId: users.owner,
    cents: 1_200_000,
    path: ["sold"],
  });
  await seedJob({
    name: `Sample Interior ${T}`,
    workTypes: ["interior"],
    ownerId: users.estimator,
    cents: 800_000,
    path: [],
  });
  await seedJob({
    name: `Sample Cabinets ${T}`,
    workTypes: ["cabinets"],
    pocId: users.painter,
    cents: 500_000,
    path: ["in_progress"],
  });
  await seedJob({
    name: `Sample Deck ${T}`,
    workTypes: ["deck_fence"],
    cents: 300_000,
    path: ["sold", "closed_won"],
  });
});

test.afterAll(async () => {
  await deleteJobs(jobIds);
  await deleteAccounts(accountIds);
});

test.describe("Jobs Dashboard", () => {
  test("owner sees server-side KPIs, money and drill-downs", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop checks; mobile layout is checked below");
    await open(page, "/jobs", "owner");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs Dashboard" })).toBeVisible();

    await expect(async () => {
      const truth = await ownerTruth();
      await page.reload();
      expect(await kpiNumber(page, "Open Jobs")).toBe(truth.open.toLocaleString("en-US"));
      expect(await kpiNumber(page, "In Progress")).toBe(truth.inProgress.toLocaleString("en-US"));
      expect(await kpiNumber(page, "Total Pipeline Value")).toBe(money(truth.pipeline));
    }).toPass({ timeout: 60_000 });

    // Formula captions and a prior-period delta.
    const kpis = page.getByRole("region", { name: "Job totals" });
    await expect(kpis.getByText(/open jobs × \$[\d,]+ avg · right now/)).toBeVisible();
    await expect(kpis.getByText("Closed won this month · vs last month")).toBeVisible();
    await expect(kpis.getByText(/(from|change from) last month/).first()).toBeAttached();

    // Revenue & Performance shows money and a chart for this month.
    const revenue = page.getByRole("region", { name: "Revenue & Performance" });
    await expect(revenue.getByText("Total Revenue")).toBeVisible();
    await expect(revenue.getByText("Avg Job Size")).toBeVisible();
    await expect(revenue.getByText("Win Rate")).toBeVisible();
    await expect(revenue.getByText("Closing This Month")).toBeVisible();
    await expect(revenue.getByRole("img", { name: /Sold value per day this month/ })).toBeVisible();

    // View data on the Pipeline Snapshot lists every stage and a total.
    await page.getByRole("button", { name: "View data: Pipeline Snapshot" }).click();
    const dialog = page.getByRole("dialog", { name: "Pipeline Snapshot" });
    await expect(dialog.getByRole("link", { name: "Ready to Schedule" })).toBeVisible();
    await expect(dialog.getByRole("rowheader", { name: "Total" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Period select changes the URL and the captions.
    await page.getByLabel("Period").selectOption("ytd");
    await expect(page).toHaveURL(/period=ytd/);
    await expect(kpis.getByText("Closed won this year · vs last year")).toBeVisible();

    // KPI drill-down into the filtered Job List.
    await kpis.getByRole("link", { name: /^In Progress/ }).click();
    await expect(page).toHaveURL(/\/jobs\/list\?chips=in_progress/);
    await settle(page);
    await expect(page.getByRole("button", { name: /^In Progress/, pressed: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Sample Cabinets ${T}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Sample Exterior ${T}` })).toHaveCount(0);
  });

  test("estimator sees counts, never money", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop checks");
    await open(page, "/jobs", "estimator");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs Dashboard" })).toBeVisible();
    expect(await kpiNumber(page, "Total Pipeline Value")).toBe("—");
    await expect(page.getByText(/amounts hidden for your role/).first()).toBeVisible();
    const main = page.locator("main");
    await expect(main).not.toContainText("$");
    await expect(main.getByText("Jobs Sold", { exact: true })).toBeVisible();
    await expect(main.getByText("Avg Job Size")).toHaveCount(0);
    // Their own job shows; a job they aren't on doesn't.
    await expect(main.getByRole("link", { name: `Sample Interior ${T}` })).toBeVisible();
    await expect(main.getByRole("link", { name: `Sample Exterior ${T}` })).toHaveCount(0);
  });

  test("painter sees only the jobs they're on, without money", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop checks");
    await open(page, "/jobs", "painter");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs Dashboard" })).toBeVisible();
    const main = page.locator("main");
    await expect(main).not.toContainText("$");
    await expect(main.getByRole("link", { name: `Sample Cabinets ${T}` })).toBeVisible();
    await expect(main.getByRole("link", { name: `Sample Exterior ${T}` })).toHaveCount(0);
  });

  test("no sideways scroll on a phone and no serious axe issues", async ({ page }) => {
    await open(page, "/jobs", "owner");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs Dashboard" })).toBeVisible();
    // Axe at the project's own size, then the layout at 390px (SPEC: phone width).
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await noSideScroll(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "View data: Pipeline Health" }).click();
    await expect(page.getByRole("dialog", { name: "Pipeline Health" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
  });

  test("screenshot", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop screenshot only");
    await open(page, "/jobs", "owner");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(SHOTS, "jobs-dashboard.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
});
