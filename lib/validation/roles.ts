import { z } from "zod";
import { PERMISSIONS, PERMISSION_CATEGORIES, type Permission, type Scope } from "@/lib/permissions";
import { optionalText, requiredText } from "@/lib/validation/common";

/**
 * Roles & Permissions admin (SPEC §4.2): role templates, permission packs and
 * their pack/permission links. Postgres RLS + guard triggers are the enforcement;
 * these schemas keep the input clean and the messages plain.
 */

/** Same rule as the `key` check constraint on role_templates / permission_packs. */
export const RECORD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_MAX = 48;

/**
 * Turns a display name into a key like `painter_lead`, unique among `taken`.
 * Keys never change after creation, so this only runs on create.
 */
export function keyFromName(name: string, taken: Iterable<string> = [], prefix = "custom"): string {
  let base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "" || !/^[a-z]/.test(base)) base = base === "" ? prefix : `${prefix}_${base}`;
  base = base.slice(0, KEY_MAX).replace(/_+$/g, "");

  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not find a free key.");
}

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as [Permission, ...Permission[]];
const SCOPED = new Set<Permission>(PERMISSIONS.filter((p) => p.scoped).map((p) => p.key));

export const permissionKey = z.enum(PERMISSION_KEYS, { message: "Unknown permission." });
export const scopeValue = z.enum(["own", "team", "all"], { message: "Pick a scope." });
export const packCategory = z.enum(PERMISSION_CATEGORIES, { message: "Pick a category." });

export function isScoped(permission: Permission): boolean {
  return SCOPED.has(permission);
}

/** Unscoped permissions are always stored as "all" (scope has no meaning for them). */
export function normalizeScope(permission: Permission, scope: Scope): Scope {
  return isScoped(permission) ? scope : "all";
}

const id = z.uuid({ message: "Missing record id." });
const name = requiredText("Name", 80);
const description = optionalText(500);

const packPermissions = z
  .array(z.object({ permission: permissionKey, scope: scopeValue }))
  .min(1, "Pick at least one permission.")
  .refine(
    (rows) => new Set(rows.map((r) => r.permission)).size === rows.length,
    "Each permission can only appear once.",
  )
  .transform((rows) =>
    rows.map((r) => ({ permission: r.permission, scope: normalizeScope(r.permission, r.scope) })),
  );

export const createTemplateSchema = z.object({
  name,
  description,
  clone_from_id: id,
});

export const updateTemplateSchema = z.object({ id, name, description });

export const setTemplatePacksSchema = z.object({
  template_id: id,
  pack_ids: z
    .array(id)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, "A pack can only be added once."),
});

export const packFormSchema = z.object({
  name,
  description,
  category: packCategory,
  permissions: packPermissions,
});

export const createPackSchema = packFormSchema;
export const updatePackSchema = packFormSchema.extend({ id });
export const duplicatePackSchema = z.object({ id });

export const deleteRecordSchema = z.object({
  table: z.enum(["role_templates", "permission_packs"]),
  id,
  reason: z
    .string()
    .trim()
    .min(3, "Give a short reason (at least 3 characters).")
    .max(500, "Keep it under 500 characters."),
});

export type CreateTemplateInput = z.input<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;
export type PackFormInput = z.input<typeof packFormSchema>;
export type PackFormValues = z.output<typeof packFormSchema>;
export type DeleteRecordInput = z.input<typeof deleteRecordSchema>;

/** Changes needed to turn the current pack permission rows into the desired ones. */
export function diffPackPermissions(
  current: readonly { permission: Permission; scope: Scope }[],
  desired: readonly { permission: Permission; scope: Scope }[],
) {
  const before = new Map(current.map((r) => [r.permission, r.scope]));
  const after = new Map(desired.map((r) => [r.permission, r.scope]));
  const insert: { permission: Permission; scope: Scope }[] = [];
  const update: { permission: Permission; scope: Scope }[] = [];
  const remove: Permission[] = [];
  for (const [permission, scope] of after) {
    const had = before.get(permission);
    if (had === undefined) insert.push({ permission, scope });
    else if (had !== scope) update.push({ permission, scope });
  }
  for (const permission of before.keys()) if (!after.has(permission)) remove.push(permission);
  return { insert, update, remove };
}

/** Pack ids to add and remove when saving a template's pack checklist. */
export function diffIds(current: readonly string[], desired: readonly string[]) {
  const before = new Set(current);
  const after = new Set(desired);
  return {
    add: [...after].filter((x) => !before.has(x)),
    remove: [...before].filter((x) => !after.has(x)),
  };
}
