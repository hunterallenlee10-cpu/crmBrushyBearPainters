import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { CustomFieldDef, CustomValue, CustomValues } from "@/lib/domain/custom-fields/types";

const TZ = "America/Los_Angeles";

/**
 * Custom field values: parse form input, check a value against its definition
 * (the same checks as `app.custom_value_error()` in the database), and format
 * for display. Pure.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function realDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isEmptyValue(v: CustomValue | undefined): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Null when `value` fits `def`, else a message ("Rooms: enter a number.").
 * `userIds`, when given, is the set of people in the company (user fields).
 */
export function checkCustomValue(
  def: Pick<CustomFieldDef, "label" | "type" | "options">,
  value: CustomValue | undefined,
  userIds?: ReadonlySet<string>,
): string | null {
  if (value === undefined || value === null) return null;
  const L = def.label;
  switch (def.type) {
    case "text":
    case "long_text":
    case "url":
    case "date":
    case "datetime":
    case "picklist":
    case "user": {
      if (typeof value !== "string") return `${L}: enter text.`;
      if (def.type === "text" && value.length > 500) return `${L}: 500 characters at most.`;
      if (def.type === "long_text" && value.length > 5000) return `${L}: 5,000 characters at most.`;
      if (def.type === "url" && (!URL_RE.test(value) || value.length > 500))
        return `${L}: enter a web address starting with http:// or https://.`;
      if (def.type === "date" && !ISO_DATE.test(value)) return `${L}: enter a date (YYYY-MM-DD).`;
      if (def.type === "date" && !realDate(value)) return `${L}: enter a real date.`;
      if (def.type === "datetime" && Number.isNaN(Date.parse(value)))
        return `${L}: enter a date and time.`;
      if (def.type === "picklist" && !def.options.some((o) => o.value === value))
        return `${L}: pick one of the listed options.`;
      if (def.type === "user" && (!UUID.test(value) || (userIds && !userIds.has(value))))
        return `${L}: pick a person in your company.`;
      return null;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${L}: enter a number.`;
    case "currency":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `${L}: enter an amount in cents.`;
    case "checkbox":
      return typeof value === "boolean" ? null : `${L}: pick yes or no.`;
    case "multi_picklist":
      return Array.isArray(value) &&
        value.every((v) => typeof v === "string" && def.options.some((o) => o.value === v))
        ? null
        : `${L}: pick from the listed options.`;
  }
}

/** Raw form input for one field: text box, checkbox, or several picks. */
export type CustomInput = string | boolean | string[] | null | undefined;

/**
 * Turns form input into the stored value. Empty input → null (clears the
 * field). Currency is typed in dollars ("1,250.50") and stored in cents.
 * Returns `{ error }` when the input can't be read.
 */
export function parseCustomInput(
  def: Pick<CustomFieldDef, "label" | "type" | "options">,
  input: CustomInput,
): { value: CustomValue } | { error: string } {
  if (def.type === "checkbox") {
    if (input === true || input === "true" || input === "on" || input === "yes")
      return { value: true };
    if (input === false || input === "false" || input === "no") return { value: false };
    if (input === null || input === undefined || input === "") return { value: null };
    return { error: `${def.label}: pick yes or no.` };
  }
  if (def.type === "multi_picklist") {
    const list = Array.isArray(input)
      ? input
      : typeof input === "string" && input.trim()
        ? input.split(/[,;|]/)
        : [];
    const values = [
      ...new Set(
        list
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => matchOption(def.options, v) ?? v),
      ),
    ];
    if (values.length === 0) return { value: null };
    const err = checkCustomValue(def, values);
    return err ? { error: err } : { value: values };
  }
  if (Array.isArray(input)) return { error: `${def.label}: enter one value.` };
  const s = typeof input === "string" ? input.trim() : input === true ? "true" : "";
  if (s === "") return { value: null };
  let value: CustomValue;
  switch (def.type) {
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { error: `${def.label}: enter a number.` };
      value = n;
      break;
    }
    case "currency": {
      const cleaned = s.replace(/[$,\s]/g, "");
      if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned))
        return { error: `${def.label}: enter a dollar amount.` };
      value = Math.round(Number(cleaned) * 100);
      break;
    }
    case "picklist":
      value = matchOption(def.options, s) ?? s;
      break;
    case "datetime": {
      // A local time from the form (no offset) is Pacific.
      const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
        ? fromZonedTime(s, TZ).getTime()
        : Date.parse(s);
      if (Number.isNaN(t)) return { error: `${def.label}: enter a date and time.` };
      value = new Date(t).toISOString();
      break;
    }
    case "date": {
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      value = us ? `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}` : s;
      break;
    }
    default:
      value = s;
  }
  const err = checkCustomValue(def, value);
  return err ? { error: err } : { value };
}

/** Option value for an input that may be the value or the label (case-insensitive). */
function matchOption(
  options: readonly { value: string; label: string }[],
  input: string,
): string | null {
  const lower = input.toLowerCase();
  return (
    options.find((o) => o.value === input)?.value ??
    options.find((o) => o.label.toLowerCase() === lower || o.value.toLowerCase() === lower)
      ?.value ??
    null
  );
}

/** Display text for a stored value ("—" when empty). */
export function formatCustomValue(
  def: Pick<CustomFieldDef, "type" | "options">,
  value: CustomValue | undefined,
  userNames?: ReadonlyMap<string, string>,
): string {
  if (isEmptyValue(value)) return "—";
  switch (def.type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "currency":
      return typeof value === "number"
        ? (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
        : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
    case "picklist":
      return def.options.find((o) => o.value === value)?.label ?? String(value);
    case "multi_picklist":
      return Array.isArray(value)
        ? value.map((v) => def.options.find((o) => o.value === v)?.label ?? v).join(", ")
        : String(value);
    case "user":
      return (typeof value === "string" && userNames?.get(value)) || "Unknown person";
    case "date": {
      if (typeof value !== "string" || !ISO_DATE.test(value)) return String(value);
      const [y, m, d] = value.split("-").map(Number) as [number, number, number];
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? new Date(value).toLocaleString("en-US", {
            timeZone: "America/Los_Angeles",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : String(value);
    default:
      return String(value);
  }
}

/** The value as form input (currency in dollars). */
export function toCustomInput(
  def: Pick<CustomFieldDef, "type">,
  value: CustomValue | undefined,
): CustomInput {
  if (value === undefined || value === null) return def.type === "multi_picklist" ? [] : "";
  if (def.type === "currency" && typeof value === "number") return (value / 100).toFixed(2);
  if (def.type === "checkbox") return value === true;
  if (def.type === "datetime" && typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return formatInTimeZone(new Date(value), TZ, "yyyy-MM-dd'T'HH:mm");
  if (Array.isArray(value)) return value;
  return String(value);
}

export type CustomFieldErrors = Record<string, string>;

/**
 * Parses and checks every input for the given definitions. Inactive fields
 * are ignored (their stored value stays). Required fields must be filled
 * (`enforceRequired`, on by default for forms). Returns the patch to store
 * (only the given fields) and any errors keyed by api name.
 */
export function readCustomInputs(
  defs: readonly CustomFieldDef[],
  inputs: Record<string, CustomInput>,
  options: { enforceRequired?: boolean; only?: readonly string[] } = {},
): { values: CustomValues; errors: CustomFieldErrors } {
  const enforce = options.enforceRequired ?? true;
  const values: CustomValues = {};
  const errors: CustomFieldErrors = {};
  for (const def of defs) {
    if (!def.active) continue;
    if (options.only && !options.only.includes(def.apiName)) continue;
    if (!(def.apiName in inputs) && !enforce) continue;
    const parsed = parseCustomInput(def, inputs[def.apiName]);
    if ("error" in parsed) {
      errors[def.apiName] = parsed.error;
      continue;
    }
    if (enforce && def.required && isEmptyValue(parsed.value)) {
      errors[def.apiName] = `${def.label} is required.`;
      continue;
    }
    values[def.apiName] = parsed.value;
  }
  return { values, errors };
}

/** Merges a patch into stored values; nulls remove the key (like the database). */
export function mergeCustomValues(stored: CustomValues, patch: CustomValues): CustomValues {
  const out: CustomValues = { ...stored };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}
