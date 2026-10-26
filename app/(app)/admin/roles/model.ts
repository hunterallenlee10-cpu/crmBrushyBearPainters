import { resolvePermissions } from "@/lib/domain/permissions";
import {
  CATEGORY_LABELS,
  PERMISSIONS,
  PERMISSION_CATEGORIES,
  type Permission,
  type PermissionCategory,
  type PermissionMap,
  type Scope,
} from "@/lib/permissions";

/** Plain shapes passed from the Roles server pages to their client components. */

export type PackPermission = { permission: Permission; scope: Scope };

export type PackView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PermissionCategory;
  isSystem: boolean;
  permissions: PackPermission[];
};

export type TemplateView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  grantsAll: boolean;
  requiresMfa: boolean;
  isCrew: boolean;
  /** Packs linked to this template that still exist (deleted packs grant nothing). */
  packIds: string[];
};

export type CatalogEntry = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p.label]),
) as Record<Permission, string>;

/** The catalog grouped by category, in catalog order. */
export const CATALOG_BY_CATEGORY: {
  category: PermissionCategory;
  label: string;
  items: CatalogEntry[];
}[] = PERMISSION_CATEGORIES.map((category) => ({
  category,
  label: CATEGORY_LABELS[category],
  items: PERMISSIONS.filter((p) => p.category === category),
}));

/** Effective permissions a template resolves to (same rules as the SQL resolver). */
export function resolveTemplate(
  template: Pick<TemplateView, "grantsAll">,
  packIds: readonly string[],
  packsById: ReadonlyMap<string, PackView>,
): PermissionMap {
  return resolvePermissions({
    grantsAll: template.grantsAll,
    packs: packIds.flatMap((id) => {
      const pack = packsById.get(id);
      return pack ? [{ id, permissions: pack.permissions }] : [];
    }),
  });
}

export function countPermissions(map: PermissionMap): number {
  return Object.keys(map).length;
}

/** Packs grouped by category (categories with no packs are left out). */
export function groupPacks<T extends Pick<PackView, "category">>(packs: readonly T[]) {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    packs: packs.filter((p) => p.category === category),
  })).filter((g) => g.packs.length > 0);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const ROLES_TABS = [
  { value: "overview", label: "Overview" },
  { value: "templates", label: "Templates" },
  { value: "packs", label: "Packs" },
  { value: "users", label: "Users" },
] as const;

export type RolesTab = (typeof ROLES_TABS)[number]["value"];

export function isRolesTab(value: string | undefined): value is RolesTab {
  return ROLES_TABS.some((t) => t.value === value);
}
