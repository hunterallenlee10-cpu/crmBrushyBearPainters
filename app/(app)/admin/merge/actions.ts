"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, checkOne, mapDbError } from "@/lib/actions/errors";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { cleanMergeChoices } from "@/lib/domain/merge";
import { mergeSchema, undoMergeSchema } from "@/lib/validation/data-tools";

/**
 * Admin → Merge Customers (SPEC §8.19): reversible merges of duplicate
 * accounts and contacts. records:merge plus edit rights on the module; the
 * person must be able to open both records (row security); the move runs in
 * `merge_customers()` as the service with the person recorded as the actor,
 * and `record_merges` keeps everything needed to undo it.
 */
export const mergeCustomers = defineAction({
  name: "merge.records",
  schema: mergeSchema,
  permissions: ["records:merge"],
  handler: async (v, { supabase, service, viewer }) => {
    if (!viewer.can(v.module === "accounts" ? "accounts:update" : "contacts:update")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't edit these records."));
    }
    if (v.survivor_id === v.merged_id)
      throw new ActionFailure(actionError("validation", "Pick two different records."));
    const { data: seen } = await supabase
      .from(v.module)
      .select("id")
      .in("id", [v.survivor_id, v.merged_id]);
    if ((seen ?? []).length !== 2)
      throw new ActionFailure(
        actionError("not_found", "One of these records isn't available to you."),
      );
    const custom = await loadCustomFields(supabase, v.module);
    const choices = cleanMergeChoices(
      v.module,
      v.choices,
      custom.map((c) => c.apiName),
    );
    const db = await service();
    const { data, error } = await db.rpc("merge_customers", {
      p_module: v.module,
      p_survivor: v.survivor_id,
      p_merged: v.merged_id,
      p_choices: choices,
      p_reason: v.reason ?? undefined,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    revalidatePath("/admin/merge");
    revalidatePath(`/${v.module}/${v.survivor_id}`);
    revalidatePath(`/${v.module}`);
    return { id: data, survivorId: v.survivor_id };
  },
});

export const undoMerge = defineAction({
  name: "merge.undo",
  schema: undoMergeSchema,
  permissions: ["records:merge"],
  handler: async ({ id, reason }, { supabase, service, viewer }) => {
    const merge = checkOne(
      await supabase
        .from("record_merges")
        .select("id, module, survivor_id, merged_id, status")
        .eq("id", id)
        .maybeSingle(),
      "That merge no longer exists.",
    );
    if (!viewer.can(merge.module === "accounts" ? "accounts:update" : "contacts:update")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't edit these records."));
    }
    const table = merge.module === "accounts" ? "accounts" : "contacts";
    const { data: seen } = await supabase.from(table).select("id").eq("id", merge.survivor_id);
    if (!seen?.length)
      throw new ActionFailure(
        actionError("not_found", "The surviving record isn't available to you."),
      );
    const db = await service();
    const { error } = await db.rpc("undo_merge", { p_merge: id, p_reason: reason });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath("/admin/merge");
    revalidatePath(`/${table}/${merge.survivor_id}`);
    revalidatePath(`/${table}/${merge.merged_id}`);
    return { id };
  },
});
