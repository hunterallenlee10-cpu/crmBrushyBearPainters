import type { FieldDef, FieldOption } from "@/lib/lists/filters";
import type { Permission } from "@/lib/permissions";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  SERVICES,
  SERVICE_LABELS,
  TEMPERATURE_LABELS,
} from "@/lib/domain/leads/constants";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/domain/jobs/constants";
import { JOB_STAGES } from "@/lib/domain/stages";
import { ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS } from "@/lib/domain/estimating/constants";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
} from "@/lib/domain/ledger/types";

/**
 * Report builder modules (SPEC §8.14). Each module is a security_invoker view
 * (supabase/migrations/20261030000100_analytics.sql: report_leads, report_jobs,
 * report_estimates, report_invoices), so a report shows exactly the rows the
 * person may read. Columns, filters and groupings are whitelisted here; only
 * these names ever reach the database.
 */

export const REPORT_MODULE_IDS = ["leads", "jobs", "estimates", "invoices"] as const;
export type ReportModuleId = (typeof REPORT_MODULE_IDS)[number];

export type ColumnKind =
  | "text"
  | "number"
  | "money"
  | "timestamp"
  | "day"
  | "boolean"
  | "enum"
  | "array"
  | "percent_number";

export type ReportColumn = {
  id: string;
  label: string;
  kind: ColumnKind;
  /** Labels for enum / array values. */
  labels?: Readonly<Record<string, string>>;
  /** Name of a runtime label source ("picklist:lead_source"). */
  labelSource?: string;
  /** Extra permissions needed to see the column (null values otherwise). */
  requires?: readonly Permission[];
  /** Can be grouped on (dates group by day / week / month / quarter / year). */
  groupable?: boolean;
  /** Numeric columns can be summed / averaged. */
  numeric?: boolean;
};

export type ReportModule = {
  id: ReportModuleId;
  label: string;
  view: "report_leads" | "report_jobs" | "report_estimates" | "report_invoices";
  /** Permission to read the module at all. */
  requires: Permission;
  /** Where a row links to. */
  rowHref: (row: Record<string, unknown>) => string | null;
  /** The column naming a row (first column of "View data"). */
  titleColumn: string;
  columns: readonly ReportColumn[];
  /** Filter fields (keys are view columns; money values are entered in dollars). */
  fields: readonly FieldDef[];
  defaultColumns: readonly string[];
};

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>): FieldOption[] =>
  keys.map((k) => ({ value: k, label: labels[k] }));
const rec = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  Object.fromEntries(keys.map((k) => [k, labels[k]])) as Record<string, string>;
const STAGE_LABELS = Object.fromEntries(JOB_STAGES.map((s) => [s.id, s.label])) as Record<
  string,
  string
>;
const MONEY: readonly Permission[] = ["financials:read"];
const COSTS: readonly Permission[] = ["job_costing:read"];
const BOOL = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const ON_TIME_LABELS: Record<string, string> = {
  "n/a": "Not tracked yet",
  met: "Met",
  missed_weather: "Missed (weather)",
  missed_credit_pending: "Missed – credit pending",
  credit_applied: "Credit applied",
  waived_by_owner: "Waived by owner",
};
const AGING_BUCKETS = ["Not owed", "Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"];

const uuidLike = (v: unknown): v is string => typeof v === "string" && v.length === 36;

