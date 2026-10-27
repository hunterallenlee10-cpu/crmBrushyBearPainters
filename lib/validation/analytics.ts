import { z } from "zod";
import { optionalMoneyCents, optionalText, requiredText } from "@/lib/validation/common";
import { reportConfigSchema } from "@/lib/domain/reports/config";
import { REPORT_MODULE_IDS } from "@/lib/domain/reports/modules";
import { FREQUENCIES } from "@/lib/domain/reports/schedule";
import { ANALYTICS_BREAKDOWNS, ANALYTICS_METRICS } from "@/lib/metrics/registry";

/**
 * Analytics inputs (SPEC §8.14, §8.15, §12): Ask, saved reports, dashboards,
 * favorites, schedules, export logging, marketing spend and revenue goals.
 * Shared by the Server Actions and the forms; kept out of "use server" files
 * because the refinements are callbacks (DECISIONS 2026-10-27).
 */

const id = (label = "Record") => z.guid(`${label} is missing or invalid.`);
const MONTH = /^\d{4}-\d{2}-01$/;
const KEY = /^[a-z0-9_]{1,80}$/;

export const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a question.").max(300, "Keep it under 300 characters."),
});

export const dailyBriefSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day."),
});

export const reportSaveSchema = z.object({
  id: id("Report").optional(),
  name: requiredText("Name", 120),
  description: optionalText(500),
  module: z.enum(REPORT_MODULE_IDS),
  config: reportConfigSchema,
  shared: z.boolean().default(false),
});
export type ReportSaveInput = z.input<typeof reportSaveSchema>;

export const reportIdSchema = z.object({ id: id("Report") });

export const favoriteSchema = z.object({
  item_type: z.enum(["dashboard", "report"]),
  item_key: z.string().regex(/^[a-z0-9_-]{1,80}$/, "Pick something to favorite."),
  on: z.boolean(),
});

const widgetId = z
  .string()
  .refine((w) => w in ANALYTICS_METRICS || w in ANALYTICS_BREAKDOWNS, "Unknown widget.");

export const dashboardSaveSchema = z.object({
  id: id("Dashboard").optional(),
  name: requiredText("Name", 120),
  description: optionalText(500),
  widgets: z.array(widgetId).min(1, "Pick at least one tile or chart.").max(30),
  shared: z.boolean().default(false),
});
export type DashboardSaveInput = z.input<typeof dashboardSaveSchema>;

export const dashboardIdSchema = z.object({ id: id("Dashboard") });

export const scheduleSaveSchema = z
  .object({
    id: id("Schedule").optional(),
    report_id: id("Report"),
    frequency: z.enum(FREQUENCIES),
    weekday: z.number().int().min(1).max(7).nullable().default(null),
    month_day: z.number().int().min(1).max(28).nullable().default(null),
    hour: z.number().int().min(0).max(23),
    recipient_ids: z.array(id("Recipient")).min(1, "Pick at least one person.").max(20),
    active: z.boolean().default(true),
  })
  .refine((v) => v.frequency !== "weekly" || v.weekday !== null, {
    message: "Pick the day of the week.",
    path: ["weekday"],
  })
  .refine((v) => v.frequency !== "monthly" || v.month_day !== null, {
    message: "Pick the day of the month (1–28).",
    path: ["month_day"],
  });
export type ScheduleSaveInput = z.input<typeof scheduleSaveSchema>;

export const scheduleIdSchema = z.object({ id: id("Schedule") });

export const exportLogSchema = z.object({
  kind: z.enum(["chart", "kpi_table"]),
  dataset: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  row_count: z.number().int().min(0).max(1_000_000),
  filters: z.record(z.string().max(60), z.string().max(200)).default({}),
});
export type ExportLogInput = z.input<typeof exportLogSchema>;

export const marketingSpendSchema = z.object({
  month: z.string().regex(MONTH, "Pick a month."),
  rows: z
    .array(
      z.object({
        lead_source: z.string().regex(KEY, "Pick a lead source."),
        amount: optionalMoneyCents("Spend"),
      }),
    )
    .max(100),
});
export type MarketingSpendInput = z.input<typeof marketingSpendSchema>;

export const revenueGoalsSchema = z.object({
  months: z
    .array(
      z.object({
        month: z.string().regex(MONTH, "Pick a month."),
        goal: optionalMoneyCents("Goal"),
      }),
    )
    .min(1)
    .max(24),
});
export type RevenueGoalsInput = z.input<typeof revenueGoalsSchema>;
