/**
 * App navigation (SPEC §3.1). One source of truth for the top nav, the mobile
 * menu, universal-search shortcuts, and the placeholder pages each route shows
 * until its phase is built. `requiresAny` hides links a role can't use; pages
 * enforce the same permissions server-side (and Postgres enforces data access).
 */

import { type Permission } from "@/lib/permissions";

export type NavLink = {
  label: string;
  href: string;
  /** One line shown on the page header and in search. */
  description: string;
  /** Build phase that delivers the real screen (SPEC §17). */
  phase: number;
  /** Visible when the viewer holds at least one of these (omit = everyone). */
  requiresAny?: readonly Permission[];
};

export type RecentKind = "leads" | "jobs";

export type NavGroup = {
  id: string;
  label: string;
  /** Direct link (no dropdown) when set. */
  href?: string;
  items?: readonly NavLink[];
  /** Dropdown also lists the N most recent records of this kind. */
  recent?: { kind: RecentKind; limit: number; label: string; empty: string };
  /** Shows a count badge (Attention). */
  badge?: "attention";
  /** For direct-link groups: visible when the viewer holds one of these. */
  requiresAny?: readonly Permission[];
};

export const HOME: NavLink = {
  label: "Home",
  href: "/",
  description: "Executive Overview for owners; My Day for everyone else.",
  phase: 9,
};

