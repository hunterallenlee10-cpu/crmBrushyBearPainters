import {
  customColumnId,
  formatCustomValue,
  isEmptyValue,
  toCustomValues,
  type CustomFieldDef,
} from "@/lib/domain/custom-fields";

/** List cells for custom field columns (`cf_<api_name>`). */
export function customCells(
  defs: readonly CustomFieldDef[],
  raw: unknown,
  userNames?: ReadonlyMap<string, string>,
): Record<string, React.ReactNode> {
  const values = toCustomValues(raw);
  const out: Record<string, React.ReactNode> = {};
  for (const d of defs) {
    if (!d.active) continue;
    const v = values[d.apiName];
    out[customColumnId(d.apiName)] = isEmptyValue(v) ? null : (
      <span className="text-xs">{formatCustomValue(d, v, userNames)}</span>
    );
  }
  return out;
}
