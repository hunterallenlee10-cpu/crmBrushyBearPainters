import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { BUSINESS_TZ } from "@/lib/domain/leads/speed-to-lead";
import { getStage, type JobStageId } from "@/lib/domain/stages";
import { isTerminal, stageOrder } from "./gates";

/**
 * Job Health score 0–100 (SPEC §6.5). Pure and deterministic: weighted checks
 * chosen by stage. Checks whose data arrives in a later phase are shown as
 * "unavailable" and never lower the score; checks whose data wasn't loaded
 * (undefined inputs) are left out.
 */

export type HealthStatus = "pass" | "fail" | "unavailable";

export type HealthAction =
  | "assign_poc"
  | "book_appointment"
  | "review_tasks"
  | "advance_stage"
  | "record_contract"
  | "record_deposit"
  | "update_start"
  | "review_onboarding"
  | "upload_photos"
  | "assign_crew"
  | "schedule_job"
  | "post_daily_log";

export type HealthFactor = {
  key: string;
  label: string;
  weight: number;
  status: HealthStatus;
  /** What to do when it fails (plain words). */
  recommendation?: string;
  action?: HealthAction;
  /** For "unavailable": the phase that brings this check. */
  arrivesInPhase?: number;
};

export type HealthInput = {
  stage: JobStageId;
  stageEnteredAt: string;
  pointOfContactId: string | null;
  /** Next appointment that isn't canceled/completed, if any. */
  nextAppointmentAt: string | null;
  /** A walkthrough appointment already completed (for early stages). */
  walkthroughDone: boolean;
  overdueTaskCount: number;
  contractSignedAt: string | null;
  depositPaidAt: string | null;
  promisedStartDate: string | null;
  actualStartDate: string | null;
  /** Onboarding checklist progress; null when the job has no checklist. */
  onboarding?: { required: number; cleared: number; open: readonly string[] } | null;
  /** The deposit onboarding item is cleared (payments arrive in Phase 7). */
  depositCleared?: boolean;
  /** Photo counts by category; null/undefined when not loaded. */
  photos?: { before: number; progress: number; after: number } | null;
  /** A crew is assigned (the job's crew or one on its schedule); undefined when not loaded. */
  crewAssigned?: boolean;
  /** Production dates exist on the schedule (published or drafted). */
  scheduled?: boolean;
  /** Production days whose daily update was due, and how many have no log. */
  dailyLogs?: { due: number; missed: number };
};

export type HealthResult = { score: number; factors: HealthFactor[] };

/** Days a job normally spends in each stage before it counts as stale. */
export const EXPECTED_STAGE_DAYS: Record<
  Exclude<JobStageId, "closed_won" | "closed_lost">,
  number
> = {
  walkthrough_scheduled: 14,
  walkthrough_complete: 2,
  estimate_sent: 14,
  sold: 7,
  onboarding: 14,
  ready_to_schedule: 14,
  scheduled: 30,
  in_progress: 21,
  final_walkthrough: 7,
  completed: 7,
  invoiced: 30,
  paid_in_full: 4,
};

function pacificDate(at: Date): Date {
  const z = toZonedTime(at, BUSINESS_TZ);
  return new Date(z.getFullYear(), z.getMonth(), z.getDate());
}

function daysSince(iso: string, now: Date): number {
  return differenceInCalendarDays(pacificDate(now), pacificDate(new Date(iso)));
}

