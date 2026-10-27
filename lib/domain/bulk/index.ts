import type { CustomValue, CustomValues } from "@/lib/domain/custom-fields/types";

/**
 * Bulk Update (SPEC §8.19, §19): preview first → apply → revert. Pure
 * planning: which fields may change per module (the same list as
 * `app.bulk_fields()`), the before/after of every row, and CSV rows turned
 * into per-record patches. Applying and reverting run in the database
 * (`bulk_update_apply` / `bulk_update_revert`) as the person, so row security,
 * guards and the audit log apply to each change. Stage never changes here.
 */

export const BULK_MODULES = ["leads", "jobs", "accounts", "contacts"] as const;
export type BulkModule = (typeof BULK_MODULES)[number];

export type BulkFieldKind =
  "user" | "picklist" | "enum" | "text" | "date" | "number" | "tags" | "territory";

export type BulkField = {
  key: string;
  label: string;
  kind: BulkFieldKind;
  /** Picklist key for kind "picklist". */
  picklist?: string;
  /** Fixed choices for kind "enum". */
  options?: readonly { value: string; label: string }[];
  /** Can be cleared (set to empty). */
  nullable: boolean;
};

const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "nurture", label: "Nurture" },
  { value: "unqualified", label: "Unqualified" },
] as const;

