import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  hasAll,
  hasPermission,
  type Permission,
  type PermissionMap,
  type Scope,
} from "@/lib/permissions";
import {
  initials,
  parseAccess,
  sessionGate,
  type Access,
  type AccessUser,
} from "@/lib/auth/access";

/**
 * The person viewing the app, resolved once per request from the Supabase
 * session and the `my_access` RPC. Permissions are the EFFECTIVE user's
 * (the View-as-user target while impersonating). Postgres enforces the same rules;
 * these checks only decide what to show and fail fast in Server Actions.
 */
export type Viewer = {
  id: string;
  email: string;
  name: string;
  initials: string;
  orgId: string;
  role: AccessUser["role"];
  /** The user whose permissions apply (differs from the real user while viewing as). */
  effective: AccessUser;
  real: AccessUser;
  impersonating: boolean;
  impersonation: Access["impersonation"];
  isCrew: boolean;
  isOwner: boolean;
  permissions: PermissionMap;
  can: (permission: Permission, minScope?: Scope) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
};

export type ViewerState =
  | { status: "not_configured" }
  | { status: "signed_out" }
  | { status: "no_access"; email: string | null }
  | { status: "mfa"; access: Access }
  | { status: "ok"; viewer: Viewer; access: Access };

export function buildViewer(access: Access): Viewer {
  const eff = access.effectiveUser;
  const permissions = access.permissions;
  return {
    id: eff.id,
    email: eff.email,
    name: eff.fullName,
    initials: initials(eff.fullName),
    orgId: eff.orgId,
    role: eff.role,
    effective: eff,
    real: access.user,
    impersonating: access.impersonation !== null,
    impersonation: access.impersonation,
    isCrew: eff.role.isCrew,
    isOwner: access.user.role.grantsAll,
    permissions,
    can: (p, s) => hasPermission(permissions, p, s),
    canAll: (ps) => hasAll(permissions, ps),
  };
}

export const getViewerState = cache(async (): Promise<ViewerState> => {
  if (!isSupabaseConfigured()) return { status: "not_configured" };
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { status: "signed_out" };

  const { data, error } = await supabase.rpc("my_access");
  if (error) {
    console.error("my_access failed", error.code);
    return { status: "no_access", email: userData.user.email ?? null };
  }
  const access = parseAccess(data);
  const hasVerifiedFactor = (userData.user.factors ?? []).some((f) => f.status === "verified");
  const gate = sessionGate(access, { hasVerifiedFactor });
  if (gate === "no_access" || !access)
    return { status: "no_access", email: userData.user.email ?? null };
  if (gate === "mfa") return { status: "mfa", access };
  return { status: "ok", viewer: buildViewer(access), access };
});

/** For pages and layouts inside the app: redirects unless fully signed in. */
export async function requireViewer(): Promise<Viewer> {
  const state = await getViewerState();
  switch (state.status) {
    case "ok":
      return state.viewer;
    case "mfa":
      redirect("/mfa");
    case "no_access":
      redirect("/no-access");
    case "not_configured":
      redirect("/setup-required");
    case "signed_out":
      redirect("/login");
  }
}

/** Page-level permission gate: 404s rather than revealing that a page exists. */
export async function requirePermission(...permissions: Permission[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.canAll(permissions)) notFound();
  return viewer;
}
