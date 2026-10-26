import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { resolvePermissions, type PackDefinition } from "@/lib/domain/permissions";
import { isPermission, type Permission, type Scope } from "@/lib/permissions";
import { centsToDollars } from "@/lib/validation/common";
import { type UserProfileInput } from "@/lib/validation/users";
import { pacificDate, pacificDateTime } from "../_components/format";
import { Card } from "../_components/form-bits";
import { StatusBadge } from "../users-table";
import { LaborCostCard } from "./labor-cost-card";
import { OverridesCard, type OverrideRow } from "./overrides-card";
import { ProfileForm } from "./profile-form";
import { RoleCard } from "./role-card";
import { StatusCard } from "./status-card";

export const metadata: Metadata = { title: "User" };

const isScope = (v: string): v is Scope => v === "own" || v === "team" || v === "all";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("users:read");
  if (!z.guid().safeParse(id).success) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase
    .from("profiles")
    .select("*, role_templates(id, name, key, grants_all, requires_mfa)")
    .eq("id", id)
    .maybeSingle();
  if (!user || !user.role_templates) notFound();
  const role = user.role_templates;

  const writable = !viewer.impersonating;
  const isSelf = user.id === viewer.id;
  const canManage = viewer.can("users:manage") && writable;
  const canSeeOverrides = viewer.can("roles:manage") || isSelf;
  const canEditOverrides = viewer.can("roles:manage") && writable;
  const canSeeCost = viewer.can("hr:read");
  const canEditCost = viewer.can("hr:manage") && writable;

  const [people, territories, templates, compensation, overrides, packs] = await Promise.all([
    supabase.from("profiles").select("id, full_name, is_active").order("full_name"),
    supabase.from("territories").select("id, name, active").order("sort_order").order("name"),
    canManage
      ? supabase.from("role_templates").select("id, name, grants_all").order("sort_order")
      : Promise.resolve({ data: null }),
    canSeeCost
      ? supabase
          .from("profile_compensation")
          .select("hourly_cost_cents")
          .eq("profile_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canSeeOverrides
      ? supabase
          .from("user_permission_overrides")
          .select("id, permission, effect, scope, reason, created_at, created_by")
          .eq("user_id", id)
          .order("created_at")
      : Promise.resolve({ data: null }),
    supabase
      .from("template_packs")
      .select("pack_id, permission_packs(id, deleted_at, pack_permissions(permission, scope))")
      .eq("template_id", role.id),
  ]);

  const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const territoryName = (territories.data ?? []).find(
    (t) => t.id === user.default_territory_id,
  )?.name;

  const overrideRows: OverrideRow[] = (overrides.data ?? [])
    .filter((o) => isPermission(o.permission))
    .map((o) => ({
      id: o.id,
      permission: o.permission as Permission,
      effect: o.effect === "revoke" ? "revoke" : "grant",
      scope: isScope(o.scope) ? o.scope : "all",
      reason: o.reason,
      added: pacificDate(o.created_at),
      addedBy: o.created_by ? (names.get(o.created_by) ?? "Unknown") : "System",
    }));

  // Effective permissions (pure mirror of the SQL resolver). Overrides only count when visible.
  const packDefs: PackDefinition[] = (packs.data ?? []).flatMap((tp) =>
    tp.permission_packs
      ? [
          {
            id: tp.permission_packs.id,
            deleted: tp.permission_packs.deleted_at !== null,
            permissions: tp.permission_packs.pack_permissions
              .filter((pp) => isPermission(pp.permission) && isScope(pp.scope))
              .map((pp) => ({ permission: pp.permission as Permission, scope: pp.scope as Scope })),
          },
        ]
      : [],
  );
  const effectiveCount = Object.keys(
    resolvePermissions({ grantsAll: role.grants_all, packs: packDefs, overrides: overrideRows }),
  ).length;

  const profileDefaults: UserProfileInput = {
    user_id: user.id,
    full_name: user.full_name,
    phone: user.phone ?? "",
    title: user.title ?? "",
    department: user.department ?? "",
    default_territory_id: user.default_territory_id ?? "",
    calendar_color: user.calendar_color ?? "",
    signature: user.signature ?? "",
  };

  const facts: [string, React.ReactNode][] = [
    ["Email", user.email],
    ["Role", role.name],
    ["Title", user.title ?? "—"],
    ["Department", user.department ?? "—"],
    ["Phone", user.phone ?? "—"],
    ["Default territory", territoryName ?? "—"],
    [
      "Invited",
      user.invited_at
        ? `${pacificDateTime(user.invited_at)}${user.invited_by ? ` by ${names.get(user.invited_by) ?? "Unknown"}` : ""}`
        : "—",
    ],
    [
      "Permissions",
      role.grants_all ? "Every permission (Owner)" : `${effectiveCount} effective permissions`,
    ],
  ];
  if (!user.is_active) {
    facts.push([
      "Deactivated",
      `${pacificDateTime(user.deactivated_at)}${user.deactivated_by ? ` by ${names.get(user.deactivated_by) ?? "Unknown"}` : ""}`,
    ]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/users"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
        >
          <ArrowLeft className="size-4" aria-hidden /> All users
        </Link>
        <PageHeader
          title={user.full_name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all">{user.email}</span>
              <StatusBadge active={user.is_active} />
              {isSelf && <span className="text-xs">(you)</span>}
            </span>
          }
        />
      </div>

      <Card title="Profile" headingId="profile-summary">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="text-sm break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {canManage ? (
        <ProfileForm
          defaults={profileDefaults}
          territories={(territories.data ?? []).filter(
            (t) => t.active || t.id === user.default_territory_id,
          )}
        />
      ) : isSelf ? (
        <p className="text-sm text-muted-foreground">
          To change your name, phone, title or signature, go to{" "}
          <Link href="/settings" className="text-bb-forest underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      ) : null}

      {canManage && templates.data && (
        <RoleCard
          userId={user.id}
          currentRoleId={role.id}
          currentIsOwner={role.grants_all}
          viewerIsOwner={viewer.isOwner}
          roles={templates.data.map((t) => ({ id: t.id, name: t.name, grantsAll: t.grants_all }))}
        />
      )}

      {canSeeCost && (
        <LaborCostCard
          userId={user.id}
          canEdit={canEditCost}
          defaultValue={centsToDollars(compensation.data?.hourly_cost_cents ?? null)}
        />
      )}

      <OverridesCard
        userId={user.id}
        isOwner={role.grants_all}
        canSee={canSeeOverrides}
        canEdit={canEditOverrides}
        overrides={overrideRows}
      />

      {canManage && !isSelf && (
        <StatusCard
          userId={user.id}
          name={user.full_name}
          active={user.is_active}
          reassignTo={(people.data ?? [])
            .filter((p) => p.is_active && p.id !== user.id)
            .map((p) => ({ id: p.id, name: p.full_name }))}
        />
      )}
    </div>
  );
}
