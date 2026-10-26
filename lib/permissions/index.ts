import { PERMISSIONS, type Permission, type PermissionCategory } from "@/lib/permissions/catalog";

export { PERMISSIONS, PERMISSION_CATEGORIES } from "@/lib/permissions/catalog";
export type { Permission, PermissionCategory } from "@/lib/permissions/catalog";

export type Scope = "own" | "team" | "all";

/** Resolved permissions for the current viewer: permission → widest scope held. */
export type PermissionMap = Partial<Record<Permission, Scope>>;

const KEYS = new Set<string>(PERMISSIONS.map((p) => p.key));

export function isPermission(value: string): value is Permission {
  return KEYS.has(value);
}

export const ROLE_TEMPLATE_KEYS = [
  "owner",
  "office_manager",
  "estimator",
  "project_manager",
  "painter",
  "subcontractor",
  "bookkeeper",
  "read_only",
] as const;

export type RoleTemplateKey = (typeof ROLE_TEMPLATE_KEYS)[number];

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  core_records: "Core Records",
  sales: "Sales",
  production: "Production",
  finance: "Finance",
  data_reporting: "Data & Reporting",
  operational_control: "Operational Control",
  hr_sensitive: "HR & Sensitive",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  own: "Own records",
  team: "Team",
  all: "Everyone's",
};

const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };

/** Parses the `permissions` object returned by the `my_access` RPC, dropping unknown keys. */
export function toPermissionMap(raw: unknown): PermissionMap {
  const out: PermissionMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isPermission(key) && (value === "own" || value === "team" || value === "all")) {
      out[key] = value;
    }
  }
  return out;
}

/** True when the map grants `permission` with at least `minScope`. */
export function hasPermission(
  map: PermissionMap,
  permission: Permission,
  minScope: Scope = "own",
): boolean {
  const held = map[permission];
  return held !== undefined && SCOPE_RANK[held] >= SCOPE_RANK[minScope];
}

export function hasAll(map: PermissionMap, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => hasPermission(map, p));
}

export function hasAny(map: PermissionMap, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(map, p));
}
