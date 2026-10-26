import "server-only";

/**
 * The person viewing the app. Phase 0 has no sign-in yet, so every request is
 * a read-only preview viewer. Phase 1 replaces this with the Supabase session +
 * profile + permission engine; the shape below is what the shell consumes.
 */

export type RoleTemplateKey =
  | "owner"
  | "office_manager"
  | "estimator"
  | "project_manager"
  | "painter"
  | "subcontractor"
  | "bookkeeper"
  | "read_only";

/** Roles that get the mobile bottom tab bar (SPEC §16). */
export const CREW_ROLES: readonly RoleTemplateKey[] = [
  "project_manager",
  "painter",
  "subcontractor",
];

export type Viewer = {
  id: string;
  name: string;
  email: string | null;
  initials: string;
  role: RoleTemplateKey;
  roleLabel: string;
  /** True until real sign-in exists (Phase 1). */
  isPreview: boolean;
};

export async function getViewer(): Promise<Viewer> {
  return {
    id: "preview",
    name: "Preview",
    email: null,
    initials: "BB",
    role: "owner",
    roleLabel: "Owner (preview)",
    isPreview: true,
  };
}

export function isCrewRole(role: RoleTemplateKey): boolean {
  return CREW_ROLES.includes(role);
}