export const REPORT_MODULES: Record<ReportModuleId, ReportModule> = {
  leads: {
    id: "leads",
    label: "Leads",
    view: "report_leads",
    requires: "leads:read",
    rowHref: (r) => (uuidLike(r.id) ? `/leads/${r.id}` : null),
    titleColumn: "name",
    columns: [
      { id: "name", label: "Name", kind: "text" },
      {
        id: "status",
        label: "Status",
        kind: "enum",
        labels: rec(LEAD_STATUSES, LEAD_STATUS_LABELS),
        groupable: true,
      },
      {
        id: "lead_source",
        label: "Source",
        kind: "enum",
        labelSource: "picklist:lead_source",
        groupable: true,
      },
      {
        id: "lead_sub_source",
        label: "Sub-source",
        kind: "enum",
        labelSource: "picklist:lead_sub_source",
        groupable: true,
      },
      { id: "services", label: "Services", kind: "array", labels: rec(SERVICES, SERVICE_LABELS) },
      { id: "city", label: "City (address)", kind: "text", groupable: true },
      { id: "territory", label: "Territory", kind: "text", groupable: true },
      { id: "owner_name", label: "Owner", kind: "text", groupable: true },
      { id: "grade", label: "Grade", kind: "text", groupable: true },
      { id: "score", label: "Score", kind: "number", numeric: true },
      {
        id: "temperature",
        label: "Temperature",
        kind: "enum",
        labels: TEMPERATURE_LABELS,
        groupable: true,
      },
      { id: "created_at", label: "Created", kind: "timestamp", groupable: true },
      { id: "first_contacted_at", label: "First contact", kind: "timestamp", groupable: true },
      { id: "speed_to_lead_minutes", label: "Speed to lead (min)", kind: "number", numeric: true },
      { id: "walkthrough_at", label: "Walkthrough", kind: "timestamp", groupable: true },
      { id: "converted_at", label: "Converted", kind: "timestamp", groupable: true },
      { id: "last_activity_at", label: "Last activity", kind: "timestamp" },
    ],
    fields: [
      {
        key: "status",
        label: "Status",
        type: "enum",
        column: "status",
        options: opts(LEAD_STATUSES, LEAD_STATUS_LABELS),
      },
      {
        key: "lead_source",
        label: "Source",
        type: "enum",
        column: "lead_source",
        optionSource: "picklist:lead_source",
      },
      {
        key: "territory_id",
        label: "Territory",
        type: "enum",
        column: "territory_id",
        optionSource: "territories",
      },
      { key: "owner_id", label: "Owner", type: "user", column: "owner_id", optionSource: "users" },
      {
        key: "services",
        label: "Services",
        type: "array",
        column: "services",
        options: opts(SERVICES, SERVICE_LABELS),
      },
      { key: "created_at", label: "Created", type: "date", column: "created_at" },
      {
        key: "first_contacted_at",
        label: "First contact",
        type: "date",
        column: "first_contacted_at",
      },
      { key: "converted_at", label: "Converted", type: "date", column: "converted_at" },
      {
        key: "speed_to_lead_minutes",
        label: "Speed to lead (min)",
        type: "number",
        column: "speed_to_lead_minutes",
      },
      { key: "score", label: "Score", type: "number", column: "score" },
    ],
    defaultColumns: ["name", "status", "lead_source", "territory", "created_at", "owner_name"],
  },
  jobs: {
    id: "jobs",
    label: "Jobs",
    view: "report_jobs",
    requires: "jobs:read",
    rowHref: (r) => (uuidLike(r.id) ? `/jobs/${r.id}` : null),
    titleColumn: "name",
    columns: [
      { id: "job_number", label: "Job #", kind: "text" },
      { id: "name", label: "Name", kind: "text" },
      { id: "stage", label: "Stage", kind: "enum", labels: STAGE_LABELS, groupable: true },
      {
        id: "status",
        label: "Status",
        kind: "enum",
        labels: rec(JOB_STATUSES, JOB_STATUS_LABELS),
        groupable: true,
      },
      { id: "work_types", label: "Work types", kind: "array", labelSource: "picklist:work_type" },
      {
        id: "primary_work_type",
        label: "Main work type",
        kind: "enum",
        labelSource: "picklist:work_type",
        groupable: true,
      },
      { id: "territory", label: "Territory", kind: "text", groupable: true },
      { id: "owner_name", label: "Owner", kind: "text", groupable: true },
      { id: "point_of_contact_name", label: "Point of contact", kind: "text", groupable: true },
      {
        id: "lead_source",
        label: "Lead source",
        kind: "enum",
        labelSource: "picklist:lead_source",
        groupable: true,
      },
      { id: "created_at", label: "Created", kind: "timestamp", groupable: true },
      {
        id: "walkthrough_completed_at",
        label: "Walkthrough done",
        kind: "timestamp",
        groupable: true,
      },
      { id: "sold_at", label: "Sold", kind: "timestamp", groupable: true },
      { id: "deposit_paid_at", label: "Deposit paid", kind: "timestamp", groupable: true },
      { id: "promised_start_date", label: "Promised start", kind: "day", groupable: true },
      { id: "guarantee_start_date", label: "Guaranteed start", kind: "day", groupable: true },
      { id: "actual_start_date", label: "Actual start", kind: "day", groupable: true },
      { id: "completed_at", label: "Completed", kind: "timestamp", groupable: true },
      { id: "paid_in_full_at", label: "Paid in full", kind: "timestamp", groupable: true },
      {
        id: "on_time_guarantee_status",
        label: "On-time guarantee",
        kind: "enum",
        labels: ON_TIME_LABELS,
        groupable: true,
      },
      { id: "contract_cents", label: "Contract", kind: "money", requires: MONEY, numeric: true },
      { id: "balance_cents", label: "Balance", kind: "money", requires: MONEY, numeric: true },
      { id: "cost_cents", label: "Direct cost", kind: "money", requires: COSTS, numeric: true },
      { id: "margin_cents", label: "Gross margin", kind: "money", requires: COSTS, numeric: true },
      {
        id: "margin_percent",
        label: "Margin %",
        kind: "percent_number",
        requires: COSTS,
        numeric: true,
      },
      { id: "started_late", label: "Started late", kind: "boolean", groupable: true },
      { id: "sales_velocity_days", label: "Days lead → sold", kind: "number", numeric: true },
      {
        id: "days_completed_to_paid",
        label: "Days completed → paid",
        kind: "number",
        numeric: true,
      },
      {
        id: "missed_daily_logs",
        label: "Missed daily logs (30 days)",
        kind: "number",
        numeric: true,
      },
    ],
    fields: [
      {
        key: "stage",
        label: "Stage",
        type: "enum",
        column: "stage",
        options: JOB_STAGES.map((s) => ({ value: s.id, label: s.label })),
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        column: "status",
        options: opts(JOB_STATUSES, JOB_STATUS_LABELS),
      },
      {
        key: "work_types",
        label: "Work type",
        type: "array",
        column: "work_types",
        optionSource: "picklist:work_type",
      },
      {
        key: "territory_id",
        label: "Territory",
        type: "enum",
        column: "territory_id",
        optionSource: "territories",
      },
      { key: "owner_id", label: "Owner", type: "user", column: "owner_id", optionSource: "users" },
      {
        key: "lead_source",
        label: "Lead source",
        type: "enum",
        column: "lead_source",
        optionSource: "picklist:lead_source",
      },
      { key: "created_at", label: "Created", type: "date", column: "created_at" },
      { key: "sold_at", label: "Sold", type: "date", column: "sold_at" },
      { key: "deposit_paid_at", label: "Deposit paid", type: "date", column: "deposit_paid_at" },
      { key: "completed_at", label: "Completed", type: "date", column: "completed_at" },
      { key: "paid_in_full_at", label: "Paid in full", type: "date", column: "paid_in_full_at" },
      { key: "contract_cents", label: "Contract ($)", type: "number", column: "contract_cents" },
      {
        key: "missed_daily_logs",
        label: "Missed daily logs",
        type: "number",
        column: "missed_daily_logs",
      },
      {
        key: "started_late",
        label: "Started late",
        type: "boolean",
        column: "started_late",
        options: BOOL,
      },
      {
        key: "sales_velocity_days",
        label: "Days lead → sold",
        type: "number",
        column: "sales_velocity_days",
      },
      { key: "margin_percent", label: "Margin %", type: "number", column: "margin_percent" },
    ],
    defaultColumns: ["job_number", "name", "stage", "sold_at", "contract_cents", "owner_name"],
  },
  estimates: {
    id: "estimates",
    label: "Estimates",
    view: "report_estimates",
    requires: "estimates:read",
    rowHref: (r) => (uuidLike(r.job_id) ? `/jobs/${r.job_id}?section=estimate` : null),
    titleColumn: "estimate_number",
    columns: [
      { id: "estimate_number", label: "Estimate #", kind: "text" },
      { id: "title", label: "Title", kind: "text" },
      { id: "job_name", label: "Job", kind: "text" },
      { id: "job_number", label: "Job #", kind: "text" },
      {
        id: "status",
        label: "Status",
        kind: "enum",
        labels: rec(ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS),
        groupable: true,
      },
      { id: "owner_name", label: "Estimator", kind: "text", groupable: true },
      { id: "territory", label: "Territory", kind: "text", groupable: true },
      {
        id: "lead_source",
        label: "Lead source",
        kind: "enum",
        labelSource: "picklist:lead_source",
        groupable: true,
      },
      { id: "first_sent_at", label: "First sent", kind: "timestamp", groupable: true },
      { id: "accepted_at", label: "Accepted", kind: "timestamp", groupable: true },
      { id: "declined_at", label: "Declined", kind: "timestamp", groupable: true },
      { id: "expires_at", label: "Expires", kind: "timestamp", groupable: true },
      { id: "total_cents", label: "Total", kind: "money", numeric: true },
      { id: "walkthrough_completed_at", label: "Walkthrough done", kind: "timestamp" },
      { id: "hours_to_send", label: "Hours to send", kind: "number", numeric: true },
      { id: "sla_met", label: "Within SLA", kind: "boolean", groupable: true },
    ],
    fields: [
      {
        key: "status",
        label: "Status",
        type: "enum",
        column: "status",
        options: opts(ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS),
      },
      {
        key: "owner_id",
        label: "Estimator",
        type: "user",
        column: "owner_id",
        optionSource: "users",
      },
      {
        key: "territory_id",
        label: "Territory",
        type: "enum",
        column: "territory_id",
        optionSource: "territories",
      },
      {
        key: "lead_source",
        label: "Lead source",
        type: "enum",
        column: "lead_source",
        optionSource: "picklist:lead_source",
      },
      { key: "first_sent_at", label: "First sent", type: "date", column: "first_sent_at" },
      { key: "accepted_at", label: "Accepted", type: "date", column: "accepted_at" },
      { key: "total_cents", label: "Total ($)", type: "number", column: "total_cents" },
      { key: "hours_to_send", label: "Hours to send", type: "number", column: "hours_to_send" },
      { key: "sla_met", label: "Within SLA", type: "boolean", column: "sla_met", options: BOOL },
    ],
    defaultColumns: [
      "estimate_number",
      "job_name",
      "owner_name",
      "status",
      "first_sent_at",
      "total_cents",
    ],
  },
  invoices: {
    id: "invoices",
    label: "Invoices",
    view: "report_invoices",
    requires: "invoices:read",
    rowHref: (r) =>
      uuidLike(r.job_id) && uuidLike(r.id)
        ? `/jobs/${r.job_id}?section=financial&tab=invoices&invoice=${r.id}`
        : null,
    titleColumn: "invoice_number",
    columns: [
      { id: "invoice_number", label: "Invoice #", kind: "text" },
      { id: "job_name", label: "Job", kind: "text" },
      { id: "job_number", label: "Job #", kind: "text" },
      { id: "account_name", label: "Customer", kind: "text", groupable: true },
      {
        id: "invoice_type",
        label: "Type",
        kind: "enum",
        labels: rec(INVOICE_TYPES, INVOICE_TYPE_LABELS),
        groupable: true,
      },
      {
        id: "status",
        label: "Status",
        kind: "enum",
        labels: rec(INVOICE_STATUSES, INVOICE_STATUS_LABELS),
        groupable: true,
      },
      { id: "issue_date", label: "Issued", kind: "day", groupable: true },
      { id: "due_date", label: "Due", kind: "day", groupable: true },
      { id: "total_cents", label: "Total", kind: "money", numeric: true },
      { id: "collected_cents", label: "Collected", kind: "money", numeric: true },
      { id: "balance_cents", label: "Balance", kind: "money", numeric: true },
      { id: "days_past_due", label: "Days past due", kind: "number", numeric: true },
      { id: "aging_bucket", label: "Aging", kind: "text", groupable: true },
      { id: "owner_name", label: "Job owner", kind: "text", groupable: true },
      { id: "territory", label: "Territory", kind: "text", groupable: true },
    ],
    fields: [
      {
        key: "invoice_type",
        label: "Type",
        type: "enum",
        column: "invoice_type",
        options: opts(INVOICE_TYPES, INVOICE_TYPE_LABELS),
      },
      {
        key: "status",
        label: "Status",
        type: "enum",
        column: "status",
        options: opts(INVOICE_STATUSES, INVOICE_STATUS_LABELS),
      },
      { key: "issued", label: "Sent", type: "boolean", column: "issued", options: BOOL },
      { key: "balance_cents", label: "Balance ($)", type: "number", column: "balance_cents" },
      { key: "total_cents", label: "Total ($)", type: "number", column: "total_cents" },
      { key: "days_past_due", label: "Days past due", type: "number", column: "days_past_due" },
      {
        key: "aging_bucket",
        label: "Aging",
        type: "enum",
        column: "aging_bucket",
        options: AGING_BUCKETS.map((b) => ({ value: b, label: b })),
      },
      {
        key: "owner_id",
        label: "Job owner",
        type: "user",
        column: "owner_id",
        optionSource: "users",
      },
      {
        key: "territory_id",
        label: "Territory",
        type: "enum",
        column: "territory_id",
        optionSource: "territories",
      },
      { key: "created_at", label: "Created", type: "date", column: "created_at" },
    ],
    defaultColumns: ["invoice_number", "account_name", "status", "due_date", "balance_cents"],
  },
};

/** Filter fields whose values are entered in dollars and stored in cents. */
export const MONEY_FILTER_KEYS = new Set(["contract_cents", "total_cents", "balance_cents"]);

export function isReportModuleId(v: unknown): v is ReportModuleId {
  return typeof v === "string" && (REPORT_MODULE_IDS as readonly string[]).includes(v);
}

export function moduleColumn(mod: ReportModule, id: string): ReportColumn | undefined {
  return mod.columns.find((c) => c.id === id);
}

/** Columns this viewer may see (money and cost columns need their permission). */
export function visibleColumns(mod: ReportModule, can: (p: Permission) => boolean): ReportColumn[] {
  return mod.columns.filter((c) => (c.requires ?? []).every(can));
}