/** Must agree with `app.bulk_fields()` in the Phase 10 migration. */
export const BULK_FIELDS: Record<BulkModule, readonly BulkField[]> = {
  leads: [
    { key: "owner_id", label: "Owner", kind: "user", nullable: true },
    { key: "point_of_contact_id", label: "Point of contact", kind: "user", nullable: true },
    {
      key: "lead_source",
      label: "Lead source",
      kind: "picklist",
      picklist: "lead_source",
      nullable: false,
    },
    {
      key: "lead_sub_source",
      label: "Sub-source",
      kind: "picklist",
      picklist: "lead_sub_source",
      nullable: true,
    },
    {
      key: "disposition",
      label: "Disposition",
      kind: "picklist",
      picklist: "lead_disposition",
      nullable: true,
    },
    {
      key: "timeline",
      label: "Timeline",
      kind: "enum",
      options: [
        { value: "asap", label: "As soon as possible" },
        { value: "1_3_months", label: "In 1–3 months" },
        { value: "3_plus_months", label: "3+ months out" },
        { value: "just_planning", label: "Just planning" },
      ],
      nullable: true,
    },
    { key: "status", label: "Status", kind: "enum", options: LEAD_STATUS_OPTIONS, nullable: false },
    { key: "nurture_until", label: "Check back on", kind: "date", nullable: true },
  ],
  jobs: [
    { key: "owner_id", label: "Owner (estimator)", kind: "user", nullable: true },
    { key: "point_of_contact_id", label: "Point of contact", kind: "user", nullable: true },
    { key: "project_manager_id", label: "Project manager", kind: "user", nullable: true },
    {
      key: "priority",
      label: "Priority",
      kind: "enum",
      options: [
        { value: "normal", label: "Normal" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
      nullable: false,
    },
    { key: "priority_reason", label: "Priority reason", kind: "text", nullable: true },
    { key: "target_season", label: "Target season (year)", kind: "number", nullable: true },
    { key: "tags", label: "Tags", kind: "tags", nullable: false },
    {
      key: "lead_source",
      label: "Lead source",
      kind: "picklist",
      picklist: "lead_source",
      nullable: true,
    },
    {
      key: "lead_sub_source",
      label: "Sub-source",
      kind: "picklist",
      picklist: "lead_sub_source",
      nullable: true,
    },
    {
      key: "estimated_duration_days",
      label: "Estimated duration (days)",
      kind: "number",
      nullable: true,
    },
  ],
  accounts: [
    {
      key: "account_type",
      label: "Type",
      kind: "enum",
      options: [
        { value: "residential", label: "Residential" },
        { value: "property_manager", label: "Property manager" },
        { value: "hoa", label: "HOA" },
        { value: "commercial", label: "Commercial" },
      ],
      nullable: false,
    },
    {
      key: "status",
      label: "Status",
      kind: "enum",
      options: [
        { value: "prospect", label: "Prospect" },
        { value: "active_customer", label: "Active customer" },
        { value: "past_customer", label: "Past customer" },
        { value: "inactive", label: "Inactive" },
      ],
      nullable: false,
    },
    { key: "owner_id", label: "Owner", kind: "user", nullable: true },
    { key: "territory_id", label: "Territory", kind: "territory", nullable: true },
    { key: "tags", label: "Tags", kind: "tags", nullable: false },
  ],
  contacts: [
    {
      key: "role",
      label: "Role on account",
      kind: "enum",
      options: [
        { value: "primary", label: "Primary" },
        { value: "spouse_partner", label: "Spouse / partner" },
        { value: "property_manager", label: "Property manager" },
        { value: "tenant", label: "Tenant" },
        { value: "billing", label: "Billing" },
        { value: "other", label: "Other" },
      ],
      nullable: false,
    },
    {
      key: "preferred_channel",
      label: "Preferred channel",
      kind: "enum",
      options: [
        { value: "sms", label: "Text" },
        { value: "email", label: "Email" },
        { value: "call", label: "Call" },
      ],
      nullable: true,
    },
    { key: "language", label: "Language", kind: "text", nullable: true },
  ],
};

export const MAX_BULK_ROWS = 2000;

/** Value stored for a field: text, number, list (tags) or null. */
export type BulkValue = string | number | string[] | null;

/** A patch: standard fields plus custom values under custom_field_values. */
export type BulkPatch = Record<string, BulkValue> & { custom_field_values?: CustomValues };

/** The changes a person asked for: standard keys or "cf:<api_name>" keys. */
export type BulkChanges = Record<string, BulkValue | CustomValue>;

export type BulkRecord = {
  id: string;
  label: string;
  values: Record<string, unknown> & { custom_field_values?: unknown };
};

export type BulkPlanRow = {
  rowNumber: number;
  recordId: string;
  label: string;
  before: BulkPatch;
  after: BulkPatch;
  /** Fields that actually change ("owner_id", "cf:rooms"). */
  changed: string[];
  status: "pending" | "unchanged" | "error";
  error: string | null;
};

function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Is this key a field a bulk update may set on the module? */
export function isBulkKey(
  module: BulkModule,
  key: string,
  customApiNames: readonly string[],
): boolean {
  if (key.startsWith("cf:")) return customApiNames.includes(key.slice(3));
  return BULK_FIELDS[module].some((f) => f.key === key);
}

/**
 * Builds the preview for one set of changes per record. Rows whose values
 * already match are "unchanged" (nothing is written for them). Unknown keys
 * make the row an error.
 */
export function planBulkUpdate(
  module: BulkModule,
  records: readonly BulkRecord[],
  changesFor: (record: BulkRecord) => BulkChanges,
  customApiNames: readonly string[],
): BulkPlanRow[] {
  return records.slice(0, MAX_BULK_ROWS).map((record, i) => {
    const changes = changesFor(record);
    const before: BulkPatch = {};
    const after: BulkPatch = {};
    const changed: string[] = [];
    let error: string | null = null;
    const storedCf =
      record.values.custom_field_values && typeof record.values.custom_field_values === "object"
        ? (record.values.custom_field_values as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(changes)) {
      if (!isBulkKey(module, key, customApiNames)) {
        error = `"${key}" can't be bulk updated.`;
        continue;
      }
      if (key.startsWith("cf:")) {
        const api = key.slice(3);
        const prev = (storedCf[api] ?? null) as CustomValue;
        if (same(prev, value)) continue;
        (before.custom_field_values ??= {})[api] = prev;
        (after.custom_field_values ??= {})[api] = (value ?? null) as CustomValue;
        changed.push(key);
      } else {
        const prev = (record.values[key] ?? null) as BulkValue;
        if (same(prev, value)) continue;
        before[key] = prev;
        after[key] = (value ?? null) as BulkValue;
        changed.push(key);
      }
    }
    return {
      rowNumber: i + 1,
      recordId: record.id,
      label: record.label,
      before,
      after,
      changed,
      status: error ? "error" : changed.length ? "pending" : "unchanged",
      error,
    };
  });
}

export type BulkCsvParse = {
  /** Header → field key ("id" for the record id column). */
  columns: { header: string; key: string | null }[];
  rows: { rowNumber: number; id: string | null; changes: BulkChanges; error: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CSV mode: the first column named "id" (the record id, as exported from the
 * list) says which record; every other column whose header is a bulk field
 * key or label (or "cf:<api_name>" / a custom field's label) is a change.
 * Empty cells mean "leave as is"; the text "(clear)" empties a field.
 */
export function parseBulkCsv(
  module: BulkModule,
  header: readonly string[],
  body: readonly (readonly string[])[],
  custom: readonly { apiName: string; label: string }[],
): BulkCsvParse {
  const fields = BULK_FIELDS[module];
  const columns = header.map((h) => {
    const t = h.trim();
    const lower = t.toLowerCase();
    if (lower === "id" || lower === "record id") return { header: h, key: "id" };
    const f = fields.find((x) => x.key === t || x.label.toLowerCase() === lower);
    if (f) return { header: h, key: f.key };
    const c = custom.find(
      (x) => `cf:${x.apiName}` === t || x.apiName === t || x.label.toLowerCase() === lower,
    );
    return { header: h, key: c ? `cf:${c.apiName}` : null };
  });
  const idCol = columns.findIndex((c) => c.key === "id");
  const rows = body.slice(0, MAX_BULK_ROWS).map((cells, i) => {
    const id = idCol >= 0 ? (cells[idCol] ?? "").trim() : "";
    const changes: BulkChanges = {};
    columns.forEach((c, j) => {
      if (!c.key || c.key === "id") return;
      const raw = (cells[j] ?? "").trim();
      if (raw === "") return;
      if (raw.toLowerCase() === "(clear)") {
        changes[c.key] = null;
        return;
      }
      const f = fields.find((x) => x.key === c.key);
      if (f?.kind === "tags") {
        changes[c.key] = raw
          .split(/[,;|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      } else if (f?.kind === "number") {
        const n = Number(raw);
        changes[c.key] = Number.isFinite(n) ? n : raw;
      } else {
        changes[c.key] = raw;
      }
    });
    const error =
      idCol < 0
        ? "Add an id column (export the list to get it)."
        : !UUID.test(id)
          ? "This row has no valid record id."
          : null;
    return { rowNumber: i + 1, id: UUID.test(id) ? id.toLowerCase() : null, changes, error };
  });
  return { columns, rows };
}

/** Counts for the preview header. */
export function summarizePlan(rows: readonly BulkPlanRow[]): {
  total: number;
  changed: number;
  unchanged: number;
  errors: number;
} {
  return {
    total: rows.length,
    changed: rows.filter((r) => r.status === "pending").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
    errors: rows.filter((r) => r.status === "error").length,
  };
}
