import type { FieldDef } from "@/lib/lists/filters";
import type { ColumnDef, ListModule } from "@/lib/lists/params";
import type { CustomFieldDef } from "@/lib/domain/custom-fields/types";

/**
 * Custom fields in lists (Columns picker + Advanced filter). Each active
 * field becomes a column `cf_<api_name>` (shown by default when the field is
 * marked "show in list") and, for types PostgREST can compare on a JSON path,
 * a filter field. Text compares `custom_field_values->>key`; numbers and
 * yes/no compare the JSON value (`->`), so 10 sorts after 9.
 */

export function customColumnId(apiName: string): string {
  return `cf_${apiName}`;
}

/** The PostgREST column for a custom value (text or JSON). */
export function customColumnPath(def: Pick<CustomFieldDef, "apiName" | "type">): string {
  const asJson = def.type === "number" || def.type === "currency" || def.type === "checkbox";
  return `custom_field_values${asJson ? "->" : "->>"}${def.apiName}`;
}

/** Filter field for a custom field, or null when the type isn't filterable in lists. */
export function customFilterField(def: CustomFieldDef): FieldDef | null {
  const base = {
    key: customColumnId(def.apiName),
    label: def.label,
    column: customColumnPath(def),
  };
  switch (def.type) {
    case "text":
    case "long_text":
    case "url":
      return { ...base, type: "text" };
    case "number":
      return { ...base, type: "number" };
    case "checkbox":
      return { ...base, type: "boolean" };
    case "picklist":
      return { ...base, type: "enum", options: def.options };
    case "user":
      return { ...base, type: "user", optionSource: "users" };
    default:
      // Dates, currency in cents and multi-picklists aren't filterable in lists
      // (JSON text compares wouldn't match the date filters' Pacific days).
      return null;
  }
}

export function customColumn(def: CustomFieldDef): ColumnDef {
  return {
    id: customColumnId(def.apiName),
    label: def.label,
    defaultVisible: def.showInList,
    sortColumn: def.type === "multi_picklist" ? undefined : customColumnPath(def),
  };
}

/** The list module with the company's active custom fields added. */
export function withCustomFields(mod: ListModule, defs: readonly CustomFieldDef[]): ListModule {
  const active = defs.filter((d) => d.active).sort((a, b) => a.sortOrder - b.sortOrder);
  if (active.length === 0) return mod;
  return {
    ...mod,
    fields: [...mod.fields, ...active.flatMap((d) => customFilterField(d) ?? [])],
    columns: [...mod.columns, ...active.map(customColumn)],
  };
}
