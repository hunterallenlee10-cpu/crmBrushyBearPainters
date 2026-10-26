"use server";

import { revalidatePath } from "next/cache";
import { type ActionContext, defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import {
  createPackSchema,
  createTemplateSchema,
  deleteRecordSchema,
  diffIds,
  diffPackPermissions,
  duplicatePackSchema,
  keyFromName,
  setTemplatePacksSchema,
  updatePackSchema,
  updateTemplateSchema,
} from "@/lib/validation/roles";
import { isPermission, type Permission, type Scope } from "@/lib/permissions";

/**
 * Roles & Permissions (SPEC §4.2). Every write uses the signed-in user's client so
 * RLS (`roles:manage`) and the guard triggers apply: the Owner template is locked,
 * system packs are read-only, custom templates can't be owner-level. Audit rows and
 * domain events come from database triggers in the same transaction.
 */

const PERMS = ["roles:manage"] as const;
const MAX_KEY_ATTEMPTS = 5;

/**
 * For actions that keep the user on the same page: the action response then carries
 * the re-rendered page. Actions that navigate away (create, duplicate, delete) skip it;
 * the client navigates or refreshes, and these pages are dynamic, so they load fresh.
 */
function revalidateRoles() {
  revalidatePath("/admin/roles", "layout");
}

type Supabase = ActionContext["supabase"];

/**
 * Inserts a row with a key derived from its name. Keys are unique per org including
 * soft-deleted rows (which RLS hides), so a unique-violation retries with a suffix.
 */
type DbErr = { code?: string; message?: string } | null;

async function insertWithKey(
  name: string,
  prefix: string,
  taken: string[],
  insert: (key: string) => PromiseLike<{ data: { id: string } | null; error: DbErr }>,
): Promise<{ id: string }> {
  const used = [...taken];
  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
    const key = keyFromName(name, used, prefix);
    const { data, error } = await insert(key);
    if (!error && data) return data;
    if (error?.code !== "23505") throw new ActionFailure(mapDbError(error));
    used.push(key);
  }
  throw new ActionFailure({ code: "conflict", message: "Pick a different name." });
}

async function packKeys(supabase: Supabase): Promise<string[]> {
  return (check(await supabase.from("permission_packs").select("key")) ?? []).map((r) => r.key);
}

async function readPackPermissions(
  supabase: Supabase,
  packId: string,
): Promise<{ permission: Permission; scope: Scope }[]> {
  const rows = check(
    await supabase.from("pack_permissions").select("permission, scope").eq("pack_id", packId),
  );
  return (rows ?? []).flatMap((r) => {
    if (!isPermission(r.permission)) return [];
    const scope: Scope = r.scope === "own" || r.scope === "team" ? r.scope : "all";
    return [{ permission: r.permission, scope }];
  });
}

async function insertPackPermissions(
  supabase: Supabase,
  orgId: string,
  packId: string,
  rows: readonly { permission: Permission; scope: Scope }[],
) {
  if (rows.length === 0) return;
  check(
    await supabase.from("pack_permissions").insert(
      rows.map((r) => ({
        org_id: orgId,
        pack_id: packId,
        permission: r.permission,
        scope: r.scope,
      })),
    ),
  );
}

/** New custom template, cloned from an existing one (copies its packs and crew / MFA flags). */
export const createTemplate = defineAction({
  name: "role_templates.create",
  schema: createTemplateSchema,
  permissions: PERMS,
  handler: async (v, { supabase, viewer }) => {
    const source = check(
      await supabase
        .from("role_templates")
        .select("id, grants_all, requires_mfa, is_crew")
        .eq("id", v.clone_from_id)
        .maybeSingle(),
    );
    if (!source)
      throw new ActionFailure({
        code: "not_found",
        message: "The template to copy no longer exists.",
      });
    if (source.grants_all) {
      throw new ActionFailure({
        code: "validation",
        message:
          "The Owner template has every permission and can't be copied. Copy another template instead.",
        fieldErrors: { clone_from_id: ["Pick a template other than Owner."] },
      });
    }

    const links =
      check(await supabase.from("template_packs").select("pack_id").eq("template_id", source.id)) ??
      [];
    const taken = (check(await supabase.from("role_templates").select("key")) ?? []).map(
      (r) => r.key,
    );

    const created = await insertWithKey(v.name, "custom", taken, (key) =>
      supabase
        .from("role_templates")
        .insert({
          org_id: viewer.orgId,
          key,
          name: v.name,
          description: v.description,
          requires_mfa: source.requires_mfa,
          is_crew: source.is_crew,
          sort_order: 1000,
        })
        .select("id")
        .single(),
    );

    if (links.length > 0) {
      const { error } = await supabase
        .from("template_packs")
        .insert(
          links.map((l) => ({ org_id: viewer.orgId, template_id: created.id, pack_id: l.pack_id })),
        );
      if (error) {
        // Don't leave a half-made template behind.
        await supabase.rpc("soft_delete_record", {
          p_table: "role_templates",
          p_id: created.id,
          p_reason: "Copy failed while adding packs",
        });
        throw new ActionFailure(mapDbError(error));
      }
    }

    return { id: created.id };
  },
});

export const updateTemplate = defineAction({
  name: "role_templates.update",
  schema: updateTemplateSchema,
  permissions: PERMS,
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("role_templates")
        .update({ name: v.name, description: v.description })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows || rows.length === 0) {
      throw new ActionFailure({ code: "not_found", message: "That template no longer exists." });
    }
    revalidateRoles();
    return { saved: true };
  },
});

