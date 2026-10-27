import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { TEST_USERS, adminClient, loginAs, type TestRole } from "./support/users";
import { deleteAccounts, deleteJobs } from "./support/cleanup";

/**
 * Job List (/jobs/list), Phase 3, on the shared list framework: tabs and
 * stage chips with counts, list/card toggle (layout=cards), Stage / Work type
 * selects, Advanced filter, preview, saved view, bulk assign, and who sees
 * what (money only with financials:read; painters only their own jobs).
 * Seeds clearly fake jobs with the service role and removes them afterwards.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });

const SHOTS = join(process.cwd(), "docs", "screens", "phase-3");
mkdirSync(SHOTS, { recursive: true });

const T = `JList${Math.random().toString(36).slice(2, 7)}`;
const jobIds: string[] = [];
const accountIds: string[] = [];
const viewNames: string[] = [];

type Ids = Record<TestRole, string>;
let users: Ids;
let orgId: string;
const N = {
  exterior: `Sample Exterior ${T}`,
  interior: `Sample Interior ${T}`,
  cabinets: `Sample Cabinets ${T}`,
  deck: `Sample Deck ${T}`,
  fence: `Sample Fence ${T}`,
};
const ids: Record<keyof typeof N, string> = {
  exterior: "",
  interior: "",
  cabinets: "",
  deck: "",
  fence: "",
};

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
  hold?: string;
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
      promised_start_date: "2026-11-16",
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
    await moveStage(data.id, from, to, to === "closed_lost" ? "price" : undefined);
    from = to;
  }
  if (job.hold) {
    const h = await db.from("job_holds").insert({
      org_id: orgId,
      job_id: data.id,
      hold_type: job.hold,
      reason: "Waiting on the HOA board (sample)",
      blocks_scheduling: true,
    });
    if (h.error) throw h.error;
  }
  return data.id as string;
}

/**
 * Signs in fresh as `role` and opens `path`. Login writes lock files under
 * tests/e2e/.auth, which makes the dev server rebuild; a render during that
 * rebuild can fail, so the page is reloaded until the list is interactive.
 */
async function open(page: Page, path: string, role: TestRole) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.context().clearCookies();
      await loginAs(page, role, path);
      await page.waitForTimeout(1500);
      for (let load = 0; load < 3; load++) {
        await page.goto(path);
        const at = new URL(page.url()).pathname;
        if (at.startsWith("/login") || at === "/mfa") break;
        const ready = await page
          .locator('[data-list-ready="true"]')
          .waitFor({ timeout: 20_000 })
          .then(
            () => true,
            () => false,
          );
        if (ready) return;
      }
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await page.waitForTimeout(1500 * attempt);
  }
  throw new Error(`Could not open ${path} as ${role}`);
}

async function ready(page: Page) {
  await page.locator('[data-list-ready="true"]').waitFor();
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

/** Count the owner (scope: all) should see, straight from the database. */
async function ownerCount(filter: { stage?: string; open?: boolean; onHold?: boolean }) {
  let q = adminClient()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (filter.stage) q = q.eq("stage", filter.stage);
  if (filter.open) q = q.not("stage", "in", "(closed_won,closed_lost)");
  if (filter.onHold) q = q.eq("status", "on_hold");
  const { count } = await q;
  return count ?? 0;
}

/** The number in a tab or chip button ("Sold 3" → 3). */
async function badgeCount(page: Page, name: RegExp): Promise<number> {
  const text = (await page.getByRole("button", { name }).first().textContent()) ?? "";
  return Number(text.replace(/[^\d]/g, "")) || 0;
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
  ids.exterior = await seedJob({
    name: N.exterior,
    workTypes: ["exterior"],
    ownerId: users.owner,
    cents: 1_234_500,
    path: ["sold"],
  });
  ids.interior = await seedJob({
    name: N.interior,
    workTypes: ["interior"],
    ownerId: users.estimator,
    cents: 800_000,
    path: [],
    hold: "hoa",
  });
  ids.cabinets = await seedJob({
    name: N.cabinets,
    workTypes: ["cabinets"],
    pocId: users.painter,
    cents: 500_000,
    path: ["in_progress"],
  });
  ids.deck = await seedJob({
    name: N.deck,
    workTypes: ["deck_fence"],
    cents: 300_000,
    path: ["sold", "closed_won"],
  });
  ids.fence = await seedJob({
    name: N.fence,
    workTypes: ["deck_fence", "exterior"],
    cents: 200_000,
    path: ["closed_lost"],
  });
});

test.afterAll(async () => {
  if (viewNames.length) await adminClient().from("saved_views").delete().in("name", viewNames);
  await deleteJobs(jobIds);
  await deleteAccounts(accountIds);
});

