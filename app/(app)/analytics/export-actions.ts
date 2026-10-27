"use server";

import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError } from "@/lib/actions/errors";
import { exportLogSchema } from "@/lib/validation/analytics";

/**
 * "Download CSV" on a chart or KPI table (SPEC §8 "permission-gated, logged").
 * Needs data:export; the row goes into export_log through log_export(), which
 * checks the permission again (and refuses while viewing as someone else).
 * The CSV itself is built in the browser from the exact rows the "View data"
 * table shows, so nothing new is revealed by the download.
 */
export const logChartExport = defineAction({
  name: "analytics.log_export",
  schema: exportLogSchema,
  permissions: ["data:export"],
  handler: async (v, { supabase }) => {
    const { data, error } = await supabase.rpc("log_export", {
      p_kind: v.kind,
      p_dataset: v.dataset,
      p_title: v.title,
      p_row_count: v.row_count,
      p_filters: v.filters,
    });
    if (error || !data) throw new ActionFailure(actionError("forbidden"));
    return { exportId: data };
  },
});
