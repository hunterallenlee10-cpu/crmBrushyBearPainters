import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { deleteLeadsAndJobs } from "./support/cleanup";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * Phase 9 — Analytics & home (SPEC §8.2, §8.3, §8.14, §8.15, §12), on the local
 * stack:
 *  - Home: Executive Overview (owner) with both KPI rows and every widget;
 *    My Day for other roles; the per-user default home
 *  - Every chart on every dashboard (Executive Overview, the six prebuilt
 *    dashboards, Lead and Jobs dashboards) has "View data" and "Download CSV";
 *    a download is logged in export_log; roles without data:export can't
 *  - Ask Brushy Bear: an example prompt answers with cited metric ids; an
 *    unmapped question says so; roles without analytics can't open it
 *  - Daily Brief, report templates, the report builder, Export CSV, a
 *    scheduled delivery run by the worker into the outbox (simulated)
 *  - Custom dashboard, My Numbers, Admin → Marketing Spend and Revenue Goals
 * Test rows are tagged and removed afterwards.
 */

const SCREENS = "docs/screens/phase-9";
mkdirSync(SCREENS, { recursive: true });
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const t = randomUUID().slice(0, 6);

test.describe.configure({ mode: "serial", timeout: 240_000 });

let orgId = "";
let ownerId = "";
let leadId = "";
let reportId = "";
let dashboardId = "";
const monthStart = (() => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .split("-");
  return `${y}-${m}-01`;
})();

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `${SCREENS}/${name}${isPhone(page) ? "-mobile" : ""}.png`,
    fullPage: true,
  });