export const NAV: readonly NavGroup[] = [
  { id: "home", label: "Home", href: "/" },
  {
    id: "leads",
    label: "Leads",
    items: [
      {
        label: "Lead Dashboard",
        href: "/leads",
        description: "Lead volume, aging, sources and conversion.",
        phase: 2,
        requiresAny: ["leads:read"],
      },
      {
        label: "Lead List",
        href: "/leads/list",
        description: "Every lead with views, filters and bulk actions.",
        phase: 2,
        requiresAny: ["leads:read"],
      },
      {
        label: "New Lead",
        href: "/leads/new",
        description: "Add a lead and book the walkthrough.",
        phase: 2,
        requiresAny: ["leads:create"],
      },
    ],
    recent: { kind: "leads", limit: 8, label: "Recent leads", empty: "No recent leads yet." },
  },
  {
    id: "jobs",
    label: "Jobs",
    items: [
      {
        label: "Jobs Dashboard",
        href: "/jobs",
        description: "Pipeline value, win rate and stage snapshot.",
        phase: 3,
        requiresAny: ["jobs:read"],
      },
      {
        label: "Job List",
        href: "/jobs/list",
        description: "Every job by stage, work type and point of contact.",
        phase: 3,
        requiresAny: ["jobs:read"],
      },
      {
        label: "Approvals",
        href: "/jobs/approvals",
        description: "Discounts, change orders and overrides waiting on an owner.",
        phase: 3,
        requiresAny: ["estimates:approve_discount", "credits:approve", "job_admin:override"],
      },
      {
        label: "New Job",
        href: "/jobs/new",
        description: "Start a job without a lead (repeat customers, referrals).",
        phase: 3,
        requiresAny: ["jobs:create"],
      },
    ],
    recent: { kind: "jobs", limit: 10, label: "Recent jobs", empty: "No recent jobs yet." },
  },
  {
    id: "schedule",
    label: "Schedule",
    items: [
      {
        label: "Production Center",
        href: "/schedule",
        description: "What needs scheduling, what's at risk, and today's crews.",
        phase: 6,
        requiresAny: ["schedule:read"],
      },
      {
        label: "Master Schedule",
        href: "/schedule/master",
        description: "Drag jobs onto crews, check conflicts, publish changes.",
        phase: 6,
        requiresAny: ["schedule:read"],
      },
      {
        label: "My Projects",
        href: "/schedule/my-projects",
        description: "Crew-lead portal: today's work order, scope, colors and daily log.",
        phase: 6,
        requiresAny: ["work_orders:read"],
      },
      {
        label: "Onboarding Board",
        href: "/schedule/onboarding",
        description: "Sold jobs moving from deposit to Ready to Schedule.",
        phase: 5,
        requiresAny: ["jobs:read"],
      },
    ],
  },
  {
    id: "attention",
    label: "Attention",
    href: "/attention",
    badge: "attention",
    requiresAny: ["attention:read"],
  },
  {
    id: "more",
    label: "More",
    items: [
      {
        label: "Accounts",
        href: "/accounts",
        description: "Households and customers.",
        phase: 2,
        requiresAny: ["accounts:read"],
      },
      {
        label: "Contacts",
        href: "/contacts",
        description: "People, their consent and how to reach them.",
        phase: 2,
        requiresAny: ["contacts:read"],
      },
      {
        label: "Estimates",
        href: "/estimates",
        description: "Every estimate and its status.",
        phase: 4,
        requiresAny: ["estimates:read"],
      },
      {
        label: "Invoices",
        href: "/invoices",
        description: "Deposit, progress and final invoices; A/R aging.",
        phase: 7,
        requiresAny: ["invoices:read"],
      },
      {
        label: "Campaigns",
        href: "/campaigns",
        description: "Email and SMS campaigns and drips.",
        phase: 8,
        requiresAny: ["campaigns:manage"],
      },
      {
        label: "Documents",
        href: "/documents",
        description: "Proposals, contracts, color sheets and uploads.",
        phase: 5,
        requiresAny: ["documents:read"],
      },
      {
        label: "Price Book",
        href: "/price-book",
        description: "Catalog, paint products and production rates.",
        phase: 4,
        requiresAny: ["estimates:create", "settings:manage"],
      },
      {
        label: "Analytics",
        href: "/analytics",
        description: "Dashboards, reports and Ask Brushy Bear.",
        phase: 9,
        requiresAny: ["analytics:read"],
      },
      {
        label: "My Numbers",
        href: "/my-numbers",
        description: "Your personal scoreboard.",
        phase: 9,
        requiresAny: ["leads:read", "jobs:read"],
      },
      {
        label: "Referrals",
        href: "/referrals",
        description: "Bear Champions referral program.",
        phase: 8,
        requiresAny: ["referrals:manage"],
      },
      {
        label: "Reviews",
        href: "/reviews",
        description: "Review requests and results.",
        phase: 8,
        requiresAny: ["reviews:manage"],
      },
      {
        label: "Help",
        href: "/help",
        description: "How-to articles and release notes.",
        phase: 10,
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      {
        label: "Setup",
        href: "/admin",
        description: "Company settings, picklists, schedule admin and more.",
        phase: 1,
        requiresAny: [
          "settings:manage",
          "picklists:manage",
          "users:read",
          "roles:manage",
          "integrations:read",
          "audit:read",
          "records:restore",
        ],
      },
      {
        label: "Users",
        href: "/admin/users",
        description: "Invite, deactivate and reassign users.",
        phase: 1,
        requiresAny: ["users:read"],
      },
      {
        label: "Roles & Permissions",
        href: "/admin/roles",
        description: "Permission packs, role templates and per-user grants.",
        phase: 1,
        requiresAny: ["roles:manage"],
      },
      {
        label: "Workflows",
        href: "/admin/workflows",
        description: "Automations, test runs and run history.",
        phase: 8,
        requiresAny: ["workflows:manage"],
      },
      {
        label: "Templates",
        href: "/admin/templates",
        description: "SMS and email templates.",
        phase: 8,
        requiresAny: ["templates:manage"],
      },
      {
        label: "Integrations",
        href: "/admin/integrations",
        description: "Outside services. All ship disconnected.",
        phase: 1,
        requiresAny: ["integrations:read"],
      },
      {
        label: "Audit Log",
        href: "/admin/audit-log",
        description: "Every change, who made it, and when.",
        phase: 1,
        requiresAny: ["audit:read"],
      },
      {
        label: "Deleted Records",
        href: "/admin/deleted-records",
        description: "Restore soft-deleted records.",
        phase: 1,
        requiresAny: ["records:restore"],
      },
    ],
  },
];

/** Routes outside the top nav (user menu, crew tab bar). */
export const OTHER_LINKS: readonly NavLink[] = [
  {
    label: "Attention",
    href: "/attention",
    description: "Jobs don't stall past attention.",
    phase: 3,
    requiresAny: ["attention:read"],
  },
  {
    label: "My Day",
    href: "/workspace",
    description: "Your tasks, jobs, leads and messages for today.",
    phase: 9,
  },
  {
    label: "Settings",
    href: "/settings",
    description: "Profile, notifications, security and preferences.",
    phase: 1,
  },
  {
    label: "Today",
    href: "/field/today",
    description: "Today's jobs: address, access notes, scope and colors.",
    phase: 6,
    requiresAny: ["work_orders:read"],
  },
  {
    label: "Camera",
    href: "/field/camera",
    description: "Take job photos. Works offline and syncs later.",
    phase: 5,
    requiresAny: ["photos:upload"],
  },
  {
    label: "Daily Log",
    href: "/field/daily-log",
    description: "Photos, finished today, next up, cleanup done.",
    phase: 6,
    requiresAny: ["daily_logs:create"],
  },
  {
    label: "Messages",
    href: "/field/messages",
    description: "Messages about your active jobs.",
    phase: 8,
    requiresAny: ["messages:read"],
  },
];

export type Can = (permission: Permission) => boolean;

function allowed(requiresAny: readonly Permission[] | undefined, can: Can): boolean {
  return !requiresAny || requiresAny.some(can);
}

export function canSeeLink(link: NavLink, can: Can): boolean {
  return allowed(link.requiresAny, can);
}

/** The nav as a given viewer should see it: hidden links and empty groups removed. */
export function visibleNav(can: Can): NavGroup[] {
  const out: NavGroup[] = [];
  for (const group of NAV) {
    if (group.href) {
      if (allowed(group.requiresAny, can)) out.push(group);
      continue;
    }
    const items = (group.items ?? []).filter((i) => canSeeLink(i, can));
    if (items.length > 0) out.push({ ...group, items });
  }
  return out;
}

/** Every routable page with its placeholder metadata (Home excluded). */
export function allPages(): NavLink[] {
  const fromNav = NAV.flatMap((g) => g.items ?? []);
  const seen = new Set<string>();
  const out: NavLink[] = [];
  for (const link of [...fromNav, ...OTHER_LINKS]) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    out.push(link);
  }
  return out;
}

export function findPage(href: string): NavLink | undefined {
  if (href === HOME.href) return HOME;
  return allPages().find((p) => p.href === href);
}

/** Whether `pathname` belongs to a nav group (for active styling). */
export function isGroupActive(group: NavGroup, pathname: string): boolean {
  if (group.href) {
    return group.href === "/" ? pathname === "/" : pathname.startsWith(group.href);
  }
  return (group.items ?? []).some(
    (i) => i.href === pathname || (i.href !== "/" && pathname.startsWith(`${i.href}/`)),
  );
}
