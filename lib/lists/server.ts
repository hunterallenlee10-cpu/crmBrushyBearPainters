import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { FieldDef, QueryOp } from "@/lib/lists/filters";
import type { ListModuleId, ViewConfig } from "@/lib/lists/params";
import type { SavedViewItem } from "@/components/lists/views-menu";
import type { Option } from "@/lib/leads/service";

/** Server-side helpers for list pages (filters, saved views, column choices). */

type Filterable<Q> = {
  filter(column: string, operator: string, value: unknown): Q;
  or(filters: string): Q;
};

/** Applies list filter instructions to a PostgREST query. */
export function applyOps<Q extends Filterable<Q>>(query: Q, ops: readonly QueryOp[]): Q {
  let q = query;
  for (const op of ops) {
    q = op.kind === "or" ? q.or(op.expr) : q.filter(op.column, op.op, op.value);
  }
  return q;
}

export async function loadSavedViews(
  db: SupabaseClient<Database>,
  module: ListModuleId,
  userId: string,
): Promise<SavedViewItem[]> {
  const { data } = await db
    .from("saved_views")
    .select("id, name, shared, user_id, config")
    .eq("module", module)
    .order("name");
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    shared: v.shared,
    mine: v.user_id === userId,
    config: (v.config ?? {}) as ViewConfig,
  }));
}

/** The user's saved column choice for a list (null = defaults). */
export async function loadColumnPrefs(
  db: SupabaseClient<Database>,
  userId: string,
  module: ListModuleId,
): Promise<string[] | null> {
  const { data } = await db.from("profiles").select("preferences").eq("id", userId).maybeSingle();
  const prefs = (data?.preferences ?? {}) as { list_columns?: Record<string, unknown> };
  const cols = prefs.list_columns?.[module];
  return Array.isArray(cols) && cols.every((c) => typeof c === "string")
    ? (cols as string[])
    : null;
}

/** Fills runtime option lists (picklists, users, territories) into field definitions. */
export function withOptions(
  fields: readonly FieldDef[],
  sources: { picklists: Record<string, Option[]>; users: Option[]; territories: Option[] },
): FieldDef[] {
  return fields.map((f) => {
    if (!f.optionSource) return f;
    if (f.optionSource === "users") return { ...f, options: sources.users };
    if (f.optionSource === "territories") return { ...f, options: sources.territories };
    const key = f.optionSource.replace(/^picklist:/, "");
    return {
      ...f,
      options: (sources.picklists[key] ?? []).map((o) => ({ value: o.value, label: o.label })),
    };
  });
}