async function axe(page: Page) {
  // Not mid-hover: a button just clicked is still animating its hover colour.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
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

/** Opens a path as the owner, signing in again if another spec ended the shared session. */
async function open(page: Page, path: string) {
  await page.goto(path);
  if (/\/(login|mfa)/.test(new URL(page.url()).pathname)) {
    await page.context().clearCookies();
    await loginAs(page, "owner", path);
    await page.goto(path);
  }
}

/** Every chart card ([data-chart]) has View data, and its dialog has Download CSV. */
async function everyChartHasViewDataAndCsv(page: Page, expectEnabled: boolean) {
  const cards = page.locator("section:has([data-chart])");
  const n = await cards.count();
  expect(n, "the page has charts").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const button = card.getByRole("button", { name: /^View data/ });
    await expect(button, `chart ${i + 1} has View data`).toBeVisible();
    await button.click();
    const dialog = page.getByRole("dialog");
    const csv = dialog.getByRole("button", { name: "Download CSV" });
    await expect(csv).toBeVisible();
    if (expectEnabled) await expect(csv).toBeEnabled();
    else await expect(csv).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  return n;
}

test.beforeAll(async () => {
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
  const { data: lead } = await db
    .from("leads")
    .insert({
      org_id: orgId,
      first_name: "Ana",
      last_name: `Lytics${t}`,
      email: `ana-${t}@example.test`,
      zip: "98004",
      services: ["exterior"],
      lead_source: "website",
      owner_id: ownerId,
    })
    .select("id")
    .single();
  leadId = lead!.id;
});

test.afterAll(async () => {
  const db = adminClient();
  if (reportId) {
    await db.from("integration_outbox").delete().eq("related_type", "report_schedule");
    await db.from("report_schedules").delete().eq("report_id", reportId);
    await db.from("reports").delete().eq("id", reportId);
  }
  if (dashboardId) await db.from("dashboards").delete().eq("id", dashboardId);
  await db.from("analytics_favorites").delete().eq("user_id", ownerId);
  await db
    .from("marketing_spend")
    .delete()
    .eq("org_id", orgId)
    .eq("month", monthStart)
    .eq("lead_source", "nextdoor");
  if (leadId) await deleteLeadsAndJobs([leadId]);
});

test("Executive Overview: both KPI rows, every widget, View data + CSV, logged export", async ({
  page,
}) => {
  await open(page, "/?view=executive");
  await expect(page.getByRole("heading", { level: 1, name: "Executive Overview" })).toBeVisible();
  await expect(
    page.getByText(
      "Company-wide performance. Every metric is aggregated server-side across all records.",
    ),
  ).toBeVisible();
  for (const label of [
    "Open Pipeline Value",
    "Projected Revenue",
    "Estimates Sent",
    "Close Rate",
    "Avg Job Value",
    "Sales Velocity",
    "Speed to Lead",
    "24h Estimate SLA",
    "Daily Update Compliance",
    "On-Time Start",
    "Gross Margin % (completed)",
    "AR Outstanding",
  ]) {
    await expect(
      page.locator("[data-metric]").getByText(label, { exact: true }).first(),
    ).toBeVisible();
  }
  for (const title of [
    "Pipeline by Stage",
    "Revenue Forecast",
    "Lead Funnel",
    "Exterior Season Backlog",
    "City Performance",
    "Estimator Leaderboard",
    "Lead Source Performance",
    "Lead Source Mix",
    "Executive Alerts",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await expect(page.locator("body")).not.toContainText("NaN");
  expect(await everyChartHasViewDataAndCsv(page, true)).toBe(9);

  // Filters live in the URL.
  if (!isPhone(page)) {
    await page.getByLabel("Date range").selectOption("ytd");
    await expect(page).toHaveURL(/period=ytd/);
    await page.getByLabel("Work type").selectOption("exterior");
    await expect(page).toHaveURL(/work_type=exterior/);
  }

  // A download is logged.
  const db = adminClient();
  const before =
    (
      await db
        .from("export_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ownerId)
    ).count ?? 0;
  await page
    .locator("section:has([data-chart='kpi.lead_funnel'])")
    .getByRole("button", { name: /^View data/ })
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("dialog").getByRole("button", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^lead-funnel-\d{4}-\d{2}-\d{2}\.csv$/);
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () =>
        (
          await db
            .from("export_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", ownerId)
        ).count ?? 0,
    )
    .toBe(before + 1);
  const { data: last } = await db
    .from("export_log")
    .select("dataset, kind")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(last).toMatchObject({ dataset: "kpi.lead_funnel", kind: "chart" });

  await noSideScroll(page);
  await axe(page);
  await open(page, "/?view=executive");
  await shot(page, "executive-overview");
});

test("every prebuilt dashboard and the Lead / Jobs dashboards: each chart has View data + CSV", async ({
  page,
}) => {
  for (const key of ["executive", "sales", "production", "marketing", "ar", "seasonality"]) {
    await open(page, `/analytics/dashboards/${key}`);
    await expect(page.locator(`[data-dashboard="${key}"]`)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("NaN");
    await everyChartHasViewDataAndCsv(page, true);
    if (key === "marketing" || key === "seasonality") await shot(page, `dashboard-${key}`);
  }
  // Earlier dashboards' charts get the same CSV through the shared dialog.
  for (const [path, title, empty] of [
    ["/leads", "Lead Dashboard", "No leads yet"],
    ["/jobs", "Jobs Dashboard", "No jobs yet"],
  ] as const) {
    await open(page, path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const buttons = page.getByRole("button", { name: /^View data/ });
    // A company with no records shows the empty state instead of charts.
    await expect(buttons.first().or(page.getByRole("heading", { name: empty }))).toBeVisible();
    if ((await buttons.count()) === 0) continue;
    await buttons.first().click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Download CSV" }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
  }
  await open(page, "/analytics/dashboards");
  await axe(page);
  await shot(page, "dashboards");
});

test("Ask Brushy Bear answers from the registry; Daily Brief; On Pace", async ({ page }) => {
  await open(page, "/analytics");
  await page.getByRole("button", { name: "How are sales this month?" }).click();
  const answer = page.getByTestId("ask-answer");
  await expect(answer).toContainText("Revenue sold");
  await expect(page.getByTestId("ask-citations")).toContainText("kpi.revenue_sold");
  await expect(page.getByTestId("ask-citations")).toContainText(
    "Figures are computed, not written.",
  );
  await page.getByLabel("Your question").fill("What is the weather on Mars?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(answer).toContainText("can't answer that");
  await page.getByRole("button", { name: "Which jobs are ready to schedule?" }).click();
  await expect(page.getByTestId("ask-citations")).toContainText("production.ready");

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("daily-brief")).toContainText("Needs attention now");
  await expect(page.getByTestId("on-pace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My Business – This Month" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("NaN");
  await axe(page);
  await shot(page, "analytics-overview");
});

test("report template, builder, Export CSV and a scheduled delivery through the outbox", async ({
  page,
}) => {
  test.skip(isPhone(page), "builder covered on desktop");
  await open(page, "/analytics/reports?tab=templates");
  for (const name of [
    "Sold by month",
    "Leads by source",
    "Estimates sent vs accepted",
    "A/R aging",
    "Jobs missing daily logs",
    "Sold – no deposit",
    "Gross margin by job",
    "Speed to lead",
    "24h SLA misses",
    "On-time start misses",
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await shot(page, "reports");
  await page.getByRole("link", { name: "Leads by source", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Leads by source" })).toBeVisible();
  await expect(page.getByText(/matching rows? · summarized on the server/)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("report-csv").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leads-by-source-.*\.csv$/);

  // Build a report from a new one: leads grouped by status, saved as mine.
  await open(page, "/analytics/reports/new?module=leads");
  await page.getByLabel("Group by").selectOption("status");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page).toHaveURL(/c=/);
  await expect(page.getByRole("heading", { name: "By status" })).toBeVisible();
  await page.getByLabel("Report name").fill(`E2E leads ${t}`);
  await page.getByRole("button", { name: "Save as my report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `E2E leads ${t}` })).toBeVisible();
  reportId = page.url().split("/").pop()!.split("?")[0]!;
  await axe(page);
  await shot(page, "report-builder");

  // Schedule it, then let the worker deliver it now.
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedules" })).toBeVisible();
  await page.getByLabel("How often").selectOption("daily");
  await page
    .getByRole("form", { name: "New scheduled delivery" })
    .getByRole("button", { name: "Schedule", exact: true })
    .click();
  await expect(page.getByTestId("schedule-row")).toContainText(`E2E leads ${t}`);
  const db = adminClient();
  await db
    .from("report_schedules")
    .update({ next_run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("report_id", reportId);
  const res = await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(res.status).toBe(200);
  const { data: sched } = await db
    .from("report_schedules")
    .select("id, last_status, next_run_at")
    .eq("report_id", reportId)
    .single();
  expect(sched!.last_status).toBe("sent");
  expect(new Date(sched!.next_run_at).getTime()).toBeGreaterThan(Date.now());
  const { data: outbox } = await db
    .from("integration_outbox")
    .select("status, subject, domain")
    .eq("related_type", "report_schedule")
    .eq("related_id", sched!.id);
  expect(outbox!.length).toBe(1);
  expect(outbox![0]).toMatchObject({
    status: "simulated",
    domain: "email",
    subject: `Scheduled report: E2E leads ${t}`,
  });
  // Running the worker again doesn't deliver twice.
  await fetch(`${BASE}/api/cron/worker`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const { count } = await db
    .from("integration_outbox")
    .select("id", { count: "exact", head: true })
    .eq("related_type", "report_schedule")
    .eq("related_id", sched!.id);
  expect(count).toBe(1);
  await open(page, "/analytics/schedules");
  await expect(page.getByTestId("schedule-row")).toContainText("sent");
  await axe(page);
  await shot(page, "schedules");
});

test("custom dashboard: pick widgets, save, view, delete", async ({ page }) => {
  test.skip(isPhone(page), "desktop flow");
  await open(page, "/analytics/dashboards/new");
  await page.getByLabel("Name").fill(`E2E dash ${t}`);
  await page.getByRole("checkbox", { name: /^Leads created/ }).check();
  await page.getByRole("checkbox", { name: /^Lead Funnel/ }).check();
  await page.getByRole("button", { name: /Save dashboard/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: `E2E dash ${t}` })).toBeVisible();
  dashboardId = page.url().split("/").pop()!.split("?")[0]!;
  await expect(page.locator("[data-metric='kpi.leads_created']")).toBeVisible();
  await everyChartHasViewDataAndCsv(page, true);
  await page.getByRole("button", { name: `Add E2E dash ${t} to favorites` }).click();
  await open(page, "/analytics/dashboards");
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await open(page, `/analytics/dashboards/${dashboardId}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/analytics\/dashboards$/);
  dashboardId = "";
});

test("My Numbers: each card on its own date field, records below, owners view a rep", async ({
  page,
}) => {
  await open(page, "/my-numbers");
  await expect(page.getByRole("heading", { level: 1, name: "My Numbers" })).toBeVisible();
  await expect(page.getByText(/Each card counts on its own date field/)).toBeVisible();
  await page.locator("[data-metric='mine.leads_issued']").click();
  await expect(page.getByRole("heading", { name: "Leads Issued" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Ana Lytics${t}` })).toBeVisible();
  await expect(page.getByLabel("View a rep…")).toBeVisible();
  await noSideScroll(page);
  await axe(page);
  await shot(page, "my-numbers");
});

test("Admin → Marketing Spend and Revenue Goals feed the overview", async ({ page }) => {
  test.skip(isPhone(page), "admin forms on desktop");
  await open(page, "/admin/marketing-spend");
  await page.getByLabel("Nextdoor").fill("123.45");
  await page.getByRole("button", { name: "Save spend" }).click();
  await expect(page.getByText("Spend saved.")).toBeVisible();
  const db = adminClient();
  const { data: row } = await db
    .from("marketing_spend")
    .select("amount_cents")
    .eq("org_id", orgId)
    .eq("month", monthStart)
    .eq("lead_source", "nextdoor")
    .single();
  expect(row!.amount_cents).toBe(12345);
  await axe(page);
  await shot(page, "admin-marketing-spend");
  await open(page, "/admin/revenue-goals");
  await expect(page.getByRole("heading", { level: 1, name: "Revenue Goals" })).toBeVisible();
  await axe(page);
  await shot(page, "admin-revenue-goals");
});

test("My Day for the estimator; no Analytics; CSV disabled without data:export", async ({
  browser,
}, info) => {
  const est = await signedIn(browser, info, "estimator", "/");
  await expect(
    est.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Eli/ }),
  ).toBeVisible();
  await expect(est.getByTestId("counts-line")).toContainText("appts today");
  await expect(est.getByTestId("ready-score")).toBeVisible();
  await noSideScroll(est);
  await axe(est);
  await shot(est, "my-day-estimator");
  const res = await est.goto("/analytics");
  expect(res?.status()).toBe(404);
  await est.context().close();

  const office = await signedIn(browser, info, "office_manager", "/leads");
  const viewData = office.getByRole("button", { name: /^View data/ }).first();
  await viewData.click();
  await expect(
    office.getByRole("dialog").getByRole("button", { name: "Download CSV" }),
  ).toBeDisabled();
  await office.context().close();
});

test("painter's home is My Day on the phone", async ({ browser }, info) => {
  test.skip(
    !isPhone(await (await browser.newContext({ viewport: info.project.use.viewport })).newPage()),
    "phone only",
  );
  const painter = await signedIn(browser, info, "painter", "/");
  await expect(
    painter.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Pat/ }),
  ).toBeVisible();
  await noSideScroll(painter);
  await axe(painter);
  await shot(painter, "my-day-painter");
  await painter.context().close();
});
