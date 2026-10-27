import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { TEST_USERS, adminClient, loginAs, type TestRole } from "./support/users";

/**
 * Lead Dashboard (/leads) and Admin → Lead Scoring (/admin/lead-scoring), Phase 2.
 * Seeds a handful of clearly fake leads with the service role and removes them
 * afterwards. Other specs add leads too, so totals are checked as "at least".
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const SHOTS = join(process.cwd(), "docs", "screens", "phase-2");
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const tag = `Dash${Math.random().toString(36).slice(2, 7)}`;
const seeded: string[] = [];

/** Signs in fresh when the shared session was ended by another spec (sign-out is global). */
async function open(page: Page, path: string, role: TestRole = "owner") {
  const res = await page.goto(path);
  const at = new URL(page.url()).pathname;
  if (role === "owner" && !at.startsWith("/login") && at !== "/mfa") return res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await page.context().clearCookies();
      await loginAs(page, role, path);
      const r = await page.goto(path);
      const now = new URL(page.url()).pathname;
      if (!now.startsWith("/login") && now !== "/mfa") return r;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await page.waitForTimeout(1500 * attempt);
  }
  throw new Error(`Could not sign in as ${role}`);
}

async function hydrated(page: Page) {
  await page.getByRole("region", { name: /Notifications/ }).waitFor({ state: "attached" });
}

