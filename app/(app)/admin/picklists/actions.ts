"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import {
  DISPOSITION_PICKLIST_KEY,
  addPicklistValueSchema,
  picklistConflictMessage,
  reorderPicklistValuesSchema,
  updatePicklistValueSchema,
} from "@/lib/validation/picklists";

/**
 * Field Picklists (SPEC §8.19). Writes go through the user-scoped client, so
 * RLS (`picklists:manage`) and the picklist_values guard apply; audit rows and
 * `picklist_value.*` events come from database triggers.
 */

type Picklist = { id: string; key: string; parent_picklist_id: string | null };

async function loadPicklist(supabase: ActionContext["supabase"], id: string): Promise<Picklist> {
  const row = check(
    await supabase
      .from("picklists")
      .select("id, key, parent_picklist_id")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!row)
    throw new ActionFailure({ code: "not_found", message: "That picklist no longer exists." });
  return row;
}

/** Category is only for dispositions; a parent must be a value of the parent picklist. */
async function checkCategoryAndParent(
  supabase: ActionContext["supabase"],
  picklist: Picklist,
  category: string | null | undefined,
  parentValueId: string | null | undefined,
) {
  if (category && picklist.key !== DISPOSITION_PICKLIST_KEY) {
    throw new ActionFailure({
      code: "validation",
      message: "Only dispositions have a category.",
      fieldErrors: { category: ["Only dispositions have a category."] },
    });
  }
  if (parentValueId) {
    if (!picklist.parent_picklist_id) {
      throw new ActionFailure({
        code: "validation",
        message: "This picklist doesn't have parent values.",
      });
    }
    const parent = check(
      await supabase
        .from("picklist_values")
        .select("id")
        .eq("id", parentValueId)
        .eq("picklist_id", picklist.parent_picklist_id)
        .maybeSingle(),
    );
    if (!parent) {
      throw new ActionFailure({
        code: "validation",
        message: "Pick a parent from the list.",
        fieldErrors: { parentValueId: ["Pick a parent from the list."] },
      });
    }
  }
}

function conflictOrDbError(
  error: { code?: string | null; message?: string | null },
  label: string,
  key?: string,
): never {
  const conflict =
    error.code === "23505" ? picklistConflictMessage(error.message, label, key) : null;
  if (conflict) {
    throw new ActionFailure({
      code: "conflict",
      message: conflict.message,
      fieldErrors: { [conflict.field]: [conflict.message] },
    });
  }
  throw new ActionFailure(mapDbError(error));
}

function revalidate(key: string) {
  revalidatePath("/admin/picklists");
  revalidatePath(`/admin/picklists/${key}`);
}

export const addPicklistValue = defineAction({
  name: "picklist_value.add",
  schema: addPicklistValueSchema,
  permissions: ["picklists:manage"],
  handler: async (v, { supabase, viewer }) => {
    const picklist = await loadPicklist(supabase, v.picklistId);
    await checkCategoryAndParent(supabase, picklist, v.category, v.parentValueId);

    const last = check(
      await supabase
        .from("picklist_values")
        .select("sort_order")
        .eq("picklist_id", picklist.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );

    const { data, error } = await supabase
      .from("picklist_values")
      .insert({
        org_id: viewer.orgId,
        picklist_id: picklist.id,
        value: v.value,
        label: v.label,
        category: v.category,
        parent_value_id: v.parentValueId,
        color: v.color,
        sort_order: (last?.sort_order ?? 0) + 10,
        active: true,
        is_system: false,
      })
      .select("id")
      .single();
    if (error) conflictOrDbError(error, v.label, v.value);

    revalidate(picklist.key);
    return { id: data.id };
  },
});

export const updatePicklistValue = defineAction({
  name: "picklist_value.update",
  schema: updatePicklistValueSchema,
  permissions: ["picklists:manage"],
  handler: async (v, { supabase }) => {
    const current = check(
      await supabase
        .from("picklist_values")
        .select("id, label, picklist_id")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!current)
      throw new ActionFailure({ code: "not_found", message: "That value no longer exists." });
    const picklist = await loadPicklist(supabase, current.picklist_id);
    await checkCategoryAndParent(supabase, picklist, v.category, v.parentValueId);
    if (v.parentValueId && v.parentValueId === v.id) {
      throw new ActionFailure({ code: "validation", message: "A value can't be its own parent." });
    }

    const patch: {
      label?: string;
      active?: boolean;
      category?: string | null;
      parent_value_id?: string | null;
      color?: string | null;
    } = {};
    if (v.label !== undefined) patch.label = v.label;
    if (v.active !== undefined) patch.active = v.active;
    if (v.category !== undefined) patch.category = v.category;
    if (v.parentValueId !== undefined) patch.parent_value_id = v.parentValueId;
    if (v.color !== undefined) patch.color = v.color;

    const { data, error } = await supabase
      .from("picklist_values")
      .update(patch)
      .eq("id", v.id)
      .select("id");
    if (error) conflictOrDbError(error, v.label ?? current.label);
    if (data.length === 0) {
      throw new ActionFailure({
        code: "forbidden",
        message: "You don't have permission to edit picklists.",
      });
    }

    revalidate(picklist.key);
    return { id: v.id };
  },
});

export const reorderPicklistValues = defineAction({
  name: "picklist_value.reorder",
  schema: reorderPicklistValuesSchema,
  permissions: ["picklists:manage"],
  handler: async (v, { supabase }) => {
    const picklist = await loadPicklist(supabase, v.picklistId);
    check(
      await supabase.rpc("reorder_picklist_values", {
        p_picklist_id: picklist.id,
        p_value_ids: v.valueIds,
      }),
    );
    revalidate(picklist.key);
    return { reordered: v.valueIds.length };
  },
});
