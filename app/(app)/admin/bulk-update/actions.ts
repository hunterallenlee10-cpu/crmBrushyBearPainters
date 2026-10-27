"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { checkBulkValues, loadBulkRecords, loadCustomFields, savePreview } from "@/lib/bulk/server";
import { BULK_FIELDS, parseBulkCsv, type BulkChanges, type BulkModule } from "@/lib/domain/bulk";
import { parseCustomInput } from "@/lib/domain/custom-fields";
import type { Permission } from "@/lib/permissions";
import { bulkIdSchema, bulkPreviewSchema, bulkRevertSchema } from "@/lib/validation/data-tools";

/**
 * Admin → Bulk Update (SPEC §8.19, §19): preview first → apply → revert.
 * bulk:update plus edit rights on the module; apply and revert run in the
 * database as the person (row security, guards, validation rules, audit log
 * per record); bulk_update.* events come from triggers.
 */

const UPDATE: Record<BulkModule, Permission> = {
  leads: "leads:update",
  jobs: "jobs:update",
  accounts: "accounts:update",
  contacts: "contacts:update",
};

export const previewBulkUpdate = defineAction({
  name: "bulk.preview",
  schema: bulkPreviewSchema,
  permissions: ["bulk:update"],
  handler: async (v, { supabase, viewer }) => {
    if (!viewer.can(UPDATE[v.module])) {
      throw new ActionFailure(actionError("forbidden", "Your role can't edit these records."));
    }
    const custom = (await loadCustomFields(supabase, v.module)).filter((d) => d.active);
    const customApiNames = custom.map((d) => d.apiName);
    if (v.source === "selection") {
      const changes: BulkChanges = {};
      for (const [k, raw] of Object.entries(v.changes)) {
        if (k.startsWith("cf:")) {
          const def = custom.find((d) => d.apiName === k.slice(3));
          if (!def)
            throw new ActionFailure(
              actionError("validation", `"${k}" isn't an active custom field.`),
            );
          const parsed = parseCustomInput(
            def,
            raw === null ? null : typeof raw === "number" ? String(raw) : raw,
          );
          if ("error" in parsed) throw new ActionFailure(actionError("validation", parsed.error));
          changes[k] = parsed.value;
        } else {
          const f = BULK_FIELDS[v.module].find((x) => x.key === k);
          changes[k] =
            f?.kind === "number" && typeof raw === "string" && raw.trim() !== ""
              ? Number(raw)
              : raw === ""
                ? null
                : (raw as BulkChanges[string]);
        }
      }
      if (Object.keys(changes).length === 0)
        throw new ActionFailure(actionError("validation", "Pick a field to change."));
      const problem = await checkBulkValues(supabase, v.module, changes, custom);
      if (problem) throw new ActionFailure(actionError("validation", problem));
      const records = await loadBulkRecords(supabase, v.module, v.ids);
      if (records.length === 0)
        throw new ActionFailure(
          actionError("not_found", "None of those records are available to you."),
        );
      const id = await savePreview(supabase, viewer.orgId, {
        module: v.module,
        source: "selection",
        title:
          v.title ||
          `${Object.keys(changes).length} field${Object.keys(changes).length === 1 ? "" : "s"} on ${records.length} records`,
        changes,
        records,
        changesFor: () => changes,
        customApiNames,
      });
      revalidatePath("/admin/bulk-update");
      return { id };
    }
    // CSV
    const parsed = parseBulkCsv(v.module, v.header, v.rows, custom);
    if (!parsed.columns.some((c) => c.key === "id"))
      throw new ActionFailure(
        actionError("validation", "Add an id column (export the list to get it)."),
      );
    if (!parsed.columns.some((c) => c.key && c.key !== "id"))
      throw new ActionFailure(
        actionError("validation", "No column matches a field that can be bulk updated."),
      );
    const byId = new Map(parsed.rows.filter((r) => r.id).map((r) => [r.id!, r.changes]));
    for (const changes of byId.values()) {
      for (const [k, val] of Object.entries(changes)) {
        if (!k.startsWith("cf:")) continue;
        const def = custom.find((d) => d.apiName === k.slice(3))!;
        const p = parseCustomInput(def, val === null ? null : String(val));
        if (!("error" in p)) changes[k] = p.value;
      }
    }
    const records = await loadBulkRecords(supabase, v.module, [...byId.keys()]);
    if (records.length === 0)
      throw new ActionFailure(
        actionError("not_found", "None of the ids in the file match records you can see."),
      );
    const id = await savePreview(supabase, viewer.orgId, {
      module: v.module,
      source: "csv",
      title: v.title || v.file_name,
      changes: {},
      records,
      changesFor: (r) => byId.get(r.id) ?? {},
      customApiNames,
    });
    revalidatePath("/admin/bulk-update");
    return { id };
  },
});

export const applyBulkUpdate = defineAction({
  name: "bulk.apply",
  schema: bulkIdSchema,
  permissions: ["bulk:update"],
  handler: async ({ id }, { supabase }) => {
    const { data, error } = await supabase.rpc("bulk_update_apply", { p_id: id });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath(`/admin/bulk-update/${id}`);
    revalidatePath("/admin/bulk-update");
    return data as { applied: number; failed: number };
  },
});

export const revertBulkUpdate = defineAction({
  name: "bulk.revert",
  schema: bulkRevertSchema,
  permissions: ["bulk:update"],
  handler: async ({ id, reason }, { supabase }) => {
    const { data, error } = await supabase.rpc("bulk_update_revert", {
      p_id: id,
      p_reason: reason,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath(`/admin/bulk-update/${id}`);
    revalidatePath("/admin/bulk-update");
    return data as { reverted: number; conflicts: number };
  },
});

export const cancelBulkUpdate = defineAction({
  name: "bulk.cancel",
  schema: bulkIdSchema,
  permissions: ["bulk:update"],
  handler: async ({ id }, { supabase }) => {
    const rows = check(
      await supabase
        .from("bulk_updates")
        .update({ status: "canceled" })
        .eq("id", id)
        .eq("status", "preview")
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("validation", "Only a preview can be canceled."));
    revalidatePath("/admin/bulk-update");
    return { id };
  },
});
