import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import { loadCustomFields } from "@/lib/custom-fields/server";
import {
  formatCustomValue,
  toCustomValues,
  withCustomFields,
  type CustomFieldDef,
} from "@/lib/domain/custom-fields";
import { csvFileName, toCsv, type CsvCell } from "@/lib/domain/reports/csv";
import { filterToOps } from "@/lib/lists/filters";
import { LEADS_LIST } from "@/lib/lists/modules/leads";
import { jobsListFor } from "@/lib/lists/modules/jobs";
import { listOps, parseListState } from "@/lib/lists/params";
import { applyOps, withOptions } from "@/lib/lists/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { loadJobOptions } from "@/lib/jobs/options";
import {
  actorLabel,
  parseAuditSearchParams,
  summarizeAuditEntry,
  tableLabel,
} from "@/lib/admin/audit-format";
import { formatPacific, pacificDateRangeToUtc } from "@/lib/admin/pacific";
import { pacificToday, ymdString } from "@/lib/domain/analytics/periods";

type Db = SupabaseClient<Database>;

export const EXPORT_ROW_CAP = 10_000;
const CHUNK = 1000;

export type ListExport = {
  title: string;
  csv: string;
  fileName: string;
  rows: number;
  truncated: boolean;
  filters: { [key: string]: Json };
};

/** Fetches every matching row (in 1,000-row pages, up to the cap) for a query builder. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < EXPORT_ROW_CAP; from += CHUNK) {
    const { data, error } = await page(from, Math.min(from + CHUNK, EXPORT_ROW_CAP) - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < CHUNK) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function customHeader(defs: readonly CustomFieldDef[]) {
  return defs.filter((d) => d.active).map((d) => d.label);
}
function customRow(
  defs: readonly CustomFieldDef[],
  raw: unknown,
  names: ReadonlyMap<string, string>,
): CsvCell[] {
  const v = toCustomValues(raw);
  return defs
    .filter((d) => d.active)
    .map((d) => (v[d.apiName] === undefined ? "" : formatCustomValue(d, v[d.apiName], names)));
}

/**
 * Builds the CSV for a list exactly as the person sees it filtered (row
 * security applies; money columns only for people who can see money).
 */
