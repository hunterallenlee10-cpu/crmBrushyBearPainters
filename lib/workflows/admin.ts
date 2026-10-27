import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { getWorkflow, WORKFLOWS } from "@/lib/domain/workflows/catalog";
import type { WorkflowDefinition, WorkflowSubject } from "@/lib/domain/workflows/types";
import { formatAppointment, formatDate } from "@/lib/format/dates";

type Db = SupabaseClient<Database>;

/**
 * Loaders for Admin → Workflows (SPEC §11.1 "Live Engine Workflows": name,
 * trigger label, run count, last run, Test). Read with the person's own client
 * (row security: workflows:manage).
 */

export type WorkflowListRow = {
  def: WorkflowDefinition;
  enabled: boolean;
  disabledReason: string | null;
  runs: number;
  failed: number;
  waiting: number;
  lastRunAt: string | null;
  lastStatus: string | null;
};

export async function loadWorkflowList(db: Db): Promise<WorkflowListRow[]> {
  const [switches, stats] = await Promise.all([
    db.from("workflows").select("key, enabled, disabled_reason"),
    db.rpc("workflow_stats"),
  ]);
  if (switches.error) throw switches.error;
  const sw = new Map((switches.data ?? []).map((w) => [w.key, w]));
  const st = new Map((stats.data ?? []).map((s) => [s.workflow_key, s]));
  return WORKFLOWS.map((def) => {
    const s = st.get(def.key);
    const w = sw.get(def.key);
    return {
      def,
      enabled: w?.enabled ?? false,
      disabledReason: w?.disabled_reason ?? null,
      runs: Number(s?.runs ?? 0),
      failed: Number(s?.failed ?? 0),
      waiting: Number(s?.waiting ?? 0),
      lastRunAt: s?.last_run_at ?? null,
      lastStatus: s?.last_status ?? null,
    };
  });
}

export type RunRow = {
  id: string;
  status: string;
  dryRun: boolean;
  eventType: string;
  subjectType: string | null;
  subjectId: string | null;
  result: string | null;
  error: string | null;
  resumeAt: string | null;
  waitReason: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const toRun = (r: Database["public"]["Tables"]["workflow_runs"]["Row"]): RunRow => ({
  id: r.id,
  status: r.status,
  dryRun: r.dry_run,
  eventType: r.event_type,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  result: r.result,
  error: r.error,
  resumeAt: r.resume_at,
  waitReason: r.wait_reason,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

export async function loadRecentRuns(
  db: Db,
  opts: { key?: string; status?: string; limit?: number } = {},
): Promise<RunRow[]> {
  let q = db
    .from("workflow_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.key) q = q.eq("workflow_key", opts.key);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toRun);
}

export type TestCandidate = { id: string; label: string };

/** Records a Test can run against, newest first (the subject type of the workflow). */
export async function loadTestCandidates(db: Db, subject: WorkflowSubject): Promise<TestCandidate[]> {
  switch (subject) {
    case "lead": {
      const { data } = await db
        .from("leads")
        .select("id, first_name, last_name, status, city")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((l) => ({
        id: l.id,
        label: `${[l.first_name, l.last_name].filter(Boolean).join(" ")}${l.city ? ` · ${l.city}` : ""} · ${l.status.replace(/_/g, " ")}`,
      }));
    }
    case "job":
    case "rain_delay": {
      const { data } = await db
        .from("jobs")
        .select("id, name, job_number, stage")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((j) => ({ id: j.id, label: `${j.job_number} · ${j.name} · ${j.stage.replace(/_/g, " ")}` }));
    }
    case "appointment": {
      const { data } = await db
        .from("appointments")
        .select("id, type, starts_at, job:jobs(name), lead:leads(first_name, last_name)")
        .eq("type", "walkthrough")
        .is("deleted_at", null)
        .order("starts_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((a) => ({
        id: a.id,
        label: `Walkthrough ${formatAppointment(a.starts_at)} · ${a.job?.name ?? [a.lead?.first_name, a.lead?.last_name].filter(Boolean).join(" ")}`,
      }));
    }
    case "estimate": {
      const { data } = await db
        .from("estimates")
        .select("id, estimate_number, status, job:jobs!estimates_job_id_fkey(name)")
        .is("deleted_at", null)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((e) => ({ id: e.id, label: `${e.estimate_number} · ${e.job?.name ?? ""} · ${e.status}` }));
    }
    case "daily_log": {
      const { data } = await db
        .from("daily_logs")
        .select("id, log_date, job:jobs(name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((l) => ({ id: l.id, label: `${formatDate(`${l.log_date}T12:00:00Z`)} · ${l.job?.name ?? ""}` }));
    }
    case "invoice": {
      const { data } = await db
        .from("invoices")
        .select("id, invoice_number, status, job:jobs(name)")
        .order("created_at", { ascending: false })
        .limit(40);
      return (data ?? []).map((i) => ({ id: i.id, label: `${i.invoice_number} · ${i.job?.name ?? ""} · ${i.status}` }));
    }
    case "subcontractor": {
      const { data } = await db
        .from("subcontractors")
        .select("id, company_name, status")
        .is("deleted_at", null)
        .order("company_name")
        .limit(40);
      return (data ?? []).map((s) => ({ id: s.id, label: `${s.company_name} · ${s.status}` }));
    }
  }
}

export const SUBJECT_WORDS: Record<WorkflowSubject, string> = {
  lead: "lead",
  job: "job",
  rain_delay: "job (its latest rain delay)",
  appointment: "walkthrough",
  estimate: "sent estimate",
  daily_log: "daily log",
  invoice: "invoice",
  subcontractor: "subcontractor",
};

export function subjectHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "lead":
      return `/leads/${id}`;
    case "job":
    case "rain_delay":
      return `/jobs/${id}`;
    case "subcontractor":
      return `/admin/subcontractors?id=${id}`;
    default:
      return null;
  }
}

export type RunDetail = RunRow & {
  workflowKey: string;
  def: WorkflowDefinition | null;
  input: Json;
  steps: {
    index: number;
    id: string;
    kind: string;
    label: string;
    at: string;
    outcome: string;
    detail: string;
    until?: string;
  }[];
  nextStep: number;
  subjectHref: string | null;
};

export async function loadRun(db: Db, id: string): Promise<RunDetail | null> {
  const { data: r } = await db.from("workflow_runs").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  let href = subjectHref(r.subject_type, r.subject_id);
  if (!href && r.subject_id && ["appointment", "estimate", "daily_log", "invoice"].includes(r.subject_type ?? "")) {
    const table =
      r.subject_type === "appointment"
        ? "appointments"
        : r.subject_type === "estimate"
          ? "estimates"
          : r.subject_type === "daily_log"
            ? "daily_logs"
            : "invoices";
    const { data } = await db.from(table).select("job_id").eq("id", r.subject_id).maybeSingle();
    const jobId = (data as { job_id: string | null } | null)?.job_id;
    if (jobId) href = `/jobs/${jobId}`;
  }
  const steps = Array.isArray(r.steps) ? (r.steps as unknown as RunDetail["steps"]) : [];
  return {
    ...toRun(r),
    workflowKey: r.workflow_key,
    def: getWorkflow(r.workflow_key) ?? null,
    input: r.input,
    steps,
    nextStep: r.next_step,
    subjectHref: href,
  };
}
