"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { autoMap, IMPORT_MODULES, type ImportModule } from "@/lib/domain/imports";
import { applyImport, buildReviewQueue, rawRows } from "@/lib/imports/server";
import {
  importIdSchema,
  importRowDecisionSchema,
  mapImportSchema,
  startImportSchema,
} from "@/lib/validation/data-tools";

/**
 * Admin → Data Import (SPEC §8.19): upload → mapping → review queue → apply.
 * bulk:update; every record is created as the person (row security, guards,
 * validation rules, audit log); import.* events come from triggers.
 */

const CREATE_PERMISSION = {
  leads: "leads:create",
  accounts: "accounts:create",
  contacts: "contacts:create",
} as const;

function toModule(v: string): ImportModule {
  const m = IMPORT_MODULES.find((x) => x === v);
  if (!m) throw new ActionFailure(actionError("validation", "Unknown import type."));
  return m;
}

export const startImport = defineAction({
  name: "imports.start",
  schema: startImportSchema,
  permissions: ["bulk:update"],
  handler: async ({ module, file_name, header, rows }, { supabase, viewer }) => {
    if (!viewer.can(CREATE_PERMISSION[module])) {
      throw new ActionFailure(actionError("forbidden", "Your role can't create these records."));
    }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
    if (nonEmpty.length === 0)
      throw new ActionFailure(actionError("validation", "Every row is empty."));
    const custom = await loadCustomFields(supabase, module);
    const imp = checkOne(
      await supabase
        .from("imports")
        .insert({
          org_id: viewer.orgId,
          module,
          file_name,
          headers: header,
          mapping: autoMap(module, header, custom),
          total_rows: nonEmpty.length,
        })
        .select("id")
        .single(),
    );
    const raw = rawRows(header, nonEmpty);
    for (let i = 0; i < raw.length; i += 500) {
      check(
        await supabase.from("import_rows").insert(
          raw.slice(i, i + 500).map((r, j) => ({
            org_id: viewer.orgId,
            import_id: imp.id,
            row_number: i + j + 1,
            raw: r,
          })),
        ),
      );
    }
    revalidatePath("/admin/import");
    return { id: imp.id };
  },
});

export const mapImport = defineAction({
  name: "imports.map",
  schema: mapImportSchema,
  permissions: ["bulk:update"],
  handler: async ({ id, mapping, duplicates }, { supabase }) => {
    const imp = checkOne(
      await supabase
        .from("imports")
        .select("id, org_id, module, status, headers")
        .eq("id", id)
        .maybeSingle(),
      "That import no longer exists.",
    );
    if (imp.status !== "mapping" && imp.status !== "review") {
      throw new ActionFailure(
        actionError("validation", "This import was already applied or canceled."),
      );
    }
    const clean = Object.fromEntries(
      Object.entries(mapping).filter(([h, k]) => imp.headers.includes(h) && k),
    );
    if (Object.keys(clean).length === 0) {
      throw new ActionFailure(actionError("validation", "Map at least one column."));
    }
    const result = await buildReviewQueue(
      supabase,
      { ...imp, module: toModule(imp.module) },
      clean,
      duplicates,
    );
    revalidatePath(`/admin/import/${id}`);
    return result;
  },
});

export const setImportRowDecision = defineAction({
  name: "imports.row_decision",
  schema: importRowDecisionSchema,
  permissions: ["bulk:update"],
  handler: async ({ id, decision }, { supabase }) => {
    const rows = check(
      await supabase
        .from("import_rows")
        .update({ decision })
        .eq("id", id)
        .eq("status", "duplicate")
        .select("import_id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That row can't be changed now."));
    revalidatePath(`/admin/import/${rows[0]!.import_id}`);
    return { id };
  },
});

export const applyImportAction = defineAction({
  name: "imports.apply",
  schema: importIdSchema,
  permissions: ["bulk:update"],
  handler: async ({ id }, { supabase, viewer }) => {
    const imp = checkOne(
      await supabase
        .from("imports")
        .select("id, org_id, module, status")
        .eq("id", id)
        .maybeSingle(),
      "That import no longer exists.",
    );
    if (imp.status !== "review") {
      throw new ActionFailure(
        actionError("validation", "Review the rows before applying (or it was already applied)."),
      );
    }
    const mod = toModule(imp.module);
    if (!viewer.can(CREATE_PERMISSION[mod])) {
      throw new ActionFailure(actionError("forbidden", "Your role can't create these records."));
    }
    const result = await applyImport(supabase, { ...imp, module: mod }, viewer.id);
    revalidatePath(`/admin/import/${id}`);
    revalidatePath("/admin/import");
    revalidatePath(`/${mod === "leads" ? "leads/list" : mod}`);
    return result;
  },
});

export const cancelImport = defineAction({
  name: "imports.cancel",
  schema: importIdSchema,
  permissions: ["bulk:update"],
  handler: async ({ id }, { supabase }) => {
    const rows = check(
      await supabase
        .from("imports")
        .update({ status: "canceled" })
        .eq("id", id)
        .in("status", ["mapping", "review"])
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(
        actionError("validation", "Only an import that hasn't been applied can be canceled."),
      );
    revalidatePath("/admin/import");
    return { id };
  },
});