async function expectNoHorizontalScroll(page: Page) {
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

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(SHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

test.beforeAll(async () => {
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
  const orgId = (org as { id: string } | null)?.id ?? null;
  const ownerId = (owner as { id: string } | null)?.id ?? null;
  if (!orgId || !ownerId) throw new Error("Run the Playwright setup project first.");
  const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const base = (i: number) => ({
    org_id: orgId,
    first_name: "Sample",
    last_name: `${tag} ${i}`,
    email: `${tag.toLowerCase()}-${i}@example.com`,
    mobile: `+1425555${String(100 + i).padStart(4, "0")}`,
    lead_source: "website",
    city: "Bellevue",
  });
  const rows: Record<string, string | number | null>[] = [
    {
      ...base(1),
      status: "new",
      owner_id: ownerId,
      temperature: "hot",
      grade: "A",
      score: 90,
    },
    { ...base(2), status: "contacted", first_contacted_at: days(0), lead_source: "nextdoor" },
    {
      ...base(3),
      status: "walkthrough_scheduled",
      walkthrough_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      owner_id: ownerId,
    },
    { ...base(4), status: "nurture", created_at: days(20), last_activity_at: days(20) },
    { ...base(5), status: "new", created_at: days(40), last_activity_at: days(40) },
  ];
  // One insert per row: a bulk insert would null out keys that only some rows set.
  for (const row of rows) {
    const { data, error } = await db.from("leads").insert(row).select("id").single();
    if (error) throw error;
    seeded.push((data as { id: string }).id);
  }
});

test.afterAll(async () => {
  if (seeded.length) await adminClient().from("leads").delete().in("id", seeded);
});

test.describe("Lead Dashboard", () => {
  test("owner sees KPIs and drills into the Lead List", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, "/leads");
    await expect(page.getByRole("heading", { level: 1, name: "Lead Dashboard" })).toBeVisible();
    await expect(
      page.getByText(/aggregated on the server across all leads you can see/),
    ).toBeVisible();

    const kpis = page.getByRole("region", { name: "Lead totals" });
    for (const label of ["Total Leads", "New", "Contacted", "Walkthrough Scheduled"]) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    const total = kpis.getByRole("link", { name: /Total Leads/ });
    const totalText = (await total.locator("p.text-2xl").textContent()) ?? "0";
    expect(Number(totalText.replace(/,/g, ""))).toBeGreaterThanOrEqual(seeded.length);
    await expect(total).toHaveAttribute("href", "/leads/list?tab=all");

    // Every widget is on the page.
    for (const name of [
      "Lead Status Distribution",
      "My Leads",
      "Recent Leads",
      "Conversion Funnel",
      "Top Lead Sources",
      "Leads by City",
      "Lead Aging",
      "Needs Attention",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Stale 14\+ Days/ })).toHaveAttribute(
      "href",
      "/leads/list?chips=stale",
    );
    await expect(page.getByRole("link", { name: /Hot Leads/ })).toHaveAttribute(
      "href",
      "/leads/list?chips=hot",
    );
    // My Leads lists the owner's seeded open leads.
    const mine = page.getByRole("region", { name: "My Leads" });
    await expect(mine.getByRole("link", { name: `Sample ${tag} 3` })).toBeVisible();

    await hydrated(page);
    await kpis.getByRole("link", { name: /Walkthrough Scheduled/ }).click();
    // The dev server may compile the list page on first visit.
    await expect(page).toHaveURL(/\/leads\/list\?tab=walkthrough_scheduled$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Lead List" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Sample ${tag} 3` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Sample ${tag} 2` })).toHaveCount(0);
  });

  test("View data shows the exact numbers and offers Download CSV", async ({ page }) => {
    await open(page, "/leads");
    await hydrated(page);
    await page.getByRole("button", { name: "View data: Lead Status Distribution" }).click();
    const dialog = page.getByRole("dialog", { name: "Lead Status Distribution" });
    await expect(dialog).toBeVisible();
    const row = dialog.getByRole("row", { name: /Walkthrough Scheduled/ });
    const n = Number(((await row.getByRole("cell").textContent()) ?? "0").replace(/,/g, ""));
    expect(n).toBeGreaterThanOrEqual(1);
    // Phase 9: owners have data:export, so the CSV download is on.
    await expect(dialog.getByRole("button", { name: "Download CSV" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("no sideways scroll at 390px and no serious axe violations", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, "/leads");
    await expect(page.getByRole("heading", { level: 1, name: "Lead Dashboard" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("screenshot", async ({ page }) => {
    test.skip(isPhone(page), "desktop screenshot only");
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/leads");
    await hydrated(page);
    await expect(page.getByRole("heading", { level: 2, name: "Lead Aging" })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, "leads-dashboard");
  });
});

test.describe("Admin → Lead Scoring", () => {
  const FACTOR = "no_response_3_attempts";

  test("owner changes a rule, saves, and it reaches the database", async ({ page }) => {
    const db = adminClient();
    const { data: before } = await db
      .from("lead_scoring_rules")
      .select("id, points, label")
      .eq("factor", FACTOR)
      .single();
    if (!before) throw new Error("scoring rule missing");
    const next = before.points === 100 ? 99 : before.points + 1;
    try {
      await open(page, "/admin/lead-scoring");
      await hydrated(page);
      await expect(page.getByRole("heading", { level: 1, name: "Lead Scoring" })).toBeVisible();
      await expect(page.getByText(/Every lead starts at 50/)).toBeVisible();
      await expect(page.getByRole("spinbutton")).toHaveCount(14 + 1);

      const input = page.getByRole("spinbutton", { name: before.label });
      await input.fill(String(next));
      await expect(page.getByText("You have unsaved changes.")).toBeVisible();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Lead scoring saved. 1 rule changed." }),
      ).toBeVisible();

      const { data: after } = await db
        .from("lead_scoring_rules")
        .select("points")
        .eq("id", before.id)
        .single();
      expect(after?.points).toBe(next);
    } finally {
      await db.from("lead_scoring_rules").update({ points: before.points }).eq("id", before.id);
    }
  });

  test("the example lead updates live with unsaved weights", async ({ page }) => {
    await open(page, "/admin/lead-scoring");
    await hydrated(page);
    await page.getByRole("button", { name: "Website request" }).click();
    const score = page.getByTestId("example-score");
    const start = Number(await score.textContent());
    const inArea = page.getByRole("spinbutton", { name: "In our service area" });
    const original = await inArea.inputValue();
    await inArea.fill(String(Number(original) + 5));
    await expect(score).toHaveText(String(Math.min(100, start + 5)));
    await page.getByRole("button", { name: "Undo changes" }).click();
    await expect(score).toHaveText(String(start));
  });

  test("no sideways scroll at 390px and no serious axe violations", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, "/admin/lead-scoring");
    await expect(page.getByRole("heading", { level: 1, name: "Lead Scoring" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("screenshot", async ({ page }) => {
    test.skip(isPhone(page), "desktop screenshot only");
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/admin/lead-scoring");
    await hydrated(page);
    await shot(page, "admin-lead-scoring");
  });
});

test.describe("permissions", () => {
  test("painter gets 404 on the Lead Dashboard and Lead Scoring", async ({ page }) => {
    await open(page, "/", "painter");
    for (const path of ["/leads", "/admin/lead-scoring"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