function pacificToday(now: Date): string {
  const d = pacificDate(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const SOLD_ORDER = stageOrder("sold");
const ONBOARDING_ORDER = stageOrder("onboarding");
const SCHEDULED_ORDER = stageOrder("scheduled");

/** Health for an open job; null for closed jobs (nothing left to watch). */
export function computeJobHealth(input: HealthInput, now: Date): HealthResult | null {
  const { stage } = input;
  if (isTerminal(stage)) return null;
  const order = stageOrder(stage);
  const factors: HealthFactor[] = [];

  factors.push(
    input.pointOfContactId
      ? { key: "poc_assigned", label: "Point of contact assigned", weight: 10, status: "pass" }
      : {
          key: "poc_assigned",
          label: "Point of contact assigned",
          weight: 10,
          status: "fail",
          recommendation: "Assign a point of contact so the customer knows who to call.",
          action: "assign_poc",
        },
  );

  // Next appointment: the walkthrough early on; the final walkthrough near the end.
  if (stage === "walkthrough_scheduled") {
    const ok = input.walkthroughDone || input.nextAppointmentAt !== null;
    factors.push({
      key: "next_appointment",
      label: "Walkthrough booked",
      weight: 15,
      status: ok ? "pass" : "fail",
      ...(ok
        ? {}
        : {
            recommendation: "Book the walkthrough appointment.",
            action: "book_appointment" as const,
          }),
    });
  } else if (stage === "final_walkthrough") {
    const ok = input.nextAppointmentAt !== null;
    factors.push({
      key: "next_appointment",
      label: "Final walkthrough booked",
      weight: 15,
      status: ok ? "pass" : "fail",
      ...(ok
        ? {}
        : {
            recommendation: "Book the final walkthrough with the customer.",
            action: "book_appointment" as const,
          }),
    });
  }

  factors.push(
    input.overdueTaskCount === 0
      ? { key: "no_overdue_tasks", label: "No overdue tasks", weight: 15, status: "pass" }
      : {
          key: "no_overdue_tasks",
          label: "No overdue tasks",
          weight: 15,
          status: "fail",
          recommendation: `${input.overdueTaskCount} task${input.overdueTaskCount === 1 ? " is" : "s are"} overdue. Finish or reschedule ${input.overdueTaskCount === 1 ? "it" : "them"}.`,
          action: "review_tasks",
        },
  );

  const expected = EXPECTED_STAGE_DAYS[stage];
  const age = daysSince(input.stageEnteredAt, now);
  factors.push(
    age <= expected
      ? { key: "stage_not_stale", label: "Moving on schedule", weight: 20, status: "pass" }
      : {
          key: "stage_not_stale",
          label: "Moving on schedule",
          weight: 20,
          status: "fail",
          recommendation: `${age} days in ${getStage(stage).label} (usually up to ${expected}). Move it forward or note what it's waiting on.`,
          action: "advance_stage",
        },
  );

  if (order >= SOLD_ORDER) {
    factors.push(
      input.contractSignedAt
        ? { key: "contract_signed", label: "Contract signed", weight: 15, status: "pass" }
        : {
            key: "contract_signed",
            label: "Contract signed",
            weight: 15,
            status: "fail",
            recommendation:
              "The contract isn't signed yet. Send the estimate so the customer can accept and sign it.",
            action: "record_contract",
          },
    );
  }
  if (order >= ONBOARDING_ORDER) {
    factors.push(
      input.depositPaidAt || input.depositCleared
        ? { key: "deposit_paid", label: "Deposit paid", weight: 15, status: "pass" }
        : {
            key: "deposit_paid",
            label: "Deposit paid",
            weight: 15,
            status: "fail",
            recommendation:
              "Collect the deposit before scheduling, then clear the deposit item on the onboarding checklist (recording payments arrives in Phase 7).",
            action: "record_deposit",
          },
    );
    const ob = input.onboarding;
    if (ob && ob.required > 0) {
      const done = ob.cleared >= ob.required;
      factors.push(
        done
          ? {
              key: "onboarding_cleared",
              label: "Onboarding items cleared",
              weight: 15,
              status: "pass",
            }
          : {
              key: "onboarding_cleared",
              label: "Onboarding items cleared",
              weight: 15,
              status: "fail",
              recommendation: `${ob.cleared} of ${ob.required} onboarding items cleared.${ob.open.length ? ` Still open: ${ob.open.slice(0, 4).join(", ")}${ob.open.length > 4 ? "…" : "."}` : ""}`,
              action: "review_onboarding",
            },
      );
    }
  }
  if (order >= stageOrder("in_progress") && input.photos) {
    const p = input.photos;
    const needAfter = order >= stageOrder("final_walkthrough");
    const missing: string[] = [];
    if (p.before === 0) missing.push("before");
    if (p.progress === 0 && stage === "in_progress") missing.push("progress");
    if (needAfter && p.after === 0) missing.push("after");
    factors.push(
      missing.length === 0
        ? { key: "photos", label: "Before, progress and after photos", weight: 10, status: "pass" }
        : {
            key: "photos",
            label: "Before, progress and after photos",
            weight: 10,
            status: "fail",
            recommendation: `No ${missing.join(" or ")} photos yet. Add them in Photos.`,
            action: "upload_photos",
          },
    );
  }
  if (order >= SCHEDULED_ORDER && input.promisedStartDate && !input.actualStartDate) {
    const late = input.promisedStartDate < pacificToday(now);
    factors.push(
      late
        ? {
            key: "start_on_track",
            label: "Start date on track",
            weight: 10,
            status: "fail",
            recommendation:
              "The promised start date has passed. Start the job or reschedule with the customer.",
            action: "update_start",
          }
        : { key: "start_on_track", label: "Start date on track", weight: 10, status: "pass" },
    );
  }

  // Production (Phase 6): crew, dates on the schedule, a daily log every production day.
  if (order >= stageOrder("ready_to_schedule") && order <= stageOrder("final_walkthrough")) {
    if (input.crewAssigned !== undefined) {
      factors.push(
        input.crewAssigned
          ? { key: "crew_assigned", label: "Crew assigned", weight: 10, status: "pass" }
          : {
              key: "crew_assigned",
              label: "Crew assigned",
              weight: 10,
              status: "fail",
              recommendation: "Assign a crew with the skills this job needs.",
              action: "assign_crew",
            },
      );
    }
    if (input.scheduled !== undefined && order <= stageOrder("scheduled")) {
      factors.push(
        input.scheduled
          ? { key: "on_schedule", label: "Production dates booked", weight: 10, status: "pass" }
          : {
              key: "on_schedule",
              label: "Production dates booked",
              weight: 10,
              status: "fail",
              recommendation: "Put the job on the Master Schedule and publish the dates.",
              action: "schedule_job",
            },
      );
    }
  }
  if (stage === "in_progress" && input.dailyLogs) {
    const { due, missed } = input.dailyLogs;
    factors.push(
      missed === 0
        ? {
            key: "daily_logs",
            label: "Daily log on every production day",
            weight: 10,
            status: "pass",
          }
        : {
            key: "daily_logs",
            label: "Daily log on every production day",
            weight: 10,
            status: "fail",
            recommendation: `${missed} of ${due} production day${due === 1 ? "" : "s"} ${missed === 1 ? "has" : "have"} no daily log. Post the daily update so the customer hears from us.`,
            action: "post_daily_log",
          },
    );
  }

  // Checks that need later modules.
  const unavailable: [string, string, number, number, boolean][] = [
    ["balance_current", "Balance current", 10, 7, order >= stageOrder("completed")],
  ];
  for (const [key, label, weight, phase, applies] of unavailable) {
    if (applies) factors.push({ key, label, weight, status: "unavailable", arrivesInPhase: phase });
  }

  const counted = factors.filter((f) => f.status !== "unavailable");
  const total = counted.reduce((s, f) => s + f.weight, 0);
  const passed = counted.filter((f) => f.status === "pass").reduce((s, f) => s + f.weight, 0);
  const score = total === 0 ? 100 : Math.round((passed / total) * 100);
  return { score, factors };
}

/** Plain label for a score. */
export function healthLabel(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 85) return "Healthy";
  if (score >= 60) return "Needs attention";
  return "At risk";
}
