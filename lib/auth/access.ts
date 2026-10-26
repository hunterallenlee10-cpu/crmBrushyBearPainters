import { toPermissionMap, type PermissionMap, type RoleTemplateKey } from "@/lib/permissions";

/**
 * Parses the `my_access` RPC payload into a typed shape. Pure, so it is unit-tested.
 */

export type AccessUser = {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  department: string | null;
  orgId: string;
  isActive: boolean;
  role: {
    id: string;
    key: string;
    name: string;
    requiresMfa: boolean;
    isCrew: boolean;
    grantsAll: boolean;
  };
};

export type Access = {
  user: AccessUser;
  effectiveUser: AccessUser;
  impersonation: { id: string; targetUserId: string; startedAt: string; expiresAt: string } | null;
  sessionOk: boolean;
  mfa: { required: boolean; aal: "aal1" | "aal2" };
  permissions: PermissionMap;
};

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parseUser(raw: unknown): AccessUser | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const r = (o.role ?? {}) as Record<string, unknown>;
  const id = str(o.id);
  const email = str(o.email);
  const orgId = str(o.org_id);
  const roleId = str(r.id);
  const roleKey = str(r.key);
  if (!id || !email || !orgId || !roleId || !roleKey) return null;
  return {
    id,
    email,
    fullName: str(o.full_name) ?? email,
    title: str(o.title),
    department: str(o.department),
    orgId,
    isActive: o.is_active === true,
    role: {
      id: roleId,
      key: roleKey,
      name: str(r.name) ?? roleKey,
      requiresMfa: r.requires_mfa === true,
      isCrew: r.is_crew === true,
      grantsAll: r.grants_all === true,
    },
  };
}

/** Returns null when the signed-in auth user has no profile (not invited / removed). */
export function parseAccess(raw: unknown): Access | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const user = parseUser(o.user);
  if (!user) return null;
  const effectiveUser = parseUser(o.effective_user) ?? user;
  const mfa = (o.mfa ?? {}) as Record<string, unknown>;
  const imp =
    o.impersonation && typeof o.impersonation === "object"
      ? (o.impersonation as Record<string, unknown>)
      : null;
  const impId = imp ? str(imp.id) : null;
  return {
    user,
    effectiveUser,
    impersonation:
      imp && impId
        ? {
            id: impId,
            targetUserId: str(imp.target_user_id) ?? effectiveUser.id,
            startedAt: str(imp.started_at) ?? "",
            expiresAt: str(imp.expires_at) ?? "",
          }
        : null,
    sessionOk: o.session_ok === true,
    mfa: { required: mfa.required === true, aal: mfa.aal === "aal2" ? "aal2" : "aal1" },
    permissions: toPermissionMap(o.permissions),
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export const CREW_ROLE_KEYS: readonly RoleTemplateKey[] = [
  "project_manager",
  "painter",
  "subcontractor",
];

/** Where a signed-in user should land, given their session state. */
/**
 * Where a signed-in session may go. Two-step sign-in is asked for when the role
 * requires it, and also whenever the user has set up an authenticator on their own.
 */
export function sessionGate(
  access: Access | null,
  opts: { hasVerifiedFactor?: boolean } = {},
): "no_access" | "mfa" | "ok" {
  if (!access || !access.user.isActive) return "no_access";
  if ((access.mfa.required || opts.hasVerifiedFactor) && access.mfa.aal !== "aal2") return "mfa";
  if (!access.sessionOk) return "no_access";
  return "ok";
}
