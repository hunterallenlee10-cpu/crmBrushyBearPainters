import { z } from "zod";
import { isPermission, PERMISSIONS, type Permission, type Scope } from "@/lib/permissions";
import { optionalMoneyCents, optionalText, requiredText } from "@/lib/validation/common";

/**
 * Users, invites, per-user overrides and personal settings (SPEC §4, §8.18, §8.19).
 * Shared by the Server Actions and the forms. Pure helpers live at the bottom.
 */

const id = (label = "Record") => z.guid(`${label} is missing or invalid.`);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const emailField = z
  .string()
  .transform(normalizeEmail)
  .refine((v) => v.length > 0, "Email is required.")
  .refine((v) => v.length <= 254 && EMAIL_RE.test(v), "Use an email like name@example.com.");

const optionalPhone = optionalText(40).refine(
  (v) => v === null || /^[+\d()\-.\s]{7,20}$/.test(v),
  "Use a phone number like (425) 555-0100.",
);

const optionalColor = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^#[0-9A-Fa-f]{6}$/.test(v), "Pick a color like #2F6B4F.");

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .refine(
    (v) => v === null || z.guid().safeParse(v).success,
    "That choice is no longer available.",
  );

// ---------------------------------------------------------------------------
// Admin → Users
// ---------------------------------------------------------------------------

export const inviteUserSchema = z.object({
  full_name: requiredText("Full name", 120),
  email: emailField,
  role_template_id: id("Role"),
  title: optionalText(80),
  department: optionalText(80),
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;
export type InviteUserValues = z.output<typeof inviteUserSchema>;

/** Fields an admin edits on someone's profile. */
export const userProfileSchema = z.object({
  user_id: id("User"),
  full_name: requiredText("Full name", 120),
  phone: optionalPhone,
  title: optionalText(80),
  department: optionalText(80),
  default_territory_id: optionalId,
  calendar_color: optionalColor,
  signature: optionalText(1000),
});
export type UserProfileInput = z.input<typeof userProfileSchema>;
export type UserProfileValues = z.output<typeof userProfileSchema>;

export const changeRoleSchema = z.object({
  user_id: id("User"),
  role_template_id: id("Role"),
});

export const laborCostSchema = z.object({
  user_id: id("User"),
  hourly_cost: optionalMoneyCents("Hourly cost").refine(
    (v) => v === null || v <= 100_000,
    "That's over $1,000 an hour. Check the amount.",
  ),
});
export type LaborCostInput = z.input<typeof laborCostSchema>;
export type LaborCostValues = z.output<typeof laborCostSchema>;

export const setActiveSchema = z.object({
  user_id: id("User"),
  active: z.boolean(),
});

export const userIdSchema = z.object({ user_id: id("User") });

export const SCOPES = ["own", "team", "all"] as const satisfies readonly Scope[];

export const overrideSchema = z
  .object({
    user_id: id("User"),
    permission: z
      .string()
      .refine((v): v is Permission => isPermission(v), "Pick a permission from the list."),
    effect: z.enum(["grant", "revoke"], "Choose grant or revoke."),
    scope: z.enum(SCOPES).default("all"),
    reason: z
      .string()
      .trim()
      .min(3, "Say why in a few words (at least 3 characters).")
      .max(500, "Keep it under 500 characters."),
  })
  // Scope only applies to scoped permissions (e.g. "View leads"); others are always "all".
  .transform((v) => ({
    ...v,
    permission: v.permission as Permission,
    scope: isScopedPermission(v.permission as Permission) ? v.scope : ("all" as const),
  }));
export type OverrideInput = z.input<typeof overrideSchema>;
export type OverrideValues = z.output<typeof overrideSchema>;

export const removeOverrideSchema = z.object({
  user_id: id("User"),
  override_id: id("Override"),
});

// ---------------------------------------------------------------------------
// /settings (own profile + preferences)
// ---------------------------------------------------------------------------

export const ownProfileSchema = z.object({
  full_name: requiredText("Full name", 120),
  phone: optionalPhone,
  title: optionalText(80),
  calendar_color: optionalColor,
  signature: optionalText(1000),
});
export type OwnProfileInput = z.input<typeof ownProfileSchema>;
export type OwnProfileValues = z.output<typeof ownProfileSchema>;

export const DEFAULT_HOMES = ["executive_overview", "my_day"] as const;
export const TIME_FORMATS = ["12h", "24h"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: "Comfortable (roomier rows, easier on a tablet)",
  compact: "Compact (more rows on screen)",
};
export type DefaultHome = (typeof DEFAULT_HOMES)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const DEFAULT_HOME_LABELS: Record<DefaultHome, string> = {
  executive_overview: "Executive Overview",
  my_day: "My Day",
};
export const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  "12h": "12-hour (2:30 PM)",
  "24h": "24-hour (14:30)",
};

export const preferencesSchema = z.object({
  default_home: z.enum(DEFAULT_HOMES, "Pick a default home."),
  time_format: z.enum(TIME_FORMATS, "Pick a time format."),
  density: z.enum(DENSITIES, "Pick a density."),
});
export type PreferencesValues = z.output<typeof preferencesSchema>;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

const SCOPED = new Set<string>(PERMISSIONS.filter((p) => p.scoped).map((p) => p.key));

export function isScopedPermission(permission: Permission): boolean {
  return SCOPED.has(permission);
}

/**
 * The home a person lands on when they haven't picked one (SPEC §8.3): owners
 * get the Executive Overview, everyone else My Day.
 */
export function roleDefaultHome(isOwner: boolean): DefaultHome {
  return isOwner ? "executive_overview" : "my_day";
}

/** Reads saved preferences, falling back to defaults for missing or unknown values. */
export function readPreferences(
  raw: unknown,
  fallbackHome: DefaultHome = "executive_overview",
): PreferencesValues {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const home = DEFAULT_HOMES.find((h) => h === o.default_home) ?? fallbackHome;
  const time = TIME_FORMATS.find((t) => t === o.time_format) ?? "12h";
  const density = DENSITIES.find((d) => d === o.density) ?? "comfortable";
  return { default_home: home, time_format: time, density };
}

/** Merges new preference values into the stored object without dropping other keys. */
export function mergePreferences(
  raw: unknown,
  next: PreferencesValues,
): Record<string, unknown> & PreferencesValues {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { ...base, ...next };
}

export type UserStatusFilter = "active" | "deactivated" | "all";

export type UserListRow = {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  title: string | null;
  department: string | null;
  isActive: boolean;
};

/** Client-side search + status tab for the users table (< 100 users per org). */
export function filterUsers<T extends UserListRow>(
  rows: readonly T[],
  query: string,
  status: UserStatusFilter,
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (status === "active" && !r.isActive) return false;
    if (status === "deactivated" && r.isActive) return false;
    if (!q) return true;
    return [r.fullName, r.email, r.roleName, r.title ?? "", r.department ?? ""].some((v) =>
      v.toLowerCase().includes(q),
    );
  });
}

