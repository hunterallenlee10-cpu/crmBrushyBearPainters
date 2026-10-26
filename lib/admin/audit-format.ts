import { z } from "zod";
import { isIsoDate } from "@/lib/admin/pacific";

/**
 * Pure helpers for Admin → Audit Log (SPEC §5 audit_log, §13.1 append-only):
 * plain-English table and action labels, one-line change summaries, field
 * diffs, search-param filters and keyset pagination on `id desc`.
 */

export const AUDIT_PAGE_SIZE = 50;

export type AuditAction = "insert" | "update" | "delete";

export const AUDIT_ACTIONS: readonly { value: AuditAction; label: string }[] = [
  { value: "insert", label: "Created" },
  { value: "update", label: "Changed" },
  { value: "delete", label: "Deleted" },
];

type TableLabel = {
  plural: string;
  singular: string;
  /** One row per org: no record name in summaries. */ singleton?: boolean;
};

/** Every table the audit trigger covers today, in plain English. Unknown tables fall back to a humanized name. */
export const AUDIT_TABLES: Readonly<Record<string, TableLabel>> = {
  "public.company_settings": {
    plural: "Company settings",
    singular: "Company settings",
    singleton: true,
  },
  "public.profiles": { plural: "Users", singular: "User" },
  "public.profile_compensation": { plural: "User pay rates", singular: "User pay rate" },
  "public.user_permission_overrides": {
    plural: "User permission grants",
    singular: "User permission grant",
  },
  "public.role_templates": { plural: "Role templates", singular: "Role template" },
  "public.permission_packs": { plural: "Permission packs", singular: "Permission pack" },
  "public.pack_permissions": { plural: "Permissions in packs", singular: "Permission in a pack" },
  "public.template_packs": {
    plural: "Packs on role templates",
    singular: "Pack on a role template",
  },
  "public.territories": { plural: "Territories", singular: "Territory" },
  "public.picklists": { plural: "Picklists", singular: "Picklist" },
  "public.picklist_values": { plural: "Picklist values", singular: "Picklist value" },
  "public.integration_connections": { plural: "Integrations", singular: "Integration" },
  "public.organizations": { plural: "Organization", singular: "Organization", singleton: true },
  "app.impersonation_sessions": { plural: "View as user", singular: "View as user session" },
};

function humanize(tableName: string): string {
  const bare = tableName.includes(".") ? tableName.slice(tableName.indexOf(".") + 1) : tableName;
  const words = bare.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : tableName;
}

/** Plural label for filters, e.g. `public.picklist_values` → "Picklist values". */
export function tableLabel(tableName: string): string {
  return AUDIT_TABLES[tableName]?.plural ?? humanize(tableName);
}

/** Singular label for summaries, e.g. `public.profiles` → "User". */
export function tableSingular(tableName: string): string {
  return AUDIT_TABLES[tableName]?.singular ?? humanize(tableName);
}

