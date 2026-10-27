import { expect, test } from "@playwright/test";
import { allPages } from "../../lib/nav";
import { visibleAdminSections } from "../../lib/admin-sections";
import { axe, noSideScroll, open } from "./support/helpers";

/**
 * Phase 10 accessibility sweep: every page in the navigation and every Admin
 * section, as the owner, on desktop and on a phone. No serious or critical
 * axe violations (WCAG 2 A/AA) and no sideways scrolling.
 */

test.describe.configure({ timeout: 300_000 });

const pages = [
  ...allPages().map((p) => p.href),
  ...visibleAdminSections(() => true).map((s) => s.href),
  "/settings",
  "/help",
  "/help/release-notes",
].filter((href, i, all) => all.indexOf(href) === i);

test("every main page has no serious or critical axe violations", async ({ page }) => {
  const failures: string[] = [];
  for (const href of pages) {
    await open(page, href);
    await expect(page.getByRole("heading", { level: 1 }).first(), href).toBeVisible();
    try {
      await axe(page);
      await noSideScroll(page);
    } catch (e) {
      failures.push(
        `${href}: ${e instanceof Error ? e.message.split("\n").slice(0, 8).join(" ") : e}`,
      );
    }
  }
  expect(failures).toEqual([]);
});