export async function buildListExport(
  db: Db,
  viewer: Viewer,
  list: "leads" | "jobs" | "audit_log",
  params: URLSearchParams,
): Promise<ListExport> {
  const day = ymdString(pacificToday());
  const now = new Date();
  if (list === "leads") {
    const defs = await loadCustomFields(db, "leads");
    const mod = withCustomFields(LEADS_LIST, defs);
    const state = parseListState(params, mod);
    const options = await loadLeadOptions(db);
    const fields = withOptions(mod.fields, options);
    const ops = listOps(
      state,
      mod,
      { userId: viewer.id, now },
      filterToOps(state.filter, fields, now),
    );
    const names = new Map(options.users.map((u) => [u.value, u.label]));
    const label = (key: keyof typeof options.picklists, v: string | null) =>
      v ? (options.picklists[key].find((o) => o.value === v)?.label ?? v) : "";
    const { rows, truncated } = await fetchAll((from, to) =>
      applyOps(
        db
          .from("leads")
          .select(
            "id, first_name, last_name, company, email, mobile, phone, street, city, zip, services, status, lead_source, lead_sub_source, score, grade, owner_id, created_at, custom_field_values",
          ),
        ops,
      )
        .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
        .order("id")
        .range(from, to),
    );
    const header = [
      "id",
      "First name",
      "Last name",
      "Company",
      "Email",
      "Mobile",
      "Phone",
      "Street",
      "City",
      "ZIP",
      "Services",
      "Status",
      "Lead source",
      "Sub-source",
      "Score",
      "Grade",
      "Owner",
      "Created (Pacific)",
      ...customHeader(defs),
    ];
    const body = rows.map((l) => [
      l.id,
      l.first_name,
      l.last_name,
      l.company,
      l.email,
      l.mobile,
      l.phone,
      l.street,
      l.city,
      l.zip,
      (l.services ?? []).join("; "),
      l.status,
      label("lead_source", l.lead_source),
      label("lead_sub_source", l.lead_sub_source),
      l.score,
      l.grade,
      l.owner_id ? (names.get(l.owner_id) ?? "") : "",
      formatPacific(l.created_at, "yyyy-MM-dd HH:mm"),
      ...customRow(defs, l.custom_field_values, names),
    ]);
    return {
      title: "Lead List",
      csv: toCsv(header, body),
      fileName: csvFileName("Lead List", day),
      rows: body.length,
      truncated,
      filters: { q: state.q, tab: state.tab, chips: state.chips, rules: state.filter.rules.length },
    };
  }
  if (list === "jobs") {
    const canSeeMoney = viewer.can("financials:read");
    const defs = await loadCustomFields(db, "jobs");
    const mod = withCustomFields(jobsListFor(canSeeMoney), defs);
    const state = parseListState(params, mod);
    const options = await loadJobOptions(db);
    const fields = withOptions(mod.fields, options);
    const ops = listOps(
      state,
      mod,
      { userId: viewer.id, now },
      filterToOps(state.filter, fields, now),
    );
    const names = new Map(options.users.map((u) => [u.value, u.label]));
    const { rows, truncated } = await fetchAll((from, to) =>
      applyOps(
        db
          .from("jobs")
          .select(
            "id, job_number, name, stage, status, priority, work_types, lead_source, owner_id, point_of_contact_id, promised_start_date, stage_entered_at, created_at, custom_field_values, account:accounts!jobs_account_id_fkey(display_name)",
          ),
        ops,
      )
        .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
        .order("id")
        .range(from, to),
    );
    const money = new Map<string, number | null>();
    if (canSeeMoney && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const { data } = await db
          .from("job_ledger")
          .select("job_id, contract_cents")
          .in(
            "job_id",
            rows.slice(i, i + 500).map((r) => r.id),
          );
        for (const m of data ?? []) if (m.job_id) money.set(m.job_id, m.contract_cents);
      }
    }
    const header = [
      "id",
      "Job #",
      "Name",
      "Customer",
      "Stage",
      "Status",
      "Priority",
      "Work types",
      "Lead source",
      "Owner",
      "Point of contact",
      "Promised start",
      "In stage since (Pacific)",
      "Created (Pacific)",
      ...(canSeeMoney ? ["Contract ($)"] : []),
      ...customHeader(defs),
    ];
    const body = rows.map((j) => [
      j.id,
      j.job_number,
      j.name,
      j.account?.display_name ?? "",
      j.stage,
      j.status,
      j.priority,
      (j.work_types ?? []).join("; "),
      j.lead_source,
      j.owner_id ? (names.get(j.owner_id) ?? "") : "",
      j.point_of_contact_id ? (names.get(j.point_of_contact_id) ?? "") : "",
      j.promised_start_date,
      j.stage_entered_at ? formatPacific(j.stage_entered_at, "yyyy-MM-dd HH:mm") : "",
      formatPacific(j.created_at, "yyyy-MM-dd HH:mm"),
      ...(canSeeMoney
        ? [money.has(j.id) && money.get(j.id) !== null ? (money.get(j.id)! / 100).toFixed(2) : ""]
        : []),
      ...customRow(defs, j.custom_field_values, names),
    ]);
    return {
      title: "Job List",
      csv: toCsv(header, body),
      fileName: csvFileName("Job List", day),
      rows: body.length,
      truncated,
      filters: { q: state.q, tab: state.tab, chips: state.chips, rules: state.filter.rules.length },
    };
  }
  // Audit log
  const { filters } = parseAuditSearchParams(Object.fromEntries(params.entries()));
  const range = pacificDateRangeToUtc(filters.from, filters.to);
  const { data: profiles } = await db
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", viewer.orgId)
    .limit(1000);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const { rows, truncated } = await fetchAll((from, to) => {
    let q = db
      .from("audit_log")
      .select(
        "id, at, table_name, record_id, action, actor_id, impersonated_by, before, after, changed_fields, ip",
      )
      .eq("org_id", viewer.orgId);
    if (filters.table) q = q.eq("table_name", filters.table);
    if (filters.action) q = q.eq("action", filters.action);
    if (filters.actor) q = q.or(`actor_id.eq.${filters.actor},impersonated_by.eq.${filters.actor}`);
    if (filters.record) q = q.eq("record_id", filters.record);
    if (range.gte) q = q.gte("at", range.gte);
    if (range.lt) q = q.lt("at", range.lt);
    return q.order("id", { ascending: false }).range(from, to);
  });
  const header = [
    "When (Pacific)",
    "Who",
    "What",
    "Record type",
    "Record id",
    "Action",
    "Changed fields",
    "IP",
  ];
  const body = rows.map((r) => [
    formatPacific(r.at, "yyyy-MM-dd HH:mm:ss"),
    actorLabel(r.actor_id, r.impersonated_by, names),
    summarizeAuditEntry(r, names),
    tableLabel(r.table_name),
    r.record_id,
    r.action,
    (r.changed_fields ?? []).join("; "),
    typeof r.ip === "string" ? r.ip : "",
  ]);
  return {
    title: "Audit Log",
    csv: toCsv(header, body),
    fileName: csvFileName("Audit Log", day),
    rows: body.length,
    truncated,
    filters: { ...filters } as { [key: string]: Json },
  };
}
