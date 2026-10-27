import { JOB_STAGES, getStage, isJobStageId, type JobStageId } from "@/lib/domain/stages";

/**
 * Job Recovery (Admin → Job Recovery, owners): finds jobs that look stuck or
 * inconsistent and says what to do. Pure: it reads the facts from
 * `job_recovery_scan()` and returns issues. Fixes go through
 * advanceJobStage() (owner override with a reason) or a milestone edit with a
 * reason; nothing here writes.
 */

export type RecoveryFacts = {
  jobId: string;
  jobNumber: string | null;
  name: string;
  stage: string;
  status: string;
  stageEnteredAt: string | null;
  lastFromStage: string | null;
  lastOverride: boolean;
  /** Whether the gate the job passed to enter its stage still passes (null = not checked). */
  gatePasses: boolean | null;
  blockingHolds: number;
  milestones: Record<string, string | null>;
  hasPublishedSchedule: boolean;
  hasAcceptedEstimate: boolean;
};

export type RecoveryIssueKind =
  | "gate_no_longer_passes"
  | "missing_milestone"
  | "stage_too_long"
  | "scheduled_without_schedule"
  | "sold_without_estimate"
  | "hold_but_scheduled";

export type RecoveryFix =
  | { kind: "move_stage"; to: JobStageId; label: string }
  | { kind: "set_milestone"; field: string; suggested: string | null; label: string }
  | { kind: "open_job"; section: string; label: string };

export type RecoveryIssue = {
  kind: RecoveryIssueKind;
  severity: "high" | "medium";
  message: string;
  fixes: RecoveryFix[];
};

export type RecoveryRow = RecoveryFacts & { daysInStage: number | null; issues: RecoveryIssue[] };

/**
 * Days in a stage after which a job is flagged for a look (not a business
 * rule; a prompt to check). Jobs past both this and the company's own 90th
 * percentile for the stage (with 10+ jobs there) are flagged.
 */
export const STAGE_AGE_FLAG_DAYS: Partial<Record<JobStageId, number>> = {
  walkthrough_scheduled: 21,
  walkthrough_complete: 7,
  estimate_sent: 45,
  sold: 14,
  onboarding: 21,
  ready_to_schedule: 60,
  scheduled: 45,
  in_progress: 30,
  final_walkthrough: 14,
  completed: 14,
  invoiced: 45,
  paid_in_full: 7,
};

/** The milestone each stage should have stamped once the job reaches it. */
export const STAGE_MILESTONES: readonly { from: JobStageId; field: string; label: string }[] = [
  {
    from: "walkthrough_complete",
    field: "walkthrough_completed_at",
    label: "Walkthrough completed",
  },
  { from: "estimate_sent", field: "estimate_sent_at", label: "Estimate sent" },
  { from: "sold", field: "estimate_accepted_at", label: "Estimate accepted" },
  { from: "ready_to_schedule", field: "ready_to_schedule_at", label: "Ready to schedule" },
  { from: "scheduled", field: "scheduled_at", label: "Scheduled" },
  { from: "completed", field: "completed_at", label: "Completed" },
  { from: "invoiced", field: "final_invoiced_at", label: "Final invoice sent" },
  { from: "paid_in_full", field: "paid_in_full_at", label: "Paid in full" },
];

const ORDER = new Map(JOB_STAGES.map((s) => [s.id, s.order]));

function stageOrder(id: string): number {
  return ORDER.get(id as JobStageId) ?? -1;
}

function label(id: string): string {
  return isJobStageId(id) ? getStage(id).label : id;
}

export function daysBetween(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** 90th percentile (nearest rank) of a list of numbers. */
export function percentile90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)]!;
}

