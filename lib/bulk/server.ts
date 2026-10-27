import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { loadCustomFields } from "@/lib/custom-fields/server";
import {
  BULK_FIELDS,
  planBulkUpdate,
  type BulkChanges,
  type BulkModule,
  type BulkRecord,
} from "@/lib/domain/bulk";
import {
  checkCustomValue,
  type CustomFieldDef,
  type CustomValue,
} from "@/lib/domain/custom-fields";

type Db = SupabaseClient<Database>;

const LABEL_SELECT: Record<BulkModule, string> = {
  leads: "first_name, last_name",
  jobs: "job_number, name",
  accounts: "display_name",
  contacts: "first_name, last_name",
};

function labelOf(module: BulkModule, r: Record<string, unknown>): string {
  if (module === "jobs") return `${r.job_number ?? ""} ${r.name ?? ""}`.trim();
  if (module === "accounts") return String(r.display_name ?? "");
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

/** The records (as the person can see them) with the fields a bulk update reads. */
export async function loadBulkRecords(
  db: Db,
  module: BulkModule,
  ids: readonly string[],
): Promise<BulkRecord[]> {
  const cols = [
    "id",
    LABEL_SELECT[module],
    ...BULK_FIELDS[module].map((f) => f.key),
    "custom_field_values",
  ].join(", ");
  const out: BulkRecord[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from(module)
      .select(cols)
      .in("id", ids.slice(i, i + 200))
      .is("deleted_at", null);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.push({ id: String(r.id), label: labelOf(module, r), values: r });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Problems with the requested values before anything is previewed (unknown option, person, type). */
export async function checkBulkValues(
  db: Db,
  module: BulkModule,
  changes: BulkChanges,
  custom: readonly CustomFieldDef[],
): Promise<string | null> {
  const users = new Set(
    ((await db.from("profiles").select("id").eq("is_active", true)).data ?? []).map((p) => p.id),
  );
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("cf:")) {
      const def = custom.find((d) => d.apiName === key.slice(3) && d.active);
      if (!def) return `"${key}" isn't an active custom field.`;
      const err = checkCustomValue(def, value as CustomValue, users);
      if (err) return err;
      continue;
    }
    const f = BULK_FIELDS[module].find((x) => x.key === key);
    if (!f) return `"${key}" can't be bulk updated.`;
    if (value === null || value === "") {
      if (!f.nullable) return `${f.label} can't be empty.`;
      continue;
    }
    if (f.kind === "user" && !users.has(String(value))) return `${f.label}: pick an active person.`;
    if (f.kind === "enum" && !f.options?.some((o) => o.value === value))
      return `${f.label}: pick one of the listed values.`;
    if (f.kind === "picklist") {
      const { data } = await db
        .from("picklist_values")
        .select("value, picklists!inner(key)")
        .eq("picklists.key", f.picklist!)
        .eq("value", String(value))
        .eq("active", true);
      if (!data?.length) return `${f.label}: "${value}" isn't in the picklist.`;
    }
    if (f.kind === "number" && (typeof value !== "number" || !Number.isFinite(value)))
      return `${f.label}: enter a number.`;
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
      return `${f.label}: enter a date (YYYY-MM-DD).`;
    if (f.kind === "territory") {
      const { data } = await db.from("territories").select("id").eq("id", String(value));
      if (!data?.length) return `${f.label}: pick a territory.`;
    }
  }
  return null;
}

/** Writes the preview (bulk_updates + one row per record). Nothing on the records changes. */
export async function savePreview(
  db: Db,
  orgId: string,
  input: {
    module: BulkModule;
    source: "selection" | "csv";
    title: string;
    changes: BulkChanges;
    records: BulkRecord[];
    changesFor: (r: BulkRecord) => BulkChanges;
    customApiNames: string[];
    missing?: { label: string; error: string }[];
  },
): Promise<string> {
  const plan = planBulkUpdate(input.module, input.records, input.changesFor, input.customApiNames);
  const { data: bu, error } = await db
    .from("bulk_updates")
    .insert({
      org_id: orgId,
      module: input.module,
      source: input.source,
      title: input.title,
      changes: input.changes as { [key: string]: Json },
      total_rows: plan.length + (input.missing?.length ?? 0),
      changed_rows: plan.filter((p) => p.status === "pending").length,
    })
    .select("id")
    .single();
  if (error || !bu) throw error ?? new Error("bulk_updates insert failed");
  const rows = [
    ...plan.map((p) => ({
      org_id: orgId,
      bulk_update_id: bu.id,
      row_number: p.rowNumber,
      record_id: p.recordId,
      label: p.label.slice(0, 200),
      before: p.before as { [key: string]: Json },
      after: p.after as { [key: string]: Json },
      status: p.status,
      error: p.error,
    })),
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await db.from("bulk_update_rows").insert(rows.slice(i, i + 500));
    if (e) throw e;
  }
  return bu.id;
}

export { loadCustomFields };
