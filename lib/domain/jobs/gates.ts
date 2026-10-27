import { JOB_STAGES, TERMINAL_STAGES, getStage, type JobStageId } from "@/lib/domain/stages";

/**
 * Job stage gates and transitions (SPEC §6.2). Pure.
 *
 * Must agree with the database side, app.job_gate_passes() and
 * public.apply_job_stage_change() (supabase/migrations/20261026001100): the
 * database enforces the same rules, this module explains them to people.
 */

/** What must be true for a job to leave each stage. */
export type GateDefinition = {
  /** Plain-English requirement shown next to the Advance button. */
  requirement: string;
  /** Phase that brings the data this gate checks; until then only an owner override moves past it. */
  arrivesInPhase?: number;
};

export const EXIT_GATES: Record<
  Exclude<JobStageId, "closed_won" | "closed_lost">,
  GateDefinition
> = {
  walkthrough_scheduled: {
    requirement: "The walkthrough is marked completed with the result “Measured”.",
  },
  walkthrough_complete: { requirement: "An estimate is sent." },
  estimate_sent: { requirement: "The estimate is accepted and the contract signed." },
  sold: { requirement: "The deposit invoice exists." },
  onboarding: {
    requirement: "Every required onboarding item is cleared and no hold blocks scheduling.",
  },
  ready_to_schedule: {
    requirement: "Production dates are published on the Master Schedule.",
    arrivesInPhase: 6,
  },
  scheduled: {
    requirement: "Paint and materials are ready and the start day arrives.",
    arrivesInPhase: 6,
  },
  in_progress: { requirement: "All work orders are complete.", arrivesInPhase: 6 },
  final_walkthrough: {
    requirement: "The punch list is empty or the customer signed off.",
    arrivesInPhase: 6,
  },
  completed: { requirement: "The final invoice is sent.", arrivesInPhase: 7 },
  invoiced: { requirement: "The balance is $0.", arrivesInPhase: 7 },
  paid_in_full: { requirement: "Closes automatically 3 days after Paid in Full." },
};

/** Facts the gates read. Grows as later phases add data. */
export type GateContext = {
  /** A walkthrough on this job is completed with result "measured". */
  walkthroughMeasured: boolean;
  /** An estimate version on this job has been sent. */
  estimateSent: boolean;
  /** The estimate is accepted and the customer signed it. */
  estimateSigned: boolean;
  /** The deposit invoice exists (or the accepted estimate asks for no deposit). */
  depositInvoiceReady: boolean;
  /** Active holds that block scheduling (label for messages). */
  blockingHolds: readonly string[];
  /**
   * Required onboarding items not yet cleared (short names), or null when the
   * job has no checklist (it's built when the estimate is accepted).
   */
  onboardingOpen: readonly string[] | null;
};

export type GateResult = {
  passes: boolean;
  requirement: string;
  /** Why it doesn't pass, in plain words (empty when it passes). */
  reasons: string[];
  arrivesInPhase?: number;
};

export function stageOrder(stage: JobStageId): number {
  return getStage(stage).order;
}

export type OpenJobStageId = Exclude<JobStageId, "closed_won" | "closed_lost">;

export function isTerminal(stage: JobStageId): stage is "closed_won" | "closed_lost" {
  return TERMINAL_STAGES.includes(stage);
}

/** The next stage in the pipeline (Paid in Full → Closed Won), or null for closed jobs. */
export function nextStage(stage: JobStageId): JobStageId | null {
  if (isTerminal(stage)) return null;
  const next = JOB_STAGES.find((s) => s.order === stageOrder(stage) + 1);
  return next ? next.id : null;
}

/** Whether the job may leave `stage` by moving one step forward. */
export function exitGate(stage: JobStageId, ctx: GateContext): GateResult {
  if (stage === "closed_won" || stage === "closed_lost") {
    return { passes: false, requirement: "The job is closed.", reasons: ["The job is closed."] };
  }
  const gate = EXIT_GATES[stage];
  const base = { requirement: gate.requirement, arrivesInPhase: gate.arrivesInPhase };
  switch (stage) {
    case "walkthrough_scheduled":
      return ctx.walkthroughMeasured
        ? { ...base, passes: true, reasons: [] }
        : {
            ...base,
            passes: false,
            reasons: ["The walkthrough hasn't been completed with the result “Measured” yet."],
          };
    case "walkthrough_complete":
      return ctx.estimateSent
        ? { ...base, passes: true, reasons: [] }
        : { ...base, passes: false, reasons: ["No estimate has been sent yet."] };
    case "estimate_sent":
      return ctx.estimateSigned
        ? { ...base, passes: true, reasons: [] }
        : {
            ...base,
            passes: false,
            reasons: ["The customer hasn't accepted and signed the estimate yet."],
          };
    case "sold":
      return ctx.depositInvoiceReady
        ? { ...base, passes: true, reasons: [] }
        : { ...base, passes: false, reasons: ["The deposit invoice hasn't been created yet."] };
    case "onboarding": {
      const reasons: string[] = [];
      if (ctx.onboardingOpen === null) {
        reasons.push(
          "The onboarding checklist hasn't been built. It comes from the accepted estimate.",
        );
      } else if (ctx.onboardingOpen.length) {
        const n = ctx.onboardingOpen.length;
        reasons.push(
          `${n} required onboarding item${n === 1 ? " is" : "s are"} still open: ${ctx.onboardingOpen.join(", ")}.`,
        );
      }
      if (ctx.blockingHolds.length) {
        reasons.push(`Release the ${ctx.blockingHolds.map(holdName).join(", ")} first.`);
      }
      return { ...base, passes: reasons.length === 0, reasons };
    }
    case "paid_in_full":
      return { ...base, passes: true, reasons: [] };
    default:
      return {
        ...base,
        passes: false,
        reasons: [
          `${gate.requirement.replace(/\.$/, "")} — this check arrives in Phase ${gate.arrivesInPhase}. Until then an owner can override it with a reason.`,
        ],
      };
  }
}

