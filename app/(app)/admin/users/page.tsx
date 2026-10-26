import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { pacificDate } from "./_components/format";
import { InviteUserDialog, type RoleOption } from "./invite-user-dialog";
import { UsersTable, type UserRow } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const viewer = await requirePermission("users:read");
  const supabase = await createSupabaseServerClient();
  const canManage = viewer.can("users:manage") && !viewer.impersonating;

  const [{ data: profiles }, { data: templates }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, title, department, is_active, invited_at, created_at, role_templates(name)",
      )
      .order("full_name")
      .limit(500),
    canManage
      ? supabase
          .from("role_templates")
          .select("id, name, description, grants_all")
          .order("sort_order")
      : Promise.resolve({ data: null }),
  ]);

  const rows: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    roleName: p.role_templates?.name ?? "—",
    title: p.title,
    department: p.department,
    isActive: p.is_active,
    invited: pacificDate(p.invited_at),
    isYou: p.id === viewer.id,
  }));

  const roles: RoleOption[] = (templates ?? [])
    .filter((t) => viewer.isOwner || !t.grants_all)
    .map((t) => ({ id: t.id, name: t.name, description: t.description }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Everyone who can sign in to Brushy Bear CRM. Invites are invite-only; deactivated users keep their history."
        actions={canManage ? <InviteUserDialog roles={roles} /> : undefined}
      />
      <UsersTable rows={rows} canManage={canManage} />
    </div>
  );
}
