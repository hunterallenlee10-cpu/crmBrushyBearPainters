/**
 * Module Manager (SPEC §5.9, §8.19): custom fields per module. Pure types and
 * catalogs; the database stores definitions in `custom_field_definitions` and
 * values in each module's `custom_field_values` jsonb (keyed by api_name).
 */

export const CUSTOM_FIELD_MODULES = ["leads", "jobs", "accounts", "contacts"] as const;
export type CustomFieldModule = (typeof CUSTOM_FIELD_MODULES)[number];

export const CUSTOM_FIELD_MODULE_LABELS: Record<CustomFieldModule, string> = {
  leads: "Leads",
  jobs: "Jobs",
  accounts: "Accounts",
  contacts: "Contacts",
};

/** SPEC §5.9 types. */
export const CUSTOM_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "checkbox",
  "picklist",
  "multi_picklist",
  "user",
  "url",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency ($)",
  date: "Date",
  datetime: "Date and time",
  checkbox: "Checkbox (yes / no)",
  picklist: "Picklist (one)",
  multi_picklist: "Picklist (several)",
  user: "Person",
  url: "Web address",
};

export type CustomFieldOption = { value: string; label: string };

export type CustomFieldDef = {
  id: string;
  module: CustomFieldModule;
  apiName: string;
  label: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  helpText: string | null;
  showInList: boolean;
  sortOrder: number;
  active: boolean;
};

/** A stored custom value (JSON). Currency is integer cents; dates are YYYY-MM-DD. */
export type CustomValue = string | number | boolean | string[] | null;
export type CustomValues = Record<string, CustomValue>;

export const API_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const OPTION_VALUE_PATTERN = /^[a-z0-9][a-z0-9_]{0,59}$/;

/** "Paint brand preference!" → "paint_brand_preference" (a valid api name or ""). */
export function toApiName(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return API_NAME_PATTERN.test(base) ? base : "";
}

/** Option value from its label (same rules as api names, digits allowed first). */
export function toOptionValue(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/, "");
}

/** Parses a database row (snake_case) into a definition; null when it isn't one. */
export function toCustomFieldDef(row: {
  id: string;
  module: string;
  api_name: string;
  label: string;
  field_type: string;
  options: unknown;
  required: boolean;
  help_text: string | null;
  show_in_list: boolean;
  sort_order: number;
  active: boolean;
}): CustomFieldDef | null {
  const mod = CUSTOM_FIELD_MODULES.find((m) => m === row.module);
  const type = CUSTOM_FIELD_TYPES.find((t) => t === row.field_type);
  if (!mod || !type) return null;
  const options = Array.isArray(row.options)
    ? row.options.flatMap((o: unknown) => {
        if (!o || typeof o !== "object") return [];
        const { value, label } = o as Record<string, unknown>;
        return typeof value === "string" && typeof label === "string" ? [{ value, label }] : [];
      })
    : [];
  return {
    id: row.id,
    module: mod,
    apiName: row.api_name,
    label: row.label,
    type,
    options,
    required: row.required,
    helpText: row.help_text,
    showInList: row.show_in_list,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

/** Reads a record's custom_field_values jsonb into a plain object. */
export function toCustomValues(raw: unknown): CustomValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CustomValues = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      (Array.isArray(v) && v.every((x) => typeof x === "string"))
    ) {
      out[k] = v as CustomValue;
    }
  }
  return out;
}
