import type { Permission } from "@/lib/permissions";
import type { ReportConfig } from "@/lib/domain/reports/config";
import type { ReportModuleId } from "@/lib/domain/reports/modules";

/**
 * The 10 seeded report templates of SPEC §8.14. The database rows come from
 * supabase/migrations/20261030000200_analytics_seed.sql; a unit test reads
 * that file and checks each config equals the one here.
 */

export const REPORT_CATEGORIES = ["sales", "marketing", "production", "finance", "custom"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  sales: "Sales",
  marketing: "Marketing",
  production: "Production",
  finance: "Finance",
  custom: "Custom",
};

export type ReportTemplate = {
  key: string;
  name: string;
  description: string;
  category: ReportCategory;
  module: ReportModuleId;
  config: ReportConfig;
  /** Extra permission beyond the module's (owner-only reports). */
  requires?: readonly Permission[];
};

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  {
    key: "sold_by_month",
    name: "Sold by month",
    description: "Jobs whose estimate was accepted, by month, with contract value.",
    category: "sales",
    module: "jobs",
    config: {
      columns: ["job_number", "name", "sold_at", "contract_cents", "owner_name", "territory"],
      filter: { match: "all", rules: [{ field: "sold_at", op: "is_not_empty" }] },
      groupBy: { field: "sold_at", bucket: "month" },
      summaries: [{ fn: "count" }, { fn: "sum", field: "contract_cents" }],
      chart: "bar",
      sort: { column: "sold_at", dir: "desc" },
    },
  },
  {
    key: "leads_by_source",
    name: "Leads by source",
    description: "Every lead by where it came from, with how many converted.",
    category: "marketing",
    module: "leads",
    config: {
      columns: ["name", "lead_source", "status", "territory", "created_at", "owner_name"],
      filter: { match: "all", rules: [] },
      groupBy: { field: "lead_source" },
      summaries: [{ fn: "count" }, { fn: "count_of", field: "converted_at" }],
      chart: "donut",
      sort: { column: "created_at", dir: "desc" },
    },
  },
  {
    key: "estimates_sent_vs_accepted",
    name: "Estimates sent vs accepted",
    description: "Estimates by the month they were first sent, and how many of them were accepted.",
    category: "sales",
    module: "estimates",
    config: {
      columns: [
        "estimate_number",
        "job_name",
        "owner_name",
        "first_sent_at",
        "status",
        "accepted_at",
        "total_cents",
      ],
      filter: { match: "all", rules: [{ field: "first_sent_at", op: "is_not_empty" }] },
      groupBy: { field: "first_sent_at", bucket: "month" },
      summaries: [{ fn: "count" }, { fn: "count_of", field: "accepted_at" }],
      chart: "bar",
      sort: { column: "first_sent_at", dir: "desc" },
    },
  },
  {
    key: "ar_aging",
    name: "A/R aging",
    description: "Sent invoices with money owed, by how far past due they are.",
    category: "finance",
    module: "invoices",
    config: {
      columns: [
        "invoice_number",
        "account_name",
        "job_name",
        "due_date",
        "days_past_due",
        "balance_cents",
        "aging_bucket",
      ],
      filter: {
        match: "all",
        rules: [
          { field: "issued", op: "equals", value: "true" },
          { field: "balance_cents", op: "gt", value: "0" },
        ],
      },
      groupBy: { field: "aging_bucket" },
      summaries: [{ fn: "count" }, { fn: "sum", field: "balance_cents" }],
      chart: "bar",
      sort: { column: "days_past_due", dir: "desc" },
    },
  },
  {
    key: "jobs_missing_daily_logs",
    name: "Jobs missing daily logs",
    description: "Production days in the last 30 days with no daily log (rain days don't count).",
    category: "production",
    module: "jobs",
    config: {
      columns: ["job_number", "name", "stage", "point_of_contact_name", "missed_daily_logs"],
      filter: { match: "all", rules: [{ field: "missed_daily_logs", op: "gt", value: "0" }] },
      groupBy: null,
      summaries: [{ fn: "count" }, { fn: "sum", field: "missed_daily_logs" }],
      chart: "table",
      sort: { column: "missed_daily_logs", dir: "desc" },
    },
  },
  {
    key: "sold_no_deposit",
    name: "Sold – no deposit",
    description: "Sold jobs whose deposit isn't paid yet.",
    category: "finance",
    module: "jobs",
    config: {
      columns: ["job_number", "name", "stage", "sold_at", "contract_cents", "owner_name"],
      filter: {
        match: "all",
        rules: [
          { field: "sold_at", op: "is_not_empty" },
          { field: "deposit_paid_at", op: "is_empty" },
          { field: "stage", op: "not_equals", value: "closed_lost" },
        ],
      },
      groupBy: null,
      summaries: [{ fn: "count" }, { fn: "sum", field: "contract_cents" }],
      chart: "table",
      sort: { column: "sold_at", dir: "asc" },
    },
  },
  {
    key: "gross_margin_by_job",
    name: "Gross margin by job",
    description:
      "Completed jobs: contract, direct costs and gross margin. Owners and the bookkeeper only.",
    category: "finance",
    module: "jobs",
    requires: ["job_costing:read"],
    config: {
      columns: [
        "job_number",
        "name",
        "completed_at",
        "contract_cents",
        "cost_cents",
        "margin_cents",
        "margin_percent",
      ],
      filter: { match: "all", rules: [{ field: "completed_at", op: "is_not_empty" }] },
      groupBy: null,
      summaries: [
        { fn: "count" },
        { fn: "sum", field: "contract_cents" },
        { fn: "sum", field: "margin_cents" },
      ],
      chart: "table",
      sort: { column: "completed_at", dir: "desc" },
    },
  },
  {
    key: "speed_to_lead",
    name: "Speed to lead",
    description:
      "Minutes from a lead arriving to a person first reaching them (business hours), by month.",
    category: "sales",
    module: "leads",
    config: {
      columns: [
        "name",
        "lead_source",
        "created_at",
        "first_contacted_at",
        "speed_to_lead_minutes",
        "owner_name",
      ],
      filter: { match: "all", rules: [{ field: "speed_to_lead_minutes", op: "is_not_empty" }] },
      groupBy: { field: "created_at", bucket: "month" },
      summaries: [{ fn: "count" }, { fn: "avg", field: "speed_to_lead_minutes" }],
      chart: "line",
      sort: { column: "created_at", dir: "desc" },
    },
  },
  {
    key: "sla_24h_misses",
    name: "24h SLA misses",
    description: "Estimates sent later than the estimate SLA after the walkthrough.",
    category: "sales",
    module: "estimates",
    config: {
      columns: [
        "estimate_number",
        "job_name",
        "owner_name",
        "walkthrough_completed_at",
        "first_sent_at",
        "hours_to_send",
      ],
      filter: { match: "all", rules: [{ field: "sla_met", op: "equals", value: "false" }] },
      groupBy: { field: "owner_name" },
      summaries: [{ fn: "count" }, { fn: "avg", field: "hours_to_send" }],
      chart: "table",
      sort: { column: "first_sent_at", dir: "desc" },
    },
  },
  {
    key: "on_time_start_misses",
    name: "On-time start misses",
    description: "Jobs that started after their guaranteed start date (rain delays don't count).",
    category: "production",
    module: "jobs",
    config: {
      columns: [
        "job_number",
        "name",
        "guarantee_start_date",
        "actual_start_date",
        "on_time_guarantee_status",
        "point_of_contact_name",
      ],
      filter: { match: "all", rules: [{ field: "started_late", op: "equals", value: "true" }] },
      groupBy: null,
      summaries: [{ fn: "count" }],
      chart: "table",
      sort: { column: "actual_start_date", dir: "desc" },
    },
  },
];

export function templateByKey(key: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.key === key);
}