/** Options for the Table filter, sorted by label. Includes `current` if it's an unlisted table. */
export function auditTableOptions(current?: string): { value: string; label: string }[] {
  const keys = Object.keys(AUDIT_TABLES);
  if (current && !keys.includes(current)) keys.push(current);
  return keys
    .map((value) => ({ value, label: tableLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function actionLabel(action: string): string {
  return AUDIT_ACTIONS.find((a) => a.value === action)?.label ?? action;
}

// ---------------------------------------------------------------------------
// Entries, names, summaries
// ---------------------------------------------------------------------------

export type JsonObject = { [key: string]: unknown };

export type AuditEntry = {
  id: number;
  at: string;
  table_name: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  impersonated_by: string | null;
  before: unknown;
  after: unknown;
  changed_fields: string[] | null;
};

/** user id → display name. */
export type NameLookup = ReadonlyMap<string, string>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function nameOf(names: NameLookup, id: string): string {
  return names.get(id) ?? "Unknown user";
}

/** "System" (no actor), the actor's name, or "Hunter Lee viewing as Pat Painter". */
export function actorLabel(
  actorId: string | null,
  impersonatedBy: string | null,
  names: NameLookup,
): string {
  if (impersonatedBy) {
    const actor = actorId ? nameOf(names, actorId) : "another user";
    return `${nameOf(names, impersonatedBy)} viewing as ${actor}`;
  }
  return actorId ? nameOf(names, actorId) : "System";
}

/** Bookkeeping columns never shown in summaries or diffs of a change. */
export const HIDDEN_CHANGE_FIELDS: readonly string[] = ["updated_at", "updated_by"];
/** Extra columns hidden when showing a whole created/deleted row. */
const HIDDEN_ROW_FIELDS: readonly string[] = [
  ...HIDDEN_CHANGE_FIELDS,
  "id",
  "org_id",
  "created_at",
  "created_by",
];

/** Changed column names for an update (trigger's list, or computed), minus bookkeeping columns. */
export function changedFields(
  entry: Pick<AuditEntry, "before" | "after" | "changed_fields">,
): string[] {
  let fields = entry.changed_fields;
  if (!fields) {
    const before = asObject(entry.before) ?? {};
    const after = asObject(entry.after) ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    fields = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
  }
  return fields.filter((f) => !HIDDEN_CHANGE_FIELDS.includes(f));
}

const NAME_KEYS = ["label", "name", "full_name", "title", "key"] as const;
const MAX_HINT = 60;

/** A human name for the record from its row (label, name, full_name…), quoted. */
function recordHint(entry: AuditEntry): string {
  if (AUDIT_TABLES[entry.table_name]?.singleton) return "";
  const row = asObject(entry.after) ?? asObject(entry.before);
  if (!row) return "";
  for (const key of NAME_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) {
      const t = v.trim();
      return ` “${t.length > MAX_HINT ? `${t.slice(0, MAX_HINT - 1)}…` : t}”`;
    }
  }
  return "";
}

function listFields(fields: readonly string[], max = 6): string {
  if (fields.length <= max) return fields.join(", ");
  return `${fields.slice(0, max).join(", ")} and ${fields.length - max} more`;
}

/** One line, e.g. "Changed Company settings: phone, hours_text". */
export function summarizeAuditEntry(entry: AuditEntry, names: NameLookup): string {
  const singular = tableSingular(entry.table_name);

  if (entry.table_name === "app.impersonation_sessions") {
    const after = asObject(entry.after);
    const target =
      typeof after?.target_user_id === "string" ? nameOf(names, after.target_user_id) : "a user";
    if (after?.event === "view_as_started") return `Started viewing as ${target}`;
    if (after?.event === "view_as_ended") return `Stopped viewing as ${target}`;
  }

  const hint = recordHint(entry);
  switch (entry.action) {
    case "insert":
      return `Created ${singular}${hint}`;
    case "delete":
      return `Deleted ${singular}${hint}`;
    case "update": {
      const fields = changedFields(entry);
      if (fields.includes("deleted_at")) {
        const after = asObject(entry.after);
        return after?.deleted_at
          ? `Moved ${singular}${hint} to Deleted Records`
          : `Restored ${singular}${hint} from Deleted Records`;
      }
      return fields.length
        ? `Changed ${singular}${hint}: ${listFields(fields)}`
        : `Changed ${singular}${hint}`;
    }
    default:
      return `${actionLabel(entry.action)} ${singular}${hint}`;
  }
}

// ---------------------------------------------------------------------------
// Field diff
// ---------------------------------------------------------------------------

export const EMPTY_VALUE = "—";
export const MAX_VALUE_LENGTH = 160;

/** Display string for one JSON value; long values are cut with "…". */
export function formatAuditValue(value: unknown, max = MAX_VALUE_LENGTH): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type FieldChange = { field: string; before: string; after: string };

/**
 * Before/after pairs: an update shows only the changed fields (no
 * updated_at/updated_by); a create or delete shows the row's own fields.
 */
export function diffAuditEntry(entry: AuditEntry, max = MAX_VALUE_LENGTH): FieldChange[] {
  const before = asObject(entry.before) ?? {};
  const after = asObject(entry.after) ?? {};
  let fields: string[];
  if (entry.action === "update") {
    fields = changedFields(entry);
  } else {
    const row = entry.action === "delete" ? before : after;
    fields = Object.keys(row)
      .filter((k) => !HIDDEN_ROW_FIELDS.includes(k))
      .filter((k) => row[k] !== null && row[k] !== undefined)
      .sort();
  }
  return fields.map((field) => ({
    field,
    before: entry.action === "insert" ? EMPTY_VALUE : formatAuditValue(before[field], max),
    after: entry.action === "delete" ? EMPTY_VALUE : formatAuditValue(after[field], max),
  }));
}

// ---------------------------------------------------------------------------
// Filters (search params) and keyset pagination
// ---------------------------------------------------------------------------

export type SearchParams = Record<string, string | string[] | undefined>;

export type AuditFilters = {
  table?: string;
  action?: AuditAction;
  actor?: string;
  from?: string;
  to?: string;
  record?: string;
};

export type AuditCursor = { before?: number; after?: number };

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

const tableSchema = z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
const actionSchema = z.enum(["insert", "update", "delete"]);
const uuidSchema = z.uuid();
const recordSchema = z.string().max(100);
const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

function pick<T>(schema: z.ZodType<T>, value: string | undefined): T | undefined {
  if (value === undefined) return undefined;
  const r = schema.safeParse(value);
  return r.success ? r.data : undefined;
}

/** Reads filters + cursor from the URL. Invalid values are dropped (never trusted into a query). */
export function parseAuditSearchParams(params: SearchParams): {
  filters: AuditFilters;
  cursor: AuditCursor;
} {
  const filters: AuditFilters = {};
  const table = pick(tableSchema, first(params.table));
  if (table) filters.table = table;
  const action = pick(actionSchema, first(params.action));
  if (action) filters.action = action;
  const actor = pick(uuidSchema, first(params.actor));
  if (actor) filters.actor = actor;
  const from = first(params.from);
  if (from && isIsoDate(from)) filters.from = from;
  const to = first(params.to);
  if (to && isIsoDate(to)) filters.to = to;
  const record = pick(recordSchema, first(params.record));
  if (record) filters.record = record;

  const cursor: AuditCursor = {};
  const before = pick(idSchema, first(params.before));
  const after = pick(idSchema, first(params.after));
  if (before !== undefined) cursor.before = before;
  else if (after !== undefined) cursor.after = after;
  return { filters, cursor };
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return Object.values(filters).some((v) => v !== undefined);
}

/** `/admin/audit-log?…` keeping the filters, with an optional cursor. */
export function auditLogHref(filters: AuditFilters, cursor: AuditCursor = {}): string {
  const sp = new URLSearchParams();
  for (const key of ["table", "action", "actor", "from", "to", "record"] as const) {
    const v = filters[key];
    if (v) sp.set(key, v);
  }
  if (cursor.before !== undefined) sp.set("before", String(cursor.before));
  else if (cursor.after !== undefined) sp.set("after", String(cursor.after));
  const qs = sp.toString();
  return qs ? `/admin/audit-log?${qs}` : "/admin/audit-log";
}

export type KeysetPlan = {
  /** Sort by id ascending (only when paging toward newer rows). */
  ascending: boolean;
  ltId?: number;
  gtId?: number;
  /** One extra row tells us whether another page exists. */
  limit: number;
};

/** How to query one page: newest first by default; `before` = older rows; `after` = newer rows. */
export function planAuditPage(cursor: AuditCursor, pageSize = AUDIT_PAGE_SIZE): KeysetPlan {
  if (cursor.before !== undefined)
    return { ascending: false, ltId: cursor.before, limit: pageSize + 1 };
  if (cursor.after !== undefined)
    return { ascending: true, gtId: cursor.after, limit: pageSize + 1 };
  return { ascending: false, limit: pageSize + 1 };
}

/**
 * Turns the fetched rows (up to pageSize + 1, in the plan's order) into one page
 * newest-first, plus cursors for the Newer / Older links (null = no link).
 */
export function paginateAudit<T extends { id: number }>(
  fetched: readonly T[],
  cursor: AuditCursor,
  pageSize = AUDIT_PAGE_SIZE,
): { rows: T[]; newer: AuditCursor | null; older: AuditCursor | null } {
  const hasExtra = fetched.length > pageSize;
  const page = fetched.slice(0, pageSize);

  if (cursor.after !== undefined) {
    // Fetched ascending from the cursor; show newest first.
    const rows = [...page].reverse();
    const newest = rows[0];
    const oldest = rows[rows.length - 1];
    return {
      rows,
      newer: hasExtra && newest ? { after: newest.id } : null,
      older: oldest ? { before: oldest.id } : { before: cursor.after + 1 },
    };
  }

  const rows = [...page];
  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  return {
    rows,
    newer:
      cursor.before !== undefined
        ? newest
          ? { after: newest.id }
          : { after: cursor.before - 1 }
        : null,
    older: hasExtra && oldest ? { before: oldest.id } : null,
  };
}
