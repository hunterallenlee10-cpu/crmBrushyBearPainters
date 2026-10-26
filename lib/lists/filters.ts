import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";

/** Business days are Pacific days (timestamps are stored in UTC). */
const TZ = "America/Los_Angeles";

/**
 * Advanced filter model for every list (SPEC §8 "Lists"): Match ALL/ANY;
 * field · operator · value rules. Pure: validates rules against a module's
 * field definitions and turns them into PostgREST filter expressions. Only
 * whitelisted columns and operators ever reach the database.
 */

export const FIELD_TYPES = ["text", "number", "date", "enum", "user", "array", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const OPERATORS = [
  "contains",
  "equals",
  "not_equals",
  "is_empty",
  "is_not_empty",
  "gt",
  "lt",
  "between",
  "in_last_days",
  "in",
] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  equals: "equals",
  not_equals: "does not equal",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  gt: "is greater than",
  lt: "is less than",
  between: "is between",
  in_last_days: "in the last N days",
  in: "is any of",
};

/** Date fields read gt/lt as after/before. */
export const DATE_OPERATOR_LABELS: Partial<Record<Operator, string>> = {
  gt: "is after",
  lt: "is before",
};

export const OPERATORS_BY_TYPE: Record<FieldType, readonly Operator[]> = {
  text: ["contains", "equals", "not_equals", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "gt", "lt", "between", "is_empty", "is_not_empty"],
  date: ["gt", "lt", "between", "in_last_days", "is_empty", "is_not_empty"],
  enum: ["equals", "not_equals", "in", "is_empty", "is_not_empty"],
  user: ["equals", "not_equals", "in", "is_empty", "is_not_empty"],
  array: ["contains", "is_empty", "is_not_empty"],
  boolean: ["equals"],
};

export const NO_VALUE_OPERATORS: readonly Operator[] = ["is_empty", "is_not_empty"];

export type FieldOption = { value: string; label: string };

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  /** Database column. Text "contains" may search a different (lowercased) column. */
  column: string;
  searchColumn?: string;
  /** For enum/user/array fields; loaded at runtime for picklists and users. */
  options?: readonly FieldOption[];
  /** Name of a runtime option source ("picklist:lead_source", "users", "territories"). */
  optionSource?: string;
};

export const ruleSchema = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.array(z.string().max(200)).max(50)]).optional(),
  value2: z.string().max(500).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const filterSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(ruleSchema).max(20).default([]),
});
export type FilterSpec = z.infer<typeof filterSchema>;

export const EMPTY_FILTER: FilterSpec = { match: "all", rules: [] };

/** A filter expression tree rendered to PostgREST. */
export type Expr =
  | { type: "leaf"; column: string; op: string; value: string }
  | { type: "and" | "or"; items: Expr[] };

