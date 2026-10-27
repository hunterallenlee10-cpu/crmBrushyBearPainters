import { mkdirSync } from "node:fs";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs, type TestRole } from "./users";

/** Shared helpers for the Phase 10 specs (screenshots, axe, sign-in, layout checks). */

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

export function screens(dir: string) {
  mkdirSync(dir, { recursive: true });
  return (page: Page, name: string) =>
    page.screenshot({ path: `${dir}/${name}${isPhone(page) ? "-mobile" : ""}.png`, fullPage: true });
}

/** No serious or critical axe violations (WCAG 2 A/AA). */
export async function axe(page: Page) {
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

export async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

/** A fresh browser context signed in as `role` (retries around shared sign-in locks). */
export async function signedIn(browser: Browser, info: TestInfo, role: TestRole, next: string) {
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
export async function open(page: Page, path: string) {
  await page.goto(path);
  if (/\/(login|mfa)/.test(new URL(page.url()).pathname)) {
    await page.context().clearCookies();
    await loginAs(page, "owner", path);
    await page.goto(path);
  }
}