/** Turns scan rows into rows with issues (jobs without issues are kept, with none). */
export function findRecoveryIssues(
  facts: readonly RecoveryFacts[],
  now: Date = new Date(),
): RecoveryRow[] {
  const ages = new Map<string, number[]>();
  const rows = facts.map((f) => {
    const days = daysBetween(f.stageEnteredAt, now);
    if (days !== null) ages.set(f.stage, [...(ages.get(f.stage) ?? []), days]);
    return { ...f, daysInStage: days, issues: [] as RecoveryIssue[] };
  });
  const p90 = new Map(
    [...ages].map(([stage, list]) => [stage, list.length >= 10 ? percentile90(list) : null]),
  );

  for (const row of rows) {
    const order = stageOrder(row.stage);
    const stage = isJobStageId(row.stage) ? row.stage : null;
    if (!stage || row.status === "lost") continue;

    if (row.gatePasses === false && row.lastFromStage && isJobStageId(row.lastFromStage)) {
      row.issues.push({
        kind: "gate_no_longer_passes",
        severity: "high",
        message: `This job is at ${label(stage)}, but the check it passed to leave ${label(row.lastFromStage)} no longer passes.`,
        fixes: [
          {
            kind: "move_stage",
            to: row.lastFromStage,
            label: `Move back to ${label(row.lastFromStage)}`,
          },
          { kind: "open_job", section: "overview", label: "Open the job to see the check" },
        ],
      });
    }

    for (const m of STAGE_MILESTONES) {
      if (order >= stageOrder(m.from) && stage !== "closed_lost" && !row.milestones[m.field]) {
        row.issues.push({
          kind: "missing_milestone",
          severity: "medium",
          message: `"${m.label}" isn't stamped although the job is past ${label(m.from)}.`,
          fixes: [
            {
              kind: "set_milestone",
              field: m.field,
              suggested: row.stageEnteredAt,
              label: `Set "${m.label}"`,
            },
          ],
        });
      }
    }

    if ((stage === "scheduled" || stage === "in_progress") && !row.hasPublishedSchedule) {
      row.issues.push({
        kind: "scheduled_without_schedule",
        severity: "high",
        message: `The job is ${label(stage)} but has no published schedule.`,
        fixes: [
          { kind: "open_job", section: "schedule", label: "Open the job's schedule" },
          { kind: "move_stage", to: "ready_to_schedule", label: "Move back to Ready to Schedule" },
        ],
      });
    }

    if (
      order >= stageOrder("sold") &&
      order <= stageOrder("closed_won") &&
      !row.hasAcceptedEstimate
    ) {
      row.issues.push({
        kind: "sold_without_estimate",
        severity: "medium",
        message: "The job is past Sold but has no accepted estimate, so the contract may read $0.",
        fixes: [{ kind: "open_job", section: "estimate", label: "Open the estimate" }],
      });
    }

    if (row.blockingHolds > 0 && (stage === "scheduled" || stage === "in_progress")) {
      row.issues.push({
        kind: "hold_but_scheduled",
        severity: "high",
        message: `A hold that blocks scheduling is still open while the job is ${label(stage)}.`,
        fixes: [{ kind: "open_job", section: "overview", label: "Review the holds" }],
      });
    }

    const flag = STAGE_AGE_FLAG_DAYS[stage];
    const pct = p90.get(row.stage) ?? null;
    if (
      flag !== undefined &&
      row.daysInStage !== null &&
      row.daysInStage > flag &&
      (pct === null || row.daysInStage > pct)
    ) {
      row.issues.push({
        kind: "stage_too_long",
        severity: "medium",
        message: `In ${label(stage)} for ${row.daysInStage} days (flag after ${flag}${pct !== null ? `; most jobs here are under ${pct}` : ""}).`,
        fixes: [{ kind: "open_job", section: "overview", label: "Open the job" }],
      });
    }
  }
  return rows;
}

/** Only rows with issues, most serious first, then longest in stage. */
export function stuckJobs(rows: readonly RecoveryRow[]): RecoveryRow[] {
  const weight = (r: RecoveryRow) =>
    r.issues.reduce((s, i) => s + (i.severity === "high" ? 10 : 1), 0);
  return rows
    .filter((r) => r.issues.length > 0)
    .sort((a, b) => weight(b) - weight(a) || (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
}

export const RECOVERY_REASON_MIN = 10;
