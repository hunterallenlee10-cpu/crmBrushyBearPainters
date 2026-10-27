import type { FieldDef, QueryOp } from "@/lib/lists/filters";
import type { ChipDef, ListContext, ListModule } from "@/lib/lists/params";
import { JOB_STAGES, TERMINAL_STAGES, isJobStageId, type JobStageId } from "@/lib/domain/stages";
import {
  JOB_PRIORITIES,
  JOB_PRIORITY_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
} from "@/lib/domain/jobs/constants";

/**
 * Job List definition (SPEC §8.5). Stage changes never happen from the list
 * (only through the job page's Advance flow), so there is no stage bulk action.
 *
 * Target/start date (`promised_start_date`) is a calendar `date`, not a
 * timestamp. The shared date filter compares against Pacific day boundaries
 * as UTC timestamps, which Postgres casts to the next UTC day for `date`
 * columns, so that column is sortable but not offered as an Advanced rule.
 */

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

export const JOB_FIELDS: readonly FieldDef[] = [
  { key: "name", label: "Job name", type: "text", column: "name", searchColumn: "search_text" },
  { key: "job_number", label: "Job #", type: "text", column: "job_number" },
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
    key: "priority",
    label: "Priority",
    type: "enum",
    column: "priority",
    options: opts(JOB_PRIORITIES, JOB_PRIORITY_LABELS),
  },
  {
    key: "work_type",
    label: "Work type",
    type: "array",
    column: "work_types",
    optionSource: "picklist:work_type",
  },
  { key: "owner", label: "Owner", type: "user", column: "owner_id", optionSource: "users" },
  {
    key: "point_of_contact",
    label: "Point of contact",
    type: "user",
    column: "point_of_contact_id",
    optionSource: "users",
  },
  {
    key: "project_manager",
    label: "Project manager",
    type: "user",
    column: "project_manager_id",
    optionSource: "users",
  },
  {
    key: "territory",
    label: "Territory",
    type: "enum",
    column: "territory_id",
    optionSource: "territories",
  },
  {
    key: "source",
    label: "Lead source",
    type: "enum",
    column: "lead_source",
    optionSource: "picklist:lead_source",
  },
  { key: "health", label: "Health score", type: "number", column: "health_score" },
  { key: "active_holds", label: "Active holds", type: "number", column: "active_hold_count" },
  { key: "created", label: "Created", type: "date", column: "created_at" },
  { key: "stage_entered", label: "In stage since", type: "date", column: "stage_entered_at" },
  { key: "sold", label: "Sold (estimate accepted)", type: "date", column: "estimate_accepted_at" },
  { key: "closed", label: "Closed", type: "date", column: "closed_at" },
];

const TERMINAL_IN = `(${TERMINAL_STAGES.join(",")})`;
/** Open = not Closed Won / Closed Lost (same rule as `job_status_counts.active`). */
export const OPEN_JOBS_OP: QueryOp = {
  kind: "filter",
  column: "stage",
  op: "not.in",
  value: TERMINAL_IN,
};

/** "My Jobs": I'm the owner, point of contact, project manager or on the job team. */
export function myJobsOp(userId: string): QueryOp {
  return { kind: "filter", column: "team_user_ids", op: "cs", value: `{${userId}}` };
}

export const ON_HOLD_CHIP = "on_hold";

/** One chip per stage, in pipeline order (either/or), plus "On hold". */
export const JOB_CHIPS: readonly ChipDef[] = [
  ...JOB_STAGES.map((s) => ({ id: s.id, label: s.label, group: "stage" })),
  { id: ON_HOLD_CHIP, label: "On hold" },
];

/** Stage chips that make sense on a tab: closed stages only appear on All. */
export function chipsForTab(tab: string, selected: readonly string[] = []): ChipDef[] {
  return JOB_CHIPS.filter(
    (c) =>
      tab === "all" ||
      selected.includes(c.id) ||
      !(isJobStageId(c.id) && TERMINAL_STAGES.includes(c.id)),
  );
}

