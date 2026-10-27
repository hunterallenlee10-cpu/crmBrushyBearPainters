import type { CustomFieldModule } from "@/lib/domain/custom-fields/types";

/**
 * Validation rules (Module Manager): required, regex, min/max and length on
 * standard fields and custom fields ("cf:<api_name>"). The database trigger
 * `app.check_module_fields()` enforces them on people's writes; forms run the
 * same checks first for clear messages. Pure.
 */

export const RULE_TYPES = ["required", "regex", "min", "max", "min_length", "max_length"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  required: "Required",
  regex: "Matches a pattern",
  min: "At least (number or date)",
  max: "At most (number or date)",
  min_length: "At least N characters",
  max_length: "At most N characters",
};

/** Standard fields rules may target. Must agree with `app.validation_standard_fields()`. */
export const VALIDATION_STANDARD_FIELDS: Record<
  CustomFieldModule,
  readonly { key: string; label: string }[]
> = {
  leads: [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "company", label: "Company" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "mobile", label: "Mobile" },
    { key: "street", label: "Street" },
    { key: "city", label: "City" },
    { key: "zip", label: "ZIP" },
    { key: "customer_notes", label: "Notes from customer" },
    { key: "year_built", label: "Year built" },
  ],
  jobs: [
    { key: "name", label: "Job name" },
    { key: "priority_reason", label: "Priority reason" },
    { key: "estimated_duration_days", label: "Estimated duration (days)" },
    { key: "promised_start_date", label: "Promised start date" },
    { key: "target_season", label: "Target season" },
  ],
  accounts: [
    { key: "display_name", label: "Account name" },
    { key: "notes", label: "Notes" },
  ],
  contacts: [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "mobile", label: "Mobile" },
    { key: "language", label: "Language" },
    { key: "notes", label: "Notes" },
  ],
};

export type ValidationRule = {
  id?: string;
  module: CustomFieldModule;
  /** Standard column, or "cf:<api_name>". */
  field: string;
  type: RuleType;
  value: string | null;
  message: string;
  active: boolean;
};

const NUMBER = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problem with a rule's own settings (shown in Module Manager), or null. */
export function ruleSettingsError(
  rule: Pick<ValidationRule, "module" | "field" | "type" | "value" | "message">,
  customApiNames: readonly string[],
): string | null {
  if (rule.field.startsWith("cf:")) {
    if (!customApiNames.includes(rule.field.slice(3)))
      return "Pick one of this module's custom fields.";
  } else if (!VALIDATION_STANDARD_FIELDS[rule.module].some((f) => f.key === rule.field)) {
    return "Rules can only be set on the listed fields.";
  }
  if (!rule.message.trim()) return "Write the message people see when the rule fails.";
  if (rule.message.length > 200) return "Keep the message under 200 characters.";
  if (rule.type === "required") return null;
  const v = (rule.value ?? "").trim();
  if (!v) return "Enter the rule's value.";
  if (rule.type === "regex") {
    try {
      new RegExp(v);
    } catch {
      return "That pattern isn't a valid regular expression.";
    }
    return null;
  }
  if (rule.type === "min" || rule.type === "max") {
    return NUMBER.test(v) || DATE.test(v) ? null : "Enter a number or a date (YYYY-MM-DD).";
  }
  return /^\d{1,5}$/.test(v) ? null : "Enter a whole number of characters.";
}

/** A field value as rule text ("" when empty), like `app.rule_value_text()`. */
export function ruleValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "";
  return String(value);
}

/** Reads the value a rule targets from a record (standard column or custom value). */
export function ruleTargetValue(
  record: Record<string, unknown> & { custom_field_values?: unknown },
  field: string,
): unknown {
  if (field.startsWith("cf:")) {
    const cf = record.custom_field_values;
    return cf && typeof cf === "object" ? (cf as Record<string, unknown>)[field.slice(3)] : null;
  }
  return record[field];
}

/** Message when the value breaks the rule, or null. `required` is checked here too. */
export function checkRule(rule: ValidationRule, value: unknown): string | null {
  if (!rule.active) return null;
  const txt = ruleValueText(value).trim() === "" ? "" : ruleValueText(value);
  if (rule.type === "required") return txt === "" ? rule.message : null;
  if (txt === "") return null;
  const v = rule.value ?? "";
  switch (rule.type) {
    case "regex": {
      try {
        // Postgres `~` is a search (not anchored), like RegExp.test.
        return new RegExp(v).test(txt) ? null : rule.message;
      } catch {
        return null;
      }
    }
    case "min_length":
      return txt.length < Number(v) ? rule.message : null;
    case "max_length":
      return txt.length > Number(v) ? rule.message : null;
    case "min":
    case "max": {
      if (NUMBER.test(v) && NUMBER.test(txt)) {
        const bad = rule.type === "min" ? Number(txt) < Number(v) : Number(txt) > Number(v);
        return bad ? rule.message : null;
      }
      if (DATE.test(v)) {
        const d = txt.slice(0, 10);
        const bad = rule.type === "min" ? d < v : d > v;
        return bad ? rule.message : null;
      }
      return null;
    }
  }
}

/**
 * Checks a record against its module's rules. With `changed` (update), only
 * the rules on changed fields run, like the database. Errors are keyed by the
 * rule's field ("email", "cf:rooms").
 */
export function checkRules(
  rules: readonly ValidationRule[],
  record: Record<string, unknown> & { custom_field_values?: unknown },
  options: { changed?: ReadonlySet<string> } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.active || errors[rule.field]) continue;
    if (options.changed && !options.changed.has(rule.field)) continue;
    const msg = checkRule(rule, ruleTargetValue(record, rule.field));
    if (msg) errors[rule.field] = msg;
  }
  return errors;
}

/** Parses a database row into a rule; null when it isn't one. */
export function toValidationRule(row: {
  id: string;
  module: string;
  field: string;
  rule_type: string;
  value: string | null;
  message: string;
  active: boolean;
}): ValidationRule | null {
  const type = RULE_TYPES.find((t) => t === row.rule_type);
  const mod = (["leads", "jobs", "accounts", "contacts"] as const).find((m) => m === row.module);
  if (!type || !mod) return null;
  return {
    id: row.id,
    module: mod,
    field: row.field,
    type,
    value: row.value,
    message: row.message,
    active: row.active,
  };
}
