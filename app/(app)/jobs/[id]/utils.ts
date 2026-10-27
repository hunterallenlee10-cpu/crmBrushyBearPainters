import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import type { Scope } from "@/lib/permissions";
import { EXIT_GATES, isTerminal, nextStage } from "@/lib/domain/jobs/gates";
import { JOB_SECTIONS, type JobSectionId } from "@/lib/domain/jobs/constants";
import type { HealthAction, HealthFactor, HealthStatus } from "@/lib/domain/jobs/health";
import { MILESTONES, getStage, milestoneForStage, type JobStageId } from "@/lib/domain/stages";

/** Pure helpers for Job Detail (sections, scope, time zones, stepper, health). */

// --- Sections -------------------------------------------------------------------------

const SECTION_IDS = new Set<string>(JOB_SECTIONS.map((s) => s.id));

/** `?section=` → a section the viewer may open (Admin only for owners); default Overview. */
export function parseSection(
  value: string | string[] | undefined,
  opts: { canAdmin: boolean },
): JobSectionId {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !SECTION_IDS.has(v)) return "overview";
  if (v === "admin" && !opts.canAdmin) return "overview";
  return v as JobSectionId;
}

/** Link to a section of a job (Overview has no query string). */
export function sectionHref(jobId: string, section: JobSectionId, extra?: string): string {
  const base = `/jobs/${jobId}`;
  const params = new URLSearchParams();
  if (section !== "overview") params.set("section", section);
  if (extra) for (const [k, v] of new URLSearchParams(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// --- Record scope -------------------------------------------------------------------

export type ScopedJob = {
  ownerId: string | null;
  createdBy: string | null;
  teamUserIds: readonly string[];
  territoryId: string | null;
};

/**
 * Mirrors app.can_edit_subject('job', …) so the page only offers edits row
 * security will allow: own = owner, creator or on the team (point of contact,
 * project manager, job team); team = own plus the same territory.
 */
export function jobScopeAllows(
  scope: Scope | undefined,
  job: ScopedJob,
  me: { id: string; territoryId: string | null },
): boolean {
  if (!scope) return false;
  if (scope === "all") return true;
  const own = job.ownerId === me.id || job.createdBy === me.id || job.teamUserIds.includes(me.id);
  if (scope === "own") return own;
  return own || (job.territoryId !== null && job.territoryId === me.territoryId);
}

// --- Time zones -----------------------------------------------------------------------

/** A Pacific wall-clock date ("2026-11-03") + time ("09:30") → UTC ISO instant. */
export function pacificToUtcIso(date: string, time: string): string {
  return fromZonedTime(`${date}T${time}:00`, DISPLAY_TZ).toISOString();
}

/** `<input type="datetime-local">` value in Pacific ("2026-11-03T09:30") → UTC ISO, "" stays "". */
export function pacificLocalToUtcIso(local: string): string {
  if (!local) return "";
  const [date, time = "00:00"] = local.split("T");
  return pacificToUtcIso(date ?? "", time.slice(0, 5));
}

/** UTC instant → Pacific "YYYY-MM-DDTHH:MM" for a datetime-local input ("" when empty). */
export function utcToPacificLocal(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd'T'HH:mm");
}

// --- Holds --------------------------------------------------------------------------

/** Hold type labels read "HOA Hold"; the pill adds " Hold" itself. */
export function holdShortLabel(label: string): string {
  return label.replace(/\s+hold$/i, "").trim() || label;
}

// --- Milestones stepper -------------------------------------------------------------

export type StepState = "done" | "current" | "upcoming";

export type MilestoneStep = {
  id: (typeof MILESTONES)[number]["id"];
  label: string;
  state: StepState;
  date: string | null;
};

export type StepperDates = {
  leadCreatedAt: string | null;
  createdAt: string;
  estimateSentAt: string | null;
  estimateAcceptedAt: string | null;
  contractSignedAt: string | null;
  actualStartDate: string | null;
  completedAt: string | null;
  closedAt: string | null;
};

/** The six big steps (Lead → … → Closed) with their dates and the current one. */
export function milestoneSteps(stage: JobStageId, d: StepperDates): MilestoneStep[] {
  const currentIndex = MILESTONES.findIndex((m) => m.id === milestoneForStage(stage).id);
  const dates: Record<MilestoneStep["id"], string | null> = {
    lead: d.leadCreatedAt ?? d.createdAt,
    estimate: d.estimateSentAt,
    sold: d.estimateAcceptedAt ?? d.contractSignedAt,
    in_progress: d.actualStartDate,
    completed: d.completedAt,
    closed: d.closedAt,
  };
  return MILESTONES.map((m, i) => ({
    id: m.id,
    label: m.label,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
    date: dates[m.id],
  }));
}

/** "Next: Walkthrough Complete" + what has to be true (null for closed jobs). */
export function nextHint(
  stage: JobStageId,
): { to: JobStageId; label: string; requirement: string; arrivesInPhase?: number } | null {
  if (isTerminal(stage)) return null;
  const to = nextStage(stage);
  if (!to) return null;
  const gate = EXIT_GATES[stage];
  return {
    to,
    label: getStage(to).label,
    requirement: gate.requirement,
    arrivesInPhase: gate.arrivesInPhase,
  };
}

// --- Health ---------------------------------------------------------------------------

const STATUSES: readonly HealthStatus[] = ["pass", "fail", "unavailable"];
const ACTIONS: readonly HealthAction[] = [
  "assign_poc",
  "book_appointment",
  "review_tasks",
  "advance_stage",
  "record_contract",
  "record_deposit",
  "update_start",
];

/** Reads the stored health_factors jsonb defensively (unknown shapes are skipped). */
export function parseHealthFactors(value: unknown): HealthFactor[] {
  if (!Array.isArray(value)) return [];
  const out: HealthFactor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== "string" || typeof r.label !== "string") continue;
    const status = STATUSES.find((s) => s === r.status);
    if (!status) continue;
    const action = ACTIONS.find((a) => a === r.action);
    out.push({
      key: r.key,
      label: r.label,
      weight: typeof r.weight === "number" ? r.weight : 0,
      status,
      ...(typeof r.recommendation === "string" ? { recommendation: r.recommendation } : {}),
      ...(action ? { action } : {}),
      ...(typeof r.arrivesInPhase === "number" ? { arrivesInPhase: r.arrivesInPhase } : {}),
    });
  }
  return out;
}

// --- Action Required ------------------------------------------------------------------

export type ActionItem = {
  key: string;
  text: string;
  tone: "danger" | "warning" | "info";
  /** Section to open for it (Overview when omitted). */
  section?: JobSectionId;
};

const OPEN_APPOINTMENT = ["tentative", "scheduled", "confirmed", "in_progress"];

/** The Overview's "Action Required" list: failed health checks + schedule + approvals + holds. */
export function actionRequired(input: {
  stage: JobStageId;
  factors: readonly HealthFactor[];
  appointments: readonly { status: string; startsAt: string }[];
  pendingApproval: { toLabel: string } | null;
  blockingHolds: readonly string[];
  now: Date;
}): ActionItem[] {
  if (isTerminal(input.stage)) return [];
  const items: ActionItem[] = [];
  for (const f of input.factors) {
    if (f.status !== "fail" || !f.recommendation) continue;
    items.push({
      key: `health:${f.key}`,
      text: f.recommendation,
      tone: "warning",
      ...(f.action === "review_tasks" ? { section: "tasks" as const } : {}),
      ...(f.action === "record_contract" ? { section: "estimate" as const } : {}),
      ...(f.action === "record_deposit" ? { section: "admin" as const } : {}),
    });
  }
  const upcoming = input.appointments.some(
    (a) => OPEN_APPOINTMENT.includes(a.status) && new Date(a.startsAt) >= input.now,
  );
  if (!upcoming && !items.some((i) => i.key === "health:next_appointment")) {
    items.push({ key: "no_upcoming", text: "No upcoming appointment.", tone: "info" });
  }
  if (input.blockingHolds.length) {
    items.push({
      key: "holds",
      text: `On hold: ${input.blockingHolds.join(", ")}. Release it before scheduling.`,
      tone: "danger",
      section: "onboarding",
    });
  }
  if (input.pendingApproval) {
    items.push({
      key: "approval",
      text: `Waiting for an owner to approve moving to ${input.pendingApproval.toLabel}.`,
      tone: "info",
    });
  }
  return items;
}
