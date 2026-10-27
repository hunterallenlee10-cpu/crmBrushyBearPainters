import { type Permission } from "@/lib/permissions";

/**
 * Admin → Setup sections (SPEC §8.19). Built sections link to their page;
 * the rest show which phase delivers them.
 */
export type AdminSection = {
  label: string;
  href: string;
  description: string;
  group:
    | "Company"
    | "People & access"
    | "Data"
    | "Sales & messaging"
    | "Production"
    | "Finance"
    | "Platform";
  phase: number;
  requiresAny?: readonly Permission[];
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    label: "Company Settings",
    href: "/admin/company",
    group: "Company",
    phase: 1,
    requiresAny: ["settings:manage"],
    description: "Name, contact details, licensing, business hours, SLAs, season, deposit.",
  },
  {
    label: "Territories",
    href: "/admin/territories",
    group: "Company",
    phase: 1,
    requiresAny: ["settings:manage"],
    description: "Service-area cities and their ZIP codes.",
  },
  {
    label: "Field Picklists",
    href: "/admin/picklists",
    group: "Data",
    phase: 1,
    requiresAny: ["picklists:manage"],
    description: "Lead sources, dispositions, work types, siding, sheens and more.",
  },
  {
    label: "Users",
    href: "/admin/users",
    group: "People & access",
    phase: 1,
    requiresAny: ["users:read"],
    description: "Invite, edit, deactivate and reassign users.",
  },
  {
    label: "Roles & Permissions",
    href: "/admin/roles",
    group: "People & access",
    phase: 1,
    requiresAny: ["roles:manage"],
    description: "Permission packs, role templates and per-user grants.",
  },
  {
    label: "Integrations",
    href: "/admin/integrations",
    group: "Platform",
    phase: 1,
    requiresAny: ["integrations:read"],
    description: "Outside services (all disconnected) and the simulated outbox.",
  },
  {
    label: "Audit Log",
    href: "/admin/audit-log",
    group: "Platform",
    phase: 1,
    requiresAny: ["audit:read"],
    description: "Every change: who, what, when and from where.",
  },
  {
    label: "Deleted Records",
    href: "/admin/deleted-records",
    group: "Data",
    phase: 1,
    requiresAny: ["records:restore"],
    description: "Restore soft-deleted records.",
  },
  {
    label: "Notification Settings",
    href: "/admin/notifications",
    group: "Platform",
    phase: 8,
    requiresAny: ["settings:manage"],
    description: "Which events notify whom.",
  },
  {
    label: "Job Recovery",
    href: "/admin/job-recovery",
    group: "Data",
    phase: 10,
    requiresAny: ["job_admin:override"],
    description: "Fix stuck jobs and stage history.",
  },
  {
    label: "Attention Rules",
    href: "/admin/attention-rules",
    group: "Sales & messaging",
    phase: 3,
    requiresAny: ["settings:manage"],
    description: "Turn rules on or off and set their thresholds.",
  },
  {
    label: "Lead Scoring",
    href: "/admin/lead-scoring",
    group: "Sales & messaging",
    phase: 2,
    requiresAny: ["settings:manage"],
    description: "Points per factor, grades and Hot / Warm / Cold.",
  },
  {
    label: "Estimate Setup",
    href: "/admin/estimate-setup",
    group: "Sales & messaging",
    phase: 4,
    requiresAny: ["settings:manage"],
    description: "Paint catalog, production rates, multipliers, margin targets.",
  },
  {
    label: "Agreement Templates",
    href: "/admin/agreements",
    group: "Sales & messaging",
    phase: 4,
    requiresAny: ["templates:manage"],
    description: "BearSign proposal, contract and change-order templates.",
  },
  {
    label: "Schedule Admin",
    href: "/admin/schedule",
    group: "Production",
    phase: 6,
    requiresAny: ["settings:manage"],
    description: "Operating hours, work types, crews, work rules and skills.",
  },
  {
    label: "Subcontractors",
    href: "/admin/subcontractors",
    group: "Production",
    phase: 6,
    requiresAny: ["crews:manage"],
    description: "Roster and compliance documents.",
  },
  {
    label: "Finance",
    href: "/admin/finance",
    group: "Finance",
    phase: 7,
    requiresAny: ["finance:close_month"],
    description: "Reconciliation and month close.",
  },
  {
    label: "Messaging & Templates",
    href: "/admin/templates",
    group: "Sales & messaging",
    phase: 8,
    requiresAny: ["templates:manage"],
    description: "SMS and email templates, merge fields, quiet hours and footers.",
  },
  {
    label: "Workflows",
    href: "/admin/workflows",
    group: "Sales & messaging",
    phase: 8,
    requiresAny: ["workflows:manage"],
    description: "Automations, test runs and run history.",
  },
  {
    label: "Follow-up Lists & Dispositions",
    href: "/admin/follow-up-lists",
    group: "Sales & messaging",
    phase: 8,
    requiresAny: ["settings:manage"],
    description: "Dynamic call lists and disposition groups.",
  },
  {
    label: "Referral Program",
    href: "/admin/referrals",
    group: "Sales & messaging",
    phase: 8,
    requiresAny: ["referrals:manage"],
    description: "Bear Champions rewards and rules.",
  },
  {
    label: "Marketing Spend",
    href: "/admin/marketing-spend",
    group: "Sales & messaging",
    phase: 9,
    requiresAny: ["settings:manage"],
    description: "Monthly spend per lead source for cost per lead.",
  },
  {
    label: "Data Import",
    href: "/admin/import",
    group: "Data",
    phase: 10,
    requiresAny: ["bulk:update"],
    description: "CSV import with field mapping and review.",
  },
  {
    label: "Bulk Update",
    href: "/admin/bulk-update",
    group: "Data",
    phase: 10,
    requiresAny: ["bulk:update"],
    description: "Preview-first, audited, reversible bulk changes.",
  },
  {
    label: "Merge Customers",
    href: "/admin/merge",
    group: "Data",
    phase: 10,
    requiresAny: ["records:merge"],
    description: "Reversible merges of duplicate customers.",
  },
  {
    label: "Module Manager",
    href: "/admin/modules",
    group: "Platform",
    phase: 10,
    requiresAny: ["settings:manage"],
    description: "Custom fields, layouts and validation rules.",
  },
  {
    label: "Export Controls",
    href: "/admin/export-controls",
    group: "Platform",
    phase: 10,
    requiresAny: ["data:export"],
    description: "Who can export, and the export log.",
  },
];

export function visibleAdminSections(can: (p: Permission) => boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => !s.requiresAny || s.requiresAny.some(can));
}

/** The phase being built; sections and nav pages from later phases are shown as upcoming. */
export const CURRENT_PHASE = 8;
