import { PERMISSIONS, type Permission, type PermissionMap, type Scope } from "@/lib/permissions";

/**
 * Pure mirror of app.user_perm_scope() (SQL) so the Roles screen can preview what
 * a template or user will hold before saving. Postgres remains the enforcement point.
 *
 *   - grants_all templates hold every permission with scope "all";
 *   - otherwise: the widest scope across the template's active packs;
 *   - grant overrides add; revoke overrides always win.
 */

export type PackDefinition = {
  id: string;
  deleted?: boolean;
  permissions: readonly { permission: Permission; scope: Scope }[];
};

export type OverrideDefinition = {
  permission: Permission;
  effect: "grant" | "revoke";
  scope: Scope;
};

const RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };

function widest(a: Scope | undefined, b: Scope): Scope {
  return a === undefined || RANK[b] > RANK[a] ? b : a;
}

export function resolvePermissions(input: {
  grantsAll: boolean;
  packs: readonly PackDefinition[];
  overrides?: readonly OverrideDefinition[];
}): PermissionMap {
  const out: PermissionMap = {};

  if (input.grantsAll) {
    for (const p of PERMISSIONS) out[p.key] = "all";
  } else {
    for (const pack of input.packs) {
      if (pack.deleted) continue;
      for (const { permission, scope } of pack.permissions) {
        out[permission] = widest(out[permission], scope);
      }
    }
  }

  const overrides = input.overrides ?? [];
  for (const o of overrides) {
    if (o.effect === "grant") out[o.permission] = widest(out[o.permission], o.scope);
  }
  for (const o of overrides) {
    if (o.effect === "revoke") delete out[o.permission];
  }
  return out;
}

/** Permissions gained and lost between two maps (for the "what changes" preview). */
export function diffPermissions(before: PermissionMap, after: PermissionMap) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as Permission[]);
  const added: Permission[] = [];
  const removed: Permission[] = [];
  const rescoped: { permission: Permission; from: Scope; to: Scope }[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (a === undefined && b !== undefined) added.push(k);
    else if (a !== undefined && b === undefined) removed.push(k);
    else if (a !== undefined && b !== undefined && a !== b)
      rescoped.push({ permission: k, from: a, to: b });
  }
  return { added: added.sort(), removed: removed.sort(), rescoped };
}
