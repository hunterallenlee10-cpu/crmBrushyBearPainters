import { describe, expect, it } from "vitest";
import { HOME, NAV, OTHER_LINKS, allPages, findPage, isGroupActive, visibleNav } from "@/lib/nav";
import { PERMISSIONS, type Permission } from "@/lib/permissions";

describe("navigation (SPEC §3.1)", () => {
  it("top-level order matches the spec", () => {
    expect(NAV.map((g) => g.label)).toEqual([
      "Home",
      "Leads",
      "Jobs",
      "Schedule",
      "Attention",
      "More",
      "Admin",
    ]);
  });

  it("dropdowns list the spec's pages in order", () => {
    const labels = (id: string) => NAV.find((g) => g.id === id)?.items?.map((i) => i.label);
    // Follow-up Lists, Messages and Warranty & Service (DECISIONS 2026-10-27).
    expect(labels("leads")).toEqual(["Lead Dashboard", "Lead List", "New Lead", "Follow-up Lists"]);
    expect(labels("jobs")).toEqual(["Jobs Dashboard", "Job List", "Approvals", "New Job"]);
    expect(labels("schedule")).toEqual([
      "Production Center",
      "Master Schedule",
      "My Projects",
      "Onboarding Board",
    ]);
    expect(labels("more")).toEqual([
      "Accounts",
      "Contacts",
      "Estimates",
      "Invoices",
      "Messages",
      "Warranty & Service",
      "Campaigns",
      "Documents",
      "Price Book",
      "Analytics",
      "My Numbers",
      "Referrals",
      "Reviews",
      "Help",
    ]);
    expect(labels("admin")).toEqual([
      "Setup",
      "Users",
      "Roles & Permissions",
      "Workflows",
      "Templates",
      "Integrations",
      "Audit Log",
      "Deleted Records",
    ]);
  });

  it("recent items: 8 leads and 10 jobs", () => {
    expect(NAV.find((g) => g.id === "leads")?.recent?.limit).toBe(8);
    expect(NAV.find((g) => g.id === "jobs")?.recent?.limit).toBe(10);
  });

  it("every Admin page is permission-gated", () => {
    for (const item of NAV.find((g) => g.id === "admin")?.items ?? []) {
      expect(item.requiresAny?.length, item.href).toBeGreaterThan(0);
    }
  });

  it("filters the nav per role", () => {
    const can = (held: Permission[]) => (p: Permission) => held.includes(p);
    const owner = visibleNav(() => true);
    expect(owner.map((g) => g.label)).toEqual(NAV.map((g) => g.label));

    const painter = visibleNav(
      can(["schedule:read", "work_orders:read", "photos:upload", "daily_logs:create"]),
    );
    expect(painter.map((g) => g.label)).toEqual(["Home", "Schedule", "More"]);
    expect(painter.find((g) => g.id === "schedule")?.items?.map((i) => i.label)).toEqual([
      "Production Center",
      "Master Schedule",
      "My Projects",
    ]);
    expect(painter.find((g) => g.id === "more")?.items?.map((i) => i.label)).toEqual(["Help"]);

    const office = visibleNav(
      can(["users:read", "integrations:read", "records:restore", "leads:read"]),
    );
    expect(office.find((g) => g.id === "admin")?.items?.map((i) => i.label)).toEqual([
      "Setup",
      "Users",
      "Integrations",
      "Deleted Records",
    ]);
  });

  it("every requiresAny entry is a real permission", () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const p of [HOME, ...allPages()])
      for (const r of p.requiresAny ?? []) expect(keys.has(r), r).toBe(true);
  });

  it("every page has a unique, absolute, lowercase href and a valid phase", () => {
    const pages = allPages();
    const hrefs = pages.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const p of [HOME, ...pages]) {
      expect(p.href).toMatch(/^\/[a-z0-9/-]*$/);
      expect(p.href === "/" || !p.href.endsWith("/")).toBe(true);
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThanOrEqual(10);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("findPage resolves home, nav and other links", () => {
    expect(findPage("/")).toBe(HOME);
    expect(findPage("/leads/list")?.label).toBe("Lead List");
    expect(findPage("/settings")?.label).toBe("Settings");
    expect(findPage("/nope")).toBeUndefined();
    expect(OTHER_LINKS.every((l) => findPage(l.href))).toBe(true);
  });

  it("marks the right group active", () => {
    const leads = NAV.find((g) => g.id === "leads");
    const home = NAV.find((g) => g.id === "home");
    if (!leads || !home) throw new Error("missing groups");
    expect(isGroupActive(leads, "/leads/list")).toBe(true);
    expect(isGroupActive(leads, "/jobs")).toBe(false);
    expect(isGroupActive(home, "/")).toBe(true);
    expect(isGroupActive(home, "/leads")).toBe(false);
  });
});