export function countByStatus(
  rows: readonly Pick<UserListRow, "isActive">[],
): Record<UserStatusFilter, number> {
  const active = rows.filter((r) => r.isActive).length;
  return { active, deactivated: rows.length - active, all: rows.length };
}

/** Friendly names for modules that report open work in `open_work_counts` (grows each phase). */
export const OPEN_WORK_LABELS: Record<string, string> = {
  leads: "Open leads",
  jobs: "Open jobs",
  tasks: "Open tasks",
  appointments: "Upcoming appointments",
  estimates: "Draft estimates",
  attention_items: "Attention items",
  work_orders: "Open work orders",
};

export type OpenWorkItem = { key: string; label: string; count: number };

/** Parses the `open_work_counts` RPC result (`{ module: count }`) into rows with a count > 0. */
export function parseOpenWorkCounts(raw: unknown): OpenWorkItem[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: OpenWorkItem[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push({
      key,
      label: OPEN_WORK_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      count: Math.floor(count),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Whether a person may remove one of their two-step sign-in factors: always for
 * unverified ones; for verified ones only when their role doesn't require MFA
 * or another verified factor remains.
 */
export function canRemoveFactor(input: {
  requiresMfa: boolean;
  factorVerified: boolean;
  verifiedCount: number;
}): boolean {
  if (!input.factorVerified) return true;
  if (!input.requiresMfa) return true;
  return input.verifiedCount > 1;
}

/** Plain-text invitation email (recorded to the outbox as Simulated, never sent). */
export function invitationEmail(input: { inviterName: string; appUrl: string; email: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const url = `${input.appUrl.replace(/\/+$/, "")}/login`;
  const text = `${input.inviterName} invited you to Brushy Bear CRM. Sign in at ${url} with this email (${input.email}).`;
  return {
    subject: "You're invited to Brushy Bear CRM",
    text,
    html: `<p>${escapeHtml(input.inviterName)} invited you to Brushy Bear CRM.</p><p>Sign in at <a href="${escapeHtml(url)}">${escapeHtml(url)}</a> with this email (${escapeHtml(input.email)}).</p>`,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
