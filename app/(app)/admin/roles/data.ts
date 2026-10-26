import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  PERMISSION_CATEGORIES,
  isPermission,
  type PermissionCategory,
  type Scope,
} from "@/lib/permissions";
import { type PackPermission, type PackView, type TemplateView } from "./model";

/**
 * Loads role templates and permission packs with the signed-in user's client,
 * so RLS decides what is visible (soft-deleted rows are filtered by policy).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function toCategory(value: string): PermissionCategory {
  return (PERMISSION_CATEGORIES as readonly string[]).includes(value)
    ? (value as PermissionCategory)
    : "core_records";
}

function toScope(value: string): Scope {
  return value === "own" || value === "team" ? value : "all";
}

function fail(what: string, error: { code?: string; message?: string }): never {
  throw new Error(`Could not load ${what} (${error.code ?? "unknown"}).`);
}

export async function loadRolesModel(): Promise<{
  templates: TemplateView[];
  packs: PackView[];
}> {
  const supabase = await createSupabaseServerClient();
  const [templatesRes, packsRes, packPermsRes, linksRes] = await Promise.all([
    supabase
      .from("role_templates")
      .select(
        "id, key, name, description, is_system, grants_all, requires_mfa, is_crew, sort_order",
      )
      .order("sort_order")
      .order("name"),
    supabase
      .from("permission_packs")
      .select("id, key, name, description, category, is_system, sort_order")
      .order("sort_order")
      .order("name"),
    supabase.from("pack_permissions").select("pack_id, permission, scope"),
    supabase.from("template_packs").select("template_id, pack_id"),
  ]);
  if (templatesRes.error) fail("role templates", templatesRes.error);
  if (packsRes.error) fail("permission packs", packsRes.error);
  if (packPermsRes.error) fail("pack permissions", packPermsRes.error);
  if (linksRes.error) fail("template packs", linksRes.error);

  const permsByPack = new Map<string, PackPermission[]>();
  for (const row of packPermsRes.data) {
    if (!isPermission(row.permission)) continue;
    const list = permsByPack.get(row.pack_id) ?? [];
    list.push({ permission: row.permission, scope: toScope(row.scope) });
    permsByPack.set(row.pack_id, list);
  }

  const packs: PackView[] = packsRes.data.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    category: toCategory(p.category),
    isSystem: p.is_system,
    permissions: permsByPack.get(p.id) ?? [],
  }));
  const livePacks = new Set(packs.map((p) => p.id));

  const packsByTemplate = new Map<string, string[]>();
  for (const link of linksRes.data) {
    if (!livePacks.has(link.pack_id)) continue;
    const list = packsByTemplate.get(link.template_id) ?? [];
    list.push(link.pack_id);
    packsByTemplate.set(link.template_id, list);
  }

  const templates: TemplateView[] = templatesRes.data.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    isSystem: t.is_system,
    grantsAll: t.grants_all,
    requiresMfa: t.requires_mfa,
    isCrew: t.is_crew,
    packIds: packsByTemplate.get(t.id) ?? [],
  }));

  return { templates, packs };
}

export type UserCounts = Map<string, { active: number; inactive: number }>;

/** Users per template (active and deactivated), counted on the server. */
export async function loadUserCounts(): Promise<UserCounts> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("role_template_id, is_active");
  if (error) fail("users", error);
  const counts: UserCounts = new Map();
  for (const row of data) {
    const c = counts.get(row.role_template_id) ?? { active: 0, inactive: 0 };
    if (row.is_active) c.active += 1;
    else c.inactive += 1;
    counts.set(row.role_template_id, c);
  }
  return counts;
}

export const USERS_PAGE_SIZE = 50;

export async function loadUsersPage(page: number) {
  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * USERS_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("profiles")
    .select("id, full_name, email, role_template_id, is_active", { count: "exact" })
    .order("is_active", { ascending: false })
    .order("full_name")
    .range(from, from + USERS_PAGE_SIZE - 1);
  if (error) fail("users", error);

  const ids = data.map((u) => u.id);
  const overrideCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: overrides, error: oErr } = await supabase
      .from("user_permission_overrides")
      .select("user_id")
      .in("user_id", ids);
    if (oErr) fail("permission overrides", oErr);
    for (const o of overrides)
      overrideCounts.set(o.user_id, (overrideCounts.get(o.user_id) ?? 0) + 1);
  }

  return {
    total: count ?? data.length,
    users: data.map((u) => ({
      id: u.id,
      name: u.full_name,
      email: u.email,
      templateId: u.role_template_id,
      active: u.is_active,
      overrides: overrideCounts.get(u.id) ?? 0,
    })),
  };
}
