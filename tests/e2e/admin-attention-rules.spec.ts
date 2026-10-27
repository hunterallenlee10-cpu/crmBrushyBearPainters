import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminClient, loginAs, type TestRole } from "./support/users";

/**
 * Admin → Attention Rules (SPEC §9, §8.19): thresholds and on/off switches are
 * saved per company. The rules are shared by everyone on the local stack, so
 * every change is put back in a `finally`.
 */

const SCREENS = "docs/screens/phase-3";
const CHANGED = ["sold_no_deposit", "walkthrough_unconfirmed"] as const;
type Saved = { rule_key: string; enabled: boolean; thresholds: Record<string, number> };

async function orgId(): Promise<string> {
  const { data } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  return data!.id;
}

async function rules(): Promise<Saved[]> {
  const { data } = await adminClient()
    .from("attention_rules")
    .select("rule_key, enabled, thresholds")
    .eq("org_id", await orgId())
    .in("rule_key", [...CHANGED]);
  return (data ?? []) as Saved[];
}

async function restore(saved: Saved[]) {
  const org = await orgId();
  for (const r of saved) {
    await adminClient()
      .from("attention_rules")
      .update({ enabled: r.enabled, thresholds: r.thresholds })
      .eq("org_id", org)
      .eq("rule_key", r.rule_key);
  }
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

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("Admin → Attention Rules", () => {
  test("lists every rule with plain labels and where numbers come from", async ({
    browser,
  }, info) => {
    const page = await signedIn(browser, info, "owner", "/admin/attention-rules");
    await open(page, "/admin/attention-rules");
    await expect(page.getByRole("heading", { level: 1, name: "Attention Rules" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aging lead" })).toBeVisible();
    await expect(page.getByLabel("Medium after (days)")).toBeVisible();
    await expect(page.getByLabel("Cutoff hour (Pacific, 0–23)")).toBeVisible();
    await expect(page.getByText(/Uses the text-back SLA in Company Settings/)).toBeVisible();
    await expect(
      page.getByText(/Changes apply on the next check \(every minute\)/).first(),
    ).toBeVisible();
    if (!info.project.name.includes("mobile")) {
      await page.screenshot({ path: `${SCREENS}/admin-attention-rules.png`, fullPage: false });
    }
    expect(await seriousAxe(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/admin/attention-rules");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
    await page.context().close();
  });

  test("changes a threshold and turns a rule off", async ({ browser, isMobile }, info) => {
    test.skip(isMobile, "Desktop only");
    const before = await rules();
    expect(before).toHaveLength(2);
    const page = await signedIn(browser, info, "owner", "/admin/attention-rules");
    try {
      await open(page, "/admin/attention-rules");
      const sold = page.getByTestId("rule-sold_no_deposit");
      const current = Number(await sold.getByLabel("Days after sold").inputValue());
      const next = current === 4 ? 5 : 4;

      // Range checks block saving.
      const cutoff = page.getByLabel("Cutoff hour (Pacific, 0–23)");
      await cutoff.fill("24");
      await expect(page.getByText("Use 0 to 23.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
      await page.getByRole("button", { name: "Undo changes" }).click();

      await sold.getByLabel("Days after sold").fill(String(next));
      const wasOn = before.find((r) => r.rule_key === "walkthrough_unconfirmed")!.enabled;
      const toggle = page.getByRole("switch", { name: "Use rule: Walkthrough not confirmed" });
      await toggle.click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText(/Attention rules saved \(2 rules changed\)/).first()).toBeVisible(
        {
          timeout: 45_000,
        },
      );

      const after = await rules();
      const s = after.find((r) => r.rule_key === "sold_no_deposit")!;
      const w = after.find((r) => r.rule_key === "walkthrough_unconfirmed")!;
      expect(s.thresholds.days).toBe(next);
      expect(w.enabled).toBe(!wasOn);
      expect(w.thresholds).toEqual(
        before.find((r) => r.rule_key === "walkthrough_unconfirmed")!.thresholds,
      );

      // Saved values show after a reload.
      await open(page, "/admin/attention-rules");
      await expect(
        page.getByTestId("rule-sold_no_deposit").getByLabel("Days after sold"),
      ).toHaveValue(String(next));
    } finally {
      await restore(before);
      await page.context().close();
    }
  });

  test("people without settings access get a 404", async ({ browser, isMobile }, info) => {
    test.skip(isMobile, "Desktop only");
    expect(await statusAs(browser, info, "estimator", "/admin/attention-rules")).toBe(404);
  });
});
