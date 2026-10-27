/**
 * Job pipeline stages (SPEC §6.2). Names are unique and self-describing
 * (SPEC §3.4). Gates and transitions live in lib/domain/jobs/gates.ts; this
 * file is the single list of stages, their order, and their display color.
 */

export const JOB_STAGES = [
  { id: "walkthrough_scheduled", label: "Walkthrough Scheduled", order: 1, color: "#0369A1" },
  { id: "walkthrough_complete", label: "Walkthrough Complete", order: 2, color: "#0F766E" },
  { id: "estimate_sent", label: "Estimate Sent", order: 3, color: "#4338CA" },
  { id: "sold", label: "Sold", order: 4, color: "#6D28D9" },
  { id: "onboarding", label: "Onboarding", order: 5, color: "#A21CAF" },
  { id: "ready_to_schedule", label: "Ready to Schedule", order: 6, color: "#854D0E" },
  { id: "scheduled", label: "Scheduled", order: 7, color: "#0E7490" },
  { id: "in_progress", label: "In Progress", order: 8, color: "#1D4ED8" },
  { id: "final_walkthrough", label: "Final Walkthrough", order: 9, color: "#9A3412" },
  { id: "completed", label: "Completed", order: 10, color: "#166534" },
  { id: "invoiced", label: "Invoiced", order: 11, color: "#BE123C" },
  { id: "paid_in_full", label: "Paid in Full", order: 12, color: "#047857" },
  { id: "closed_won", label: "Closed Won", order: 13, color: "#1F4D3A" },
  { id: "closed_lost", label: "Closed Lost", order: 14, color: "#475569" },
] as const;

export type JobStageId = (typeof JOB_STAGES)[number]["id"];
export type JobStage = (typeof JOB_STAGES)[number];

export const TERMINAL_STAGES: readonly JobStageId[] = ["closed_won", "closed_lost"];

const byId = new Map<string, JobStage>(JOB_STAGES.map((s) => [s.id, s]));

export function getStage(id: JobStageId): JobStage {
  const stage = byId.get(id);
  if (!stage) throw new Error(`Unknown job stage: ${id}`);
  return stage;
}

export function isJobStageId(value: string): value is JobStageId {
  return byId.has(value);
}

/** Tint used behind stage text in badges (see globals.css `.stage-badge`). */
export const STAGE_BADGE_TINT = 0.12;

/**
 * The six-step milestones stepper on the job page (SPEC §6.3):
 * Lead → Estimate → Sold → In Progress → Completed → Closed.
 */
export const MILESTONES = [
  { id: "lead", label: "Lead", stages: ["walkthrough_scheduled", "walkthrough_complete"] },
  { id: "estimate", label: "Estimate", stages: ["estimate_sent"] },
  { id: "sold", label: "Sold", stages: ["sold", "onboarding", "ready_to_schedule", "scheduled"] },
  { id: "in_progress", label: "In Progress", stages: ["in_progress", "final_walkthrough"] },
  { id: "completed", label: "Completed", stages: ["completed", "invoiced", "paid_in_full"] },
  { id: "closed", label: "Closed", stages: ["closed_won", "closed_lost"] },
] as const satisfies readonly { id: string; label: string; stages: readonly JobStageId[] }[];

export function milestoneForStage(id: JobStageId): (typeof MILESTONES)[number] {
  const m = MILESTONES.find((ms) => (ms.stages as readonly JobStageId[]).includes(id));
  if (!m) throw new Error(`Stage ${id} has no milestone`);
  return m;
}