/** Replaces a template's pack list (adds and removes template_packs rows). */
export const setTemplatePacks = defineAction({
  name: "template_packs.set",
  schema: setTemplatePacksSchema,
  permissions: PERMS,
  handler: async (v, { supabase, viewer }) => {
    const template = check(
      await supabase
        .from("role_templates")
        .select("id, grants_all")
        .eq("id", v.template_id)
        .maybeSingle(),
    );
    if (!template)
      throw new ActionFailure({ code: "not_found", message: "That template no longer exists." });
    if (template.grants_all) {
      throw new ActionFailure({ code: "forbidden", message: "The Owner template is locked." });
    }

    // Only live packs count: links to deleted packs grant nothing and are left alone.
    const livePacks = new Set(
      (check(await supabase.from("permission_packs").select("id")) ?? []).map((p) => p.id),
    );
    const unknown = v.pack_ids.filter((id) => !livePacks.has(id));
    if (unknown.length > 0) {
      throw new ActionFailure({
        code: "not_found",
        message: "One of those packs no longer exists. Reload and try again.",
      });
    }
    const current = (
      check(
        await supabase.from("template_packs").select("pack_id").eq("template_id", template.id),
      ) ?? []
    )
      .map((l) => l.pack_id)
      .filter((id) => livePacks.has(id));

    const { add, remove } = diffIds(current, v.pack_ids);
    if (remove.length > 0) {
      check(
        await supabase
          .from("template_packs")
          .delete()
          .eq("template_id", template.id)
          .in("pack_id", remove),
      );
    }
    if (add.length > 0) {
      check(
        await supabase
          .from("template_packs")
          .insert(
            add.map((pack_id) => ({ org_id: viewer.orgId, template_id: template.id, pack_id })),
          ),
      );
    }
    revalidateRoles();
    return { added: add.length, removed: remove.length };
  },
});

export const createPack = defineAction({
  name: "permission_packs.create",
  schema: createPackSchema,
  permissions: PERMS,
  handler: async (v, { supabase, viewer }) => {
    const created = await insertWithKey(v.name, "pack", await packKeys(supabase), (key) =>
      supabase
        .from("permission_packs")
        .insert({
          org_id: viewer.orgId,
          key,
          name: v.name,
          description: v.description,
          category: v.category,
          sort_order: 1000,
        })
        .select("id")
        .single(),
    );
    try {
      await insertPackPermissions(supabase, viewer.orgId, created.id, v.permissions);
    } catch (error) {
      await supabase.rpc("soft_delete_record", {
        p_table: "permission_packs",
        p_id: created.id,
        p_reason: "Create failed while adding permissions",
      });
      throw error;
    }
    return { id: created.id };
  },
});

export const updatePack = defineAction({
  name: "permission_packs.update",
  schema: updatePackSchema,
  permissions: PERMS,
  handler: async (v, { supabase, viewer }) => {
    const pack = check(
      await supabase.from("permission_packs").select("id, is_system").eq("id", v.id).maybeSingle(),
    );
    if (!pack)
      throw new ActionFailure({ code: "not_found", message: "That pack no longer exists." });
    if (pack.is_system) {
      throw new ActionFailure({
        code: "forbidden",
        message: "System packs are read-only. Create a custom pack instead.",
      });
    }

    check(
      await supabase
        .from("permission_packs")
        .update({ name: v.name, description: v.description, category: v.category })
        .eq("id", pack.id)
        .select("id"),
    );

    const current = await readPackPermissions(supabase, pack.id);
    const { insert, update, remove } = diffPackPermissions(current, v.permissions);

    if (remove.length > 0) {
      check(
        await supabase
          .from("pack_permissions")
          .delete()
          .eq("pack_id", pack.id)
          .in("permission", remove),
      );
    }
    for (const row of update) {
      check(
        await supabase
          .from("pack_permissions")
          .update({ scope: row.scope })
          .eq("pack_id", pack.id)
          .eq("permission", row.permission),
      );
    }
    await insertPackPermissions(supabase, viewer.orgId, pack.id, insert);

    revalidateRoles();
    return { saved: true };
  },
});

/** Copies a (usually system) pack into a new, editable custom pack. */
export const duplicatePack = defineAction({
  name: "permission_packs.duplicate",
  schema: duplicatePackSchema,
  permissions: PERMS,
  handler: async (v, { supabase, viewer }) => {
    const source = check(
      await supabase
        .from("permission_packs")
        .select("id, name, description, category")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!source)
      throw new ActionFailure({ code: "not_found", message: "That pack no longer exists." });
    const perms = await readPackPermissions(supabase, source.id);

    const name = `${source.name} (copy)`.slice(0, 80);
    const created = await insertWithKey(name, "pack", await packKeys(supabase), (key) =>
      supabase
        .from("permission_packs")
        .insert({
          org_id: viewer.orgId,
          key,
          name,
          description: source.description,
          category: source.category,
          sort_order: 1000,
        })
        .select("id")
        .single(),
    );
    await insertPackPermissions(supabase, viewer.orgId, created.id, perms);
    return { id: created.id };
  },
});

/** Soft delete (reason required). The RPC blocks built-in rows and templates still in use. */
export const deleteRoleRecord = defineAction({
  name: "roles.soft_delete",
  schema: deleteRecordSchema,
  permissions: PERMS,
  handler: async (v, { supabase }) => {
    check(
      await supabase.rpc("soft_delete_record", {
        p_table: v.table,
        p_id: v.id,
        p_reason: v.reason,
      }),
    );
    return { deleted: true };
  },
});