/** Lowercases and strips characters PostgREST treats as syntax. */
export function cleanJobSearch(q: string): string {
  return q
    .toLowerCase()
    .replace(/[*%(),"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const JOBS_LIST: ListModule = {
  id: "jobs",
  label: "Jobs",
  fields: JOB_FIELDS,
  columns: [
    { id: "job_number", label: "Job #", defaultVisible: true, sortColumn: "job_number" },
    { id: "priority", label: "Priority", defaultVisible: true },
    { id: "name", label: "Name", defaultVisible: true, sortColumn: "name", locked: true },
    { id: "account", label: "Account", defaultVisible: true },
    { id: "amount", label: "Amount", defaultVisible: true },
    { id: "stage", label: "Stage", defaultVisible: true },
    { id: "work_types", label: "Work types", defaultVisible: true },
    {
      id: "start",
      label: "Target/Start date",
      defaultVisible: true,
      sortColumn: "promised_start_date",
    },
    { id: "point_of_contact", label: "Point of contact", defaultVisible: true },
    { id: "owner", label: "Owner", defaultVisible: true },
    { id: "health", label: "Health", defaultVisible: true, sortColumn: "health_score" },
    { id: "status", label: "Status", defaultVisible: false, sortColumn: "status" },
    { id: "project_manager", label: "Project manager", defaultVisible: false },
    { id: "source", label: "Lead source", defaultVisible: false, sortColumn: "lead_source" },
    {
      id: "stage_entered",
      label: "In stage since",
      defaultVisible: false,
      sortColumn: "stage_entered_at",
    },
    { id: "created", label: "Created", defaultVisible: false, sortColumn: "created_at" },
  ],
  tabs: [
    { id: "active", label: "Active", countKey: "active" },
    { id: "mine", label: "My Jobs", countKey: "mine" },
    { id: "all", label: "All", countKey: "total" },
  ],
  chips: JOB_CHIPS,
  defaultTab: "active",
  defaultSort: { column: "created_at", dir: "desc" },
  searchPlaceholder: "Search job # or name…",
  searchOps: (q) => {
    const term = cleanJobSearch(q);
    return term ? [{ kind: "filter", column: "search_text", op: "ilike", value: `*${term}*` }] : [];
  },
  tabOps: (tab, ctx: ListContext) => {
    switch (tab) {
      case "active":
        return [OPEN_JOBS_OP];
      case "mine":
        return [OPEN_JOBS_OP, myJobsOp(ctx.userId)];
      default:
        return [];
    }
  },
  chipOps: (chip) => {
    if (chip === ON_HOLD_CHIP) {
      return [{ kind: "filter", column: "status", op: "eq", value: "on_hold" }];
    }
    if (isJobStageId(chip)) return [{ kind: "filter", column: "stage", op: "eq", value: chip }];
    return [];
  },
};

/** Columns someone without financials:read may see (no Amount). */
export function jobColumnsFor(canSeeMoney: boolean) {
  return canSeeMoney ? JOBS_LIST.columns : JOBS_LIST.columns.filter((c) => c.id !== "amount");
}

/** The list module as seen by a viewer (no Amount column without financials:read). */
export function jobsListFor(canSeeMoney: boolean): ListModule {
  return canSeeMoney ? JOBS_LIST : { ...JOBS_LIST, columns: jobColumnsFor(false) };
}

/** Drill-down link into the Job List (tab, chips, advanced filter `f`). */
export const JOB_LIST_PATH = "/jobs/list";

/** Stage → list link: closed stages open the All tab (Active hides them). */
export function stageListQuery(stage: JobStageId): { tab?: string; chips: string[] } {
  return TERMINAL_STAGES.includes(stage) ? { tab: "all", chips: [stage] } : { chips: [stage] };
}