export type TransitionKind = "forward" | "skip" | "back" | "reopen" | "lost" | "won";

export type TransitionCheck = {
  kind: TransitionKind;
  /** True when the move can happen without an override. */
  allowed: boolean;
  /** True when an owner override (with a reason) would make it possible. */
  overridable: boolean;
  /** Blocking holds stop this move even with an override. */
  blockedByHolds: boolean;
  /** Missing lost reason for Closed Lost. */
  needsLostReason: boolean;
  reasons: string[];
};

const READY_ORDER = stageOrder("ready_to_schedule");

/** "HOA" → "HOA hold"; picklist labels that already say "Hold" stay as they are. */
function holdName(label: string): string {
  return /\bhold$/i.test(label.trim()) ? label.trim() : `${label.trim()} hold`;
}

/**
 * Can a job move from `from` to `to`? Mirrors public.apply_job_stage_change():
 * - one stage forward when the gate passes;
 * - to Closed Lost from any open stage with a lost reason;
 * - anything else (skip, back, reopen, a closed gate) needs an owner override;
 * - blocking holds stop Ready to Schedule and later stages, override or not.
 */
export function checkTransition(
  from: JobStageId,
  to: JobStageId,
  ctx: GateContext,
  opts: { lostReason?: string | null } = {},
): TransitionCheck {
  const reasons: string[] = [];
  const fromOrder = stageOrder(from);
  const toOrder = stageOrder(to);

  let kind: TransitionKind;
  if (to === "closed_lost") kind = "lost";
  else if (isTerminal(from)) kind = "reopen";
  else if (to === "closed_won") kind = toOrder === fromOrder + 1 ? "won" : "skip";
  else if (toOrder === fromOrder + 1) kind = "forward";
  else if (toOrder > fromOrder) kind = "skip";
  else kind = "back";

  if (from === to) {
    return {
      kind,
      allowed: false,
      overridable: false,
      blockedByHolds: false,
      needsLostReason: false,
      reasons: ["The job is already in that stage."],
    };
  }

  const blockedByHolds = !isTerminal(to) && toOrder >= READY_ORDER && ctx.blockingHolds.length > 0;
  if (blockedByHolds) {
    reasons.push(
      `Release the ${ctx.blockingHolds.map(holdName).join(", ")} first. Holds stop scheduling even with an override.`,
    );
  }

  let needsOverride: boolean;
  let needsLostReason = false;
  switch (kind) {
    case "lost":
      needsLostReason = !opts.lostReason;
      if (needsLostReason) reasons.push("Pick a lost reason.");
      needsOverride = from === "closed_won";
      if (needsOverride) reasons.push("Reopening a won job needs an owner override.");
      break;
    case "reopen":
      needsOverride = true;
      reasons.push("Reopening a closed job needs an owner override.");
      break;
    case "skip":
      needsOverride = true;
      reasons.push(
        `Skipping from ${getStage(from).label} to ${getStage(to).label} needs an owner override.`,
      );
      break;
    case "back":
      needsOverride = true;
      reasons.push(`Moving back to ${getStage(to).label} needs an owner override.`);
      break;
    default: {
      const gate = exitGate(from, ctx);
      // The hold message is already there (with "even with an override").
      const gateReasons = gate.reasons.filter(
        (r) => !(blockedByHolds && r.startsWith("Release the ")),
      );
      needsOverride = gateReasons.length > 0;
      reasons.push(...gateReasons);
    }
  }

  return {
    kind,
    allowed: !needsOverride && !blockedByHolds && !needsLostReason,
    overridable: needsOverride && !blockedByHolds,
    blockedByHolds,
    needsLostReason,
    reasons,
  };
}

/** Minimum length of an override reason (the database enforces the same). */
export const OVERRIDE_REASON_MIN = 10;
