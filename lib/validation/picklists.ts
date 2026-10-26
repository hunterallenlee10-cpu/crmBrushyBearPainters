import { z } from "zod";
import { requiredText } from "@/lib/validation/common";

/**
 * Field Picklists (SPEC §5.9, §8.19). Value keys are what records and reports
 * store, so they are fixed once saved; labels can change at any time.
 */

export const PICKLIST_KEY_RE = /^[a-z0-9][a-z0-9_]*$/;
export const PICKLIST_KEY_MAX = 60;
export const PICKLIST_LABEL_MAX = 80;

/** Picklist whose values carry a disposition category (SPEC §8.19). */
export const DISPOSITION_PICKLIST_KEY = "lead_disposition";

export const DISPOSITION_CATEGORIES = [
  "positive",
  "callback",
  "no_contact",
  "negative",
  "won",
] as const;
export type DispositionCategory = (typeof DISPOSITION_CATEGORIES)[number];

export const DISPOSITION_CATEGORY_LABELS: Record<DispositionCategory, string> = {
  positive: "Positive",
  callback: "Callback",
  no_contact: "No contact",
  negative: "Negative",
  won: "Won",
};

export function isDispositionCategory(v: string | null | undefined): v is DispositionCategory {
  return (DISPOSITION_CATEGORIES as readonly string[]).includes(v ?? "");
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(v: string): boolean {
  return HEX_RE.test(v);
}

/** "  #a1b2c3 " → "#A1B2C3"; "" → null; anything else stays as typed (fails validation). */
export function normalizeColor(input: string): string | null {
  const v = input.trim();
  if (v === "") return null;
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return isHexColor(withHash) ? withHash.toUpperCase() : v;
}

/**
 * Turns a label into a value key: lowercase letters, digits and underscores,
 * starting with a letter or digit. "Semi-gloss (Exterior)" → "semi_gloss_exterior".
 */
export function slugifyKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, PICKLIST_KEY_MAX)
    .replace(/_+$/g, "");
  return slug === "" ? "value" : slug;
}

/** `base`, or `base_2`, `base_3`… — the first one not already taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, PICKLIST_KEY_MAX - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Suggested key for a new value: slug of the label, made unique within the picklist. */
export function suggestKey(label: string, taken: Iterable<string>): string {
  return uniqueKey(slugifyKey(label), taken);
}

/** Moves the item at `index` by `delta` places; returns a new array (unchanged copy if out of range). */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const out = [...items];
  const target = index + delta;
  if (index < 0 || index >= out.length || target < 0 || target >= out.length) return out;
  const [item] = out.splice(index, 1);
  if (item === undefined) return [...items];
  out.splice(target, 0, item);
  return out;
}

const id = (what: string) => z.uuid({ message: `Missing ${what}.` });

export const valueKeySchema = z
  .string()
  .trim()
  .min(1, "Key is required.")
  .max(PICKLIST_KEY_MAX, `Keep the key under ${PICKLIST_KEY_MAX} characters.`)
  .regex(
    PICKLIST_KEY_RE,
    "Use lowercase letters, numbers and underscores, starting with a letter or number.",
  );

const labelSchema = requiredText("Label", PICKLIST_LABEL_MAX);

const colorSchema = z
  .string()
  .transform(normalizeColor)
  .refine((v) => v === null || isHexColor(v), "Use a color like #2F6B4F, or leave it blank.");

const categorySchema = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || isDispositionCategory(v), "Pick a category from the list.")
  .transform((v) => v as DispositionCategory | null);

const parentSchema = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid({ message: "Pick a source from the list." }).nullable());

export const addPicklistValueSchema = z.object({
  picklistId: id("picklist"),
  label: labelSchema,
  value: valueKeySchema,
  /** "" = none. Only used by Lead Disposition. */
  category: categorySchema,
  /** "" = none. Only used by picklists with a parent (Lead Sub-source → Lead Source). */
  parentValueId: parentSchema,
  color: colorSchema,
});
export type AddPicklistValueInput = z.input<typeof addPicklistValueSchema>;
export type AddPicklistValueValues = z.output<typeof addPicklistValueSchema>;

/** One field at a time, as the inline editor saves on blur/toggle. */
export const updatePicklistValueSchema = z
  .object({
    id: id("value"),
    label: labelSchema.optional(),
    active: z.boolean().optional(),
    category: categorySchema.optional(),
    parentValueId: parentSchema.optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.active !== undefined ||
      v.category !== undefined ||
      v.parentValueId !== undefined ||
      v.color !== undefined,
    { message: "Nothing to save.", path: ["_form"] },
  );
export type UpdatePicklistValueInput = z.input<typeof updatePicklistValueSchema>;

export const reorderPicklistValuesSchema = z.object({
  picklistId: id("picklist"),
  valueIds: z
    .array(id("value"))
    .min(1, "Nothing to reorder.")
    .refine((ids) => new Set(ids).size === ids.length, "Each value can appear only once."),
});
export type ReorderPicklistValuesInput = z.input<typeof reorderPicklistValuesSchema>;

/** Unique-constraint names from the platform migration → plain messages. */
export function picklistConflictMessage(
  dbMessage: string | null | undefined,
  label: string,
  key?: string,
): { field: "label" | "value"; message: string } | null {
  const m = dbMessage ?? "";
  if (m.includes("picklist_values_label_uidx")) {
    return {
      field: "label",
      message: `There's already a value labeled "${label}" in this picklist.`,
    };
  }
  if (m.includes("picklist_values_picklist_id_value_key")) {
    return { field: "value", message: `The key "${key ?? ""}" is already used. Pick another key.` };
  }
  return null;
}
