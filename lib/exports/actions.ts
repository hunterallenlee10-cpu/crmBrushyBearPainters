"use server";

import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import { buildListExport } from "@/lib/exports/lists";
import { listExportSchema } from "@/lib/validation/data-tools";

/**
 * Export Controls (SPEC §8.19, §13.1): "Export CSV" on the Lead List, Job List
 * and Audit Log. Needs data:export (plus leads:export for leads, audit:read for
 * the audit log), never while viewing as someone, and every export is logged
 * (who, what, filters, row count) through log_export().
 */
export const exportListCsv = defineAction({
  name: "exports.list",
  schema: listExportSchema,
  permissions: ["data:export"],
  handler: async ({ list, query }, { supabase, viewer }) => {
    if (list === "leads" && !viewer.can("leads:export")) {
      throw new ActionFailure(
        actionError("forbidden", "Your role can't export leads. Ask an owner for export access."),
      );
    }
    if (list === "audit_log" && !viewer.can("audit:read")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't read the audit log."));
    }
    const result = await buildListExport(supabase, viewer, list, new URLSearchParams(query));
    const { error } = await supabase.rpc("log_export", {
      p_kind: list === "audit_log" ? "audit_log" : "list",
      p_dataset: list,
      p_title: result.title,
      p_row_count: result.rows,
      p_filters: result.filters,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    return {
      csv: result.csv,
      fileName: result.fileName,
      rows: result.rows,
      truncated: result.truncated,
    };
  },
});