export type RuleError = { index: number; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNumber(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

function singleValue(rule: Rule): string | undefined {
  return Array.isArray(rule.value) ? rule.value[0] : rule.value;
}

function listValue(rule: Rule): string[] {
  if (Array.isArray(rule.value)) return rule.value.filter((v) => v !== "");
  return rule.value
    ? rule.value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

/** Checks each rule against the field list. Invalid rules are reported, never sent. */
export function validateRules(spec: FilterSpec, fields: readonly FieldDef[]): RuleError[] {
  const errors: RuleError[] = [];
  spec.rules.forEach((rule, index) => {
    const field = fields.find((f) => f.key === rule.field);
    if (!field) return errors.push({ index, message: "Pick a field." });
    if (!OPERATORS_BY_TYPE[field.type].includes(rule.op)) {
      return errors.push({ index, message: "That operator doesn't apply to this field." });
    }
    if (NO_VALUE_OPERATORS.includes(rule.op)) return;
    const v = singleValue(rule);
    switch (field.type) {
      case "number":
        if (!isNumber(v) || (rule.op === "between" && !isNumber(rule.value2))) {
          errors.push({ index, message: "Enter a number." });
        }
        return;
      case "date":
        if (rule.op === "in_last_days") {
          if (!isNumber(v) || Number(v) < 1 || Number(v) > 3650) {
            errors.push({ index, message: "Enter a number of days (1–3650)." });
          }
        } else if (
          !v ||
          !ISO_DATE.test(v) ||
          (rule.op === "between" && !ISO_DATE.test(rule.value2 ?? ""))
        ) {
          errors.push({ index, message: "Pick a date." });
        }
        return;
      case "boolean":
        if (v !== "true" && v !== "false") errors.push({ index, message: "Pick yes or no." });
        return;
      case "user":
        if (
          rule.op === "in"
            ? listValue(rule).some((x) => !UUID.test(x)) || listValue(rule).length === 0
            : !v || !UUID.test(v)
        ) {
          errors.push({ index, message: "Pick a person." });
        }
        return;
      case "enum":
      case "array": {
        const values = rule.op === "in" ? listValue(rule) : v ? [v] : [];
        if (values.length === 0) return errors.push({ index, message: "Pick a value." });
        if (field.options && values.some((x) => !field.options!.some((o) => o.value === x))) {
          errors.push({ index, message: "Pick one of the listed values." });
        }
        return;
      }
      case "text":
        if (!v || v.trim() === "") errors.push({ index, message: "Enter a value." });
        return;
    }
  });
  return errors;
}

/** Adds or subtracts whole days from "now" as an ISO timestamp. */
function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Start of a Pacific calendar day, as UTC. */
function startOfDayIso(date: string): string {
  return fromZonedTime(`${date}T00:00:00.000`, TZ).toISOString();
}

/** End of a Pacific calendar day (inclusive "after/between" on dates), as UTC. */
function endOfDayIso(date: string): string {
  return fromZonedTime(`${date}T23:59:59.999`, TZ).toISOString();
}

/** Turns one valid rule into an expression. */
export function ruleToExpr(rule: Rule, field: FieldDef, now: Date = new Date()): Expr {
  const col = field.column;
  const v = singleValue(rule) ?? "";
  const leaf = (column: string, op: string, value: string): Expr => ({
    type: "leaf",
    column,
    op,
    value,
  });

  switch (rule.op) {
    case "is_empty":
      if (field.type === "text")
        return { type: "or", items: [leaf(col, "is", "null"), leaf(col, "eq", "")] };
      if (field.type === "array") return leaf(col, "eq", "{}");
      return leaf(col, "is", "null");
    case "is_not_empty":
      if (field.type === "text")
        return { type: "and", items: [leaf(col, "not.is", "null"), leaf(col, "neq", "")] };
      if (field.type === "array") return leaf(col, "neq", "{}");
      return leaf(col, "not.is", "null");
    case "contains":
      if (field.type === "array") return leaf(col, "cs", `{${v}}`);
      return leaf(
        field.searchColumn ?? col,
        "ilike",
        `*${(field.searchColumn ? v.toLowerCase() : v).replace(/[*%]/g, "")}*`,
      );
    case "equals":
      if (field.type === "text") return leaf(col, "ilike", v.replace(/[*%]/g, ""));
      return leaf(col, "eq", v);
    case "not_equals":
      // "Does not equal" keeps empty values (e.g. owner ≠ Pat includes unassigned).
      return {
        type: "or",
        items: [
          leaf(col, field.type === "text" ? "not.ilike" : "neq", v.replace(/[*%]/g, "")),
          leaf(col, "is", "null"),
        ],
      };
    case "gt":
      return leaf(col, "gt", field.type === "date" ? endOfDayIso(v) : v);
    case "lt":
      return leaf(col, "lt", field.type === "date" ? startOfDayIso(v) : v);
    case "between": {
      const lo = field.type === "date" ? startOfDayIso(v) : v;
      const hi = field.type === "date" ? endOfDayIso(rule.value2 ?? v) : (rule.value2 ?? v);
      return { type: "and", items: [leaf(col, "gte", lo), leaf(col, "lte", hi)] };
    }
    case "in_last_days":
      return leaf(col, "gte", daysAgoIso(Number(v), now));
    case "in":
      return leaf(col, "in", `(${listValue(rule).map(quote).join(",")})`);
  }
}

/** PostgREST quoting for values inside or()/and() groups. */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Renders an expression for use inside or(...) / and(...). */
export function renderExpr(expr: Expr): string {
  if (expr.type === "leaf") {
    const raw =
      expr.op === "in" || expr.op === "is" || expr.op === "not.is" ? expr.value : quote(expr.value);
    return `${expr.column}.${expr.op}.${raw}`;
  }
  return `${expr.type}(${expr.items.map(renderExpr).join(",")})`;
}

/** One instruction for a PostgREST builder: a plain filter, or an or-group. */
export type QueryOp =
  { kind: "filter"; column: string; op: string; value: string } | { kind: "or"; expr: string };

/** Flattens an expression that must hold (AND context) into builder instructions. */
export function exprToOps(expr: Expr): QueryOp[] {
  if (expr.type === "leaf")
    return [{ kind: "filter", column: expr.column, op: expr.op, value: expr.value }];
  if (expr.type === "and") return expr.items.flatMap(exprToOps);
  return [{ kind: "or", expr: expr.items.map(renderExpr).join(",") }];
}

/** Valid rules of a spec as one expression (null when there are none). */
export function filterToExpr(
  spec: FilterSpec,
  fields: readonly FieldDef[],
  now: Date = new Date(),
): Expr | null {
  const bad = new Set(validateRules(spec, fields).map((e) => e.index));
  const items: Expr[] = [];
  spec.rules.forEach((rule, i) => {
    if (bad.has(i)) return;
    const field = fields.find((f) => f.key === rule.field);
    if (field) items.push(ruleToExpr(rule, field, now));
  });
  if (items.length === 0) return null;
  if (items.length === 1) return items[0]!;
  return { type: spec.match === "any" ? "or" : "and", items };
}

/** Builder instructions for a whole filter. */
export function filterToOps(
  spec: FilterSpec,
  fields: readonly FieldDef[],
  now: Date = new Date(),
): QueryOp[] {
  const expr = filterToExpr(spec, fields, now);
  return expr ? exprToOps(expr) : [];
}

/** UTF-8 safe base64url that works in the browser and on the server. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Compact, URL-safe encoding for the `f` search param. */
export function encodeFilter(spec: FilterSpec): string {
  if (spec.rules.length === 0) return "";
  return toBase64Url(JSON.stringify(spec));
}

export function decodeFilter(raw: string | null | undefined): FilterSpec {
  if (!raw) return EMPTY_FILTER;
  try {
    const json: unknown = JSON.parse(fromBase64Url(raw));
    const parsed = filterSchema.safeParse(json);
    return parsed.success ? parsed.data : EMPTY_FILTER;
  } catch {
    return EMPTY_FILTER;
  }
}
