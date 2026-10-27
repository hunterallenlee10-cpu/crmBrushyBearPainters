"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import type { Json } from "@/lib/db/types";
import { answerQuestion } from "@/lib/analytics/ask";
import { summarizeDay } from "@/lib/domain/analytics/brief";
import { validateReportConfig } from "@/lib/domain/reports/config";
import { REPORT_MODULES } from "@/lib/domain/reports/modules";
import { nextRunAt } from "@/lib/domain/reports/schedule";
import { parseDailyBrief } from "@/lib/metrics/registry";
import {
  askSchema,
  dailyBriefSchema,
  dashboardIdSchema,
  dashboardSaveSchema,
  favoriteSchema,
  reportIdSchema,
  reportSaveSchema,
  scheduleIdSchema,
  scheduleSaveSchema,
} from "@/lib/validation/analytics";

/**
 * Analytics hub actions (SPEC §8.14). Each is zod-validated, permission-checked
 * (here and by row security), audit-logged by database triggers and emits a
 * domain event (report.*, dashboard.*, report_schedule.*, analytics_favorite.*).
 * Ask and the Daily Brief only read.
 */

export const askQuestion = defineAction({
  name: "analytics.ask",
  schema: askSchema,
  permissions: ["analytics:read"],
  handler: async (v, { supabase, viewer }) => answerQuestion(supabase, viewer, v.question),
});

export const generateDailyBrief = defineAction({
  name: "analytics.daily_brief",
  schema: dailyBriefSchema,
  permissions: ["analytics:read"],
  handler: async (v, { supabase }) => {
    const data = check(await supabase.rpc("daily_brief", { p_day: v.day }));
    const brief = parseDailyBrief(data);
    const [y, m, d] = v.day.split("-").map(Number) as [number, number, number];
    const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return summarizeDay(brief, label);
  },
});

export const saveReport = defineAction({
  name: "analytics.save_report",
  schema: reportSaveSchema,
  permissions: ["reports:build"],
  handler: async (v, { supabase, viewer }) => {
    const mod = REPORT_MODULES[v.module];
    if (!viewer.can(mod.requires)) throw new ActionFailure(actionError("forbidden"));
    const problems = validateReportConfig(mod, v.config);
    if (problems.length) {
      throw new ActionFailure(actionError("validation", problems[0]!.message));
    }
    const row = {
      name: v.name,
      description: v.description,
      module: v.module,
      config: v.config as unknown as { [key: string]: Json },
      shared: v.shared,
      category: "custom",
    };
    if (v.id) {
      const rows = check(
        await supabase
          .from("reports")
          .update(row)
          .eq("id", v.id)
          .eq("owner_id", viewer.id)
          .select("id"),
      );
      if (!rows?.length)
        throw new ActionFailure(
          actionError(
            "forbidden",
            "Only the person who built a report can change it. Save a copy instead.",
          ),
        );
      revalidatePath("/analytics/reports");
      return { id: v.id };
    }
    const created = check(
      await supabase
        .from("reports")
        .insert({ ...row, org_id: viewer.orgId, owner_id: viewer.id })
        .select("id")
        .single(),
    );
    revalidatePath("/analytics/reports");
    if (!created) throw new ActionFailure(actionError("server"));
    return { id: created.id };
  },
});

export const deleteReport = defineAction({
  name: "analytics.delete_report",
  schema: reportIdSchema,
  permissions: ["reports:build"],
  handler: async (v, { supabase, viewer }) => {
    const rows = check(
      await supabase.from("reports").delete().eq("id", v.id).eq("owner_id", viewer.id).select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    revalidatePath("/analytics/reports");
    return { deleted: true };
  },
});

export const toggleFavorite = defineAction({
  name: "analytics.favorite",
  schema: favoriteSchema,
  permissions: ["analytics:read"],
  handler: async (v, { supabase, viewer }) => {
    if (v.on) {
      check(
        await supabase.from("analytics_favorites").upsert(
          {
            org_id: viewer.orgId,
            user_id: viewer.id,
            item_type: v.item_type,
            item_key: v.item_key,
          },
          { onConflict: "user_id,item_type,item_key", ignoreDuplicates: true },
        ),
      );
    } else {
      check(
        await supabase
          .from("analytics_favorites")
          .delete()
          .eq("user_id", viewer.id)
          .eq("item_type", v.item_type)
          .eq("item_key", v.item_key),
      );
    }
    revalidatePath("/analytics", "layout");
    return { on: v.on };
  },
});

export const saveDashboard = defineAction({
  name: "analytics.save_dashboard",
  schema: dashboardSaveSchema,
  permissions: ["reports:build", "analytics:read"],
  handler: async (v, { supabase, viewer }) => {
    const row = { name: v.name, description: v.description, widgets: v.widgets, shared: v.shared };
    if (v.id) {
      const rows = check(
        await supabase
          .from("dashboards")
          .update(row)
          .eq("id", v.id)
          .eq("owner_id", viewer.id)
          .select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
      revalidatePath("/analytics/dashboards");
      return { id: v.id };
    }
    const created = check(
      await supabase
        .from("dashboards")
        .insert({ ...row, org_id: viewer.orgId, owner_id: viewer.id })
        .select("id")
        .single(),
    );
    revalidatePath("/analytics/dashboards");
    if (!created) throw new ActionFailure(actionError("server"));
    return { id: created.id };
  },
});

export const deleteDashboard = defineAction({
  name: "analytics.delete_dashboard",
  schema: dashboardIdSchema,
  permissions: ["reports:build"],
  handler: async (v, { supabase, viewer }) => {
    const rows = check(
      await supabase
        .from("dashboards")
        .delete()
        .eq("id", v.id)
        .eq("owner_id", viewer.id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    revalidatePath("/analytics/dashboards");
    return { deleted: true };
  },
});

export const saveSchedule = defineAction({
  name: "analytics.save_schedule",
  schema: scheduleSaveSchema,
  permissions: ["reports:build"],
  handler: async (v, { supabase, viewer }) => {
    const next = nextRunAt(
      { frequency: v.frequency, weekday: v.weekday, monthDay: v.month_day, hour: v.hour },
      new Date(),
    ).toISOString();
    const row = {
      report_id: v.report_id,
      frequency: v.frequency,
      weekday: v.frequency === "weekly" ? v.weekday : null,
      month_day: v.frequency === "monthly" ? v.month_day : null,
      hour: v.hour,
      recipient_ids: v.recipient_ids,
      active: v.active,
      next_run_at: next,
    };
    // The report must be one the person can read.
    const report = check(
      await supabase.from("reports").select("id").eq("id", v.report_id).maybeSingle(),
    );
    if (!report) throw new ActionFailure(actionError("not_found", "Pick a report you can open."));
    if (v.id) {
      const rows = check(
        await supabase.from("report_schedules").update(row).eq("id", v.id).select("id"),
      );
      if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
      revalidatePath("/analytics/schedules");
      return { id: v.id, nextRunAt: next };
    }
    const created = check(
      await supabase
        .from("report_schedules")
        .insert({ ...row, org_id: viewer.orgId })
        .select("id")
        .single(),
    );
    revalidatePath("/analytics/schedules");
    if (!created) throw new ActionFailure(actionError("server"));
    return { id: created.id, nextRunAt: next };
  },
});

export const deleteSchedule = defineAction({
  name: "analytics.delete_schedule",
  schema: scheduleIdSchema,
  permissions: ["reports:build"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase.from("report_schedules").delete().eq("id", v.id).select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    revalidatePath("/analytics/schedules");
    return { deleted: true };
  },
});
