import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Option } from "@/lib/leads/service";

type Db = SupabaseClient<Database>;

/** Choices job screens need: admin-editable picklists, active users, territories. */
export type JobOptions = {
  picklists: Record<
    "work_type" | "hold_type" | "lost_reason" | "lead_source" | "lead_sub_source",
    Option[]
  >;
  users: Option[];
  territories: Option[];
};

const KEYS = ["work_type", "hold_type", "lost_reason", "lead_source", "lead_sub_source"] as const;

export async function loadJobOptions(db: Db): Promise<JobOptions> {
  const [lists, users, territories] = await Promise.all([
    db
      .from("picklists")
      .select("key, picklist_values(id, value, label, active, sort_order, parent_value_id)")
      .in("key", [...KEYS]),
    db.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    db.from("territories").select("id, name").eq("active", true).order("sort_order"),
  ]);
  const picklists = Object.fromEntries(
    KEYS.map((k) => [k, [] as Option[]]),
  ) as JobOptions["picklists"];
  const idToValue = new Map<string, string>();
  for (const l of lists.data ?? []) for (const v of l.picklist_values) idToValue.set(v.id, v.value);
  for (const l of lists.data ?? []) {
    const key = l.key as (typeof KEYS)[number];
    picklists[key] = [...l.picklist_values]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        value: v.value,
        label: v.label,
        active: v.active,
        parent: v.parent_value_id ? (idToValue.get(v.parent_value_id) ?? null) : null,
      }));
  }
  return {
    picklists,
    users: (users.data ?? []).map((u) => ({ value: u.id, label: u.full_name })),
    territories: (territories.data ?? []).map((t) => ({ value: t.id, label: t.name })),
  };
}

/** value → label lookup for a picklist (falls back to the raw key). */
export function labelFor(options: readonly Option[], value: string | null | undefined): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}