test.describe("Job List", () => {
  test("tabs, stage chips with counts, search and preview", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?q=${T}`, "owner");
    await expect(page.getByRole("heading", { level: 1, name: "Job List" })).toBeVisible();
    const table = page.getByRole("table");

    // Active hides closed jobs.
    for (const n of [N.exterior, N.interior, N.cabinets])
      await expect(table.getByRole("link", { name: n })).toBeVisible();
    await expect(table.getByRole("link", { name: N.deck })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Closed Won/ })).toHaveCount(0);

    // Status and hold pills sit with the name; money shows for the owner.
    await expect(table.getByText("HOA Hold")).toBeVisible();
    await expect(table.getByText("$12,345.00")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Amount" })).toBeVisible();

    // Live counts match the database (others may add jobs meanwhile, so retry).
    await expect(async () => {
      const [active, sold, onHold] = await Promise.all([
        ownerCount({ open: true }),
        ownerCount({ stage: "sold" }),
        ownerCount({ onHold: true }),
      ]);
      await page.reload();
      await ready(page);
      expect(await badgeCount(page, /^Active/)).toBe(active);
      expect(await badgeCount(page, /^Sold\b/)).toBe(sold);
      expect(await badgeCount(page, /^On hold/)).toBe(onHold);
    }).toPass({ timeout: 60_000 });

    // All shows closed jobs and their chips.
    await page.getByRole("button", { name: /^All\b/ }).click();
    await expect(page).toHaveURL(/tab=all/);
    await expect(table.getByRole("link", { name: N.deck })).toBeVisible();
    await expect(table.getByText("Won", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Closed Lost/, pressed: false }).click();
    await expect(page).toHaveURL(/chips=closed_lost/);
    await expect(table.getByRole("link", { name: N.fence })).toBeVisible();
    await expect(table.getByRole("link", { name: N.deck })).toHaveCount(0);
    // Stage chips are either/or.
    await page.getByRole("button", { name: /^Closed Won/, pressed: false }).click();
    await expect(page).toHaveURL(/chips=closed_won(&|$)/);
    await expect(table.getByRole("link", { name: N.deck })).toBeVisible();
    await page.getByRole("button", { name: /^Closed Won/, pressed: true }).click();
    await expect(page).not.toHaveURL(/chips=/);

    // On hold chip.
    await page.getByRole("button", { name: /^On hold/, pressed: false }).click();
    await expect(table.getByRole("link", { name: N.interior })).toBeVisible();
    await expect(table.getByRole("link", { name: N.exterior })).toHaveCount(0);
    await page.getByRole("button", { name: /^On hold/, pressed: true }).click();
    await expect(page).not.toHaveURL(/chips=/);

    // My Jobs: the owner owns the exterior job only.
    await page.getByRole("button", { name: /^My Jobs/ }).click();
    await expect(table.getByRole("link", { name: N.exterior })).toBeVisible();
    await expect(table.getByRole("link", { name: N.cabinets })).toHaveCount(0);

    // Quick preview.
    await page.getByRole("button", { name: /^Active/ }).click();
    await page.getByRole("button", { name: new RegExp(`^Preview .*${N.interior}`) }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(N.interior) });
    await expect(drawer.getByRole("link", { name: "Open job" })).toBeVisible();
    await expect(drawer.getByText("Waiting on the HOA board (sample)")).toBeVisible();
    await expect(drawer.getByText("$8,000.00")).toBeVisible();
    await expect(drawer.getByText(`Sample Household ${T}`)).toBeVisible();
  });

  test("list/card toggle keeps the layout in the URL", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?q=${T}`, "owner");
    await page.getByRole("button", { name: "Cards", exact: true, pressed: false }).click();
    await expect(page).toHaveURL(/layout=cards/);
    const card = page.getByRole("article", { name: new RegExp(N.exterior) });
    await expect(card).toBeVisible();
    await expect(card.getByText("$12,345.00")).toBeVisible();
    await expect(card.getByText("Start Nov 16, 2026")).toBeVisible();
    await expect(card.getByText("Exterior", { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    // Filters keep the card layout.
    await page.getByRole("button", { name: /^Sold\b/, pressed: false }).click();
    await expect(page).toHaveURL(/chips=sold/);
    await expect(page).toHaveURL(/layout=cards/);
    await expect(page.getByRole("article", { name: new RegExp(N.cabinets) })).toHaveCount(0);
    await expect(card).toBeVisible();
    // Preview works from a card too.
    await page.getByRole("button", { name: new RegExp(`^Preview .*${N.exterior}`) }).click();
    await expect(
      page.getByRole("dialog", { name: new RegExp(N.exterior) }).getByRole("link", {
        name: "Open job",
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "List", exact: true, pressed: false }).click();
    await expect(page).not.toHaveURL(/layout=cards/);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("Stage and Work type selects, Advanced filter by stage, saved view", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?tab=all&q=${T}`, "owner");
    const table = page.getByRole("table");

    await page.getByRole("combobox", { name: "Work type" }).selectOption({ label: "Exterior" });
    await expect(page).toHaveURL(/[?&]f=/);
    await expect(table.getByRole("link", { name: N.exterior })).toBeVisible();
    await expect(table.getByRole("link", { name: N.fence })).toBeVisible();
    await expect(table.getByRole("link", { name: N.interior })).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Work type" })
      .selectOption({ label: "All work types" });

    await page.getByRole("combobox", { name: "Stage" }).selectOption({ label: "Closed Lost" });
    await expect(table.getByRole("link", { name: N.fence })).toBeVisible();
    await expect(table.getByRole("link", { name: N.exterior })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Stage" }).selectOption({ label: "All stages" });
    await expect(table.getByRole("link", { name: N.exterior })).toBeVisible();

    await page.getByRole("button", { name: "Advanced" }).click();
    const dialog = page.getByRole("dialog", { name: "Advanced filter" });
    await dialog.getByRole("combobox", { name: "Rule 1 field" }).selectOption({ label: "Stage" });
    await dialog
      .getByRole("combobox", { name: "Rule 1 value" })
      .selectOption({ label: "In Progress" });
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(table.getByRole("link", { name: N.cabinets })).toBeVisible();
    await expect(table.getByRole("link", { name: N.exterior })).toHaveCount(0);

    // Save it as a view (module "jobs"), clear, and bring it back.
    const viewName = `E2E jobs view ${T}`;
    viewNames.push(viewName);
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    await page.getByLabel("Name").fill(viewName);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page).toHaveURL(/view=/);
    await page.goto("/jobs/list");
    await ready(page);
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: viewName }).click();
    await expect(page).toHaveURL(/view=/);
    await expect(table.getByRole("link", { name: N.cabinets })).toBeVisible();
    await expect(table.getByRole("link", { name: N.exterior })).toHaveCount(0);
  });

  test("office manager assigns owners in bulk; there is no bulk stage change", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?tab=all&q=${T}`, "office_manager");
    await page.getByRole("checkbox", { name: new RegExp(`Select .*${N.deck}`) }).check();
    await page.getByRole("checkbox", { name: new RegExp(`Select .*${N.fence}`) }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByText("2 selected")).toBeVisible();
    // Exports run from the list's Export CSV (current filter); the bar has none.
    await expect(bar.getByRole("button", { name: "Export" })).toHaveCount(0);
    await expect(bar.getByRole("combobox", { name: /status|stage/i })).toHaveCount(0);
    await bar.getByRole("button", { name: "Assign owner" }).click();
    await page
      .getByLabel(/Make this person the owner of 2 jobs/)
      .selectOption({ label: TEST_USERS.office_manager.fullName });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Assigned 2 jobs.")).toBeVisible();
    await expect(async () => {
      const { data } = await adminClient()
        .from("jobs")
        .select("owner_id")
        .in("id", [ids.deck, ids.fence]);
      expect((data ?? []).map((r: { owner_id: string }) => r.owner_id)).toEqual([
        users.office_manager,
        users.office_manager,
      ]);
    }).toPass({ timeout: 15_000 });
  });

  test("estimator sees only their jobs and never money", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?tab=all&q=${T}`, "estimator");
    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: N.interior })).toBeVisible();
    await expect(table.getByRole("link", { name: N.exterior })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("$");
    // No assign permission, so no selection.
    await expect(page.getByRole("checkbox", { name: /^Select/ })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(`^Preview .*${N.interior}`) }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(N.interior) });
    await expect(drawer.getByRole("link", { name: "Open job" })).toBeVisible();
    await expect(drawer).not.toContainText("$");
    await expect(drawer.getByText("Amount")).toHaveCount(0);
  });

  test("painter opens the list and sees only the job they're on", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop list interactions");
    await open(page, `/jobs/list?tab=all&q=${T}`, "painter");
    const table = page.getByRole("table");
    await expect(table.getByRole("link", { name: N.cabinets })).toBeVisible();
    for (const n of [N.exterior, N.interior, N.deck, N.fence])
      await expect(table.getByRole("link", { name: n })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("$");
    // "My Jobs" includes jobs where they're the point of contact.
    await page.getByRole("button", { name: /^My Jobs/ }).click();
    await expect(table.getByRole("link", { name: N.cabinets })).toBeVisible();
  });

  test("no sideways scroll on a phone and no serious axe issues", async ({ page }) => {
    await open(page, `/jobs/list?q=${T}`, "owner");
    // Axe at the project's own size, then the layout at 390px (SPEC: phone width).
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await noSideScroll(page);
    expect(await seriousViolations(page)).toEqual([]);
    await page.goto(`/jobs/list?q=${T}&layout=cards`);
    await ready(page);
    await expect(page.getByRole("article").first()).toBeVisible();
    await noSideScroll(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("screenshots", async ({ page, isMobile }) => {
    await open(page, "/jobs/list?tab=all", "owner");
    await page.evaluate(() => document.fonts.ready);
    if (isMobile) {
      await page.goto("/jobs/list?layout=cards");
      await ready(page);
      await page.screenshot({ path: join(SHOTS, "jobs-list-mobile.png"), fullPage: true });
      return;
    }
    await page.screenshot({ path: join(SHOTS, "jobs-list.png"), fullPage: true });
    await page.goto("/jobs/list?tab=all&layout=cards");
    await ready(page);
    await page.screenshot({ path: join(SHOTS, "jobs-list-cards.png"), fullPage: true });
  });
});
