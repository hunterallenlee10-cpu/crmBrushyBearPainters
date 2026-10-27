import { JOB_STAGES, TERMINAL_STAGES, getStage, type JobStageId } from "@/lib/domain/stages";
import { formatDay } from "@/lib/domain/scheduling/dates";
import { formatCents as moneyText } from "@/lib/format/money";

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
  },
  scheduled: {
    requirement: "Paint and materials are picked up or delivered, and the start day arrives.",
  },
  in_progress: { requirement: "All work orders are complete." },
  final_walkthrough: {
    requirement:
      "The final walkthrough is done with no open punch items, or the customer signed off.",
  },
  completed: { requirement: "The final invoice is sent." },
  invoiced: { requirement: "The balance is $0 and nothing is left to bill." },
  paid_in_full: {
    requirement: "Closes automatically 3 days after Paid in Full, while the balance stays $0.",
  },
};

/** Facts the gates read. */
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
  /** A schedule entry for this job is published. */
  schedulePublished?: boolean;
  /** The first published production day (YYYY-MM-DD), if any. */
  firstPublishedStart?: string | null;
  /** Today in Pacific time (YYYY-MM-DD). */
  today?: string;
  /** Paint orders not picked up or delivered yet (PO numbers). */
  materialsOpen?: readonly string[];
  /** Live (not canceled) work orders, and how many aren't complete. */
  workOrders?: { total: number; open: number };
  /** Punch list: open items, final walkthrough completed, customer sign-off. */
  punch?: { open: number; finalWalkthroughDone: boolean; signedOff: boolean };
  /** Money (Phase 7): the live final invoice, if any, and whether it was sent. */
  finalInvoice?: { number: string; sent: boolean } | null;
  /** The job ledger (public.job_ledger / lib/domain/ledger), in cents. */
  money?: { billedCents: number; leftToBillCents: number; balanceCents: number } | null;
};

export type GateResult = {
  passes: boolean;
  requirement: string;
  /** Why it doesn't pass, in plain words (empty when it passes). */
  reasons: string[];
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
  const base = { requirement: gate.requirement };
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
    case "ready_to_schedule":
      return ctx.schedulePublished
        ? { ...base, passes: true, reasons: [] }
        : {
            ...base,
            passes: false,
            reasons: [
              "Production dates aren't published yet. Schedule the job on the Master Schedule and choose “Publish changes”.",
            ],
          };
    case "scheduled": {
      const reasons: string[] = [];
      const materials = ctx.materialsOpen ?? [];
      if (materials.length) {
        reasons.push(
          `Paint isn't picked up or delivered yet (${materials.join(", ")}). Update it in Paint Orders.`,
        );
      }
      if (!ctx.firstPublishedStart) {
        reasons.push("No production dates are published.");
      } else if (ctx.today && ctx.firstPublishedStart > ctx.today) {
        reasons.push(
          `The first production day is ${formatDay(ctx.firstPublishedStart)}. The job starts then.`,
        );
      }
      return { ...base, passes: reasons.length === 0, reasons };
    }
    case "in_progress": {
      const wo = ctx.workOrders ?? { total: 0, open: 0 };
      if (wo.total === 0) {
        return { ...base, passes: false, reasons: ["This job has no work orders."] };
      }
      return wo.open === 0
        ? { ...base, passes: true, reasons: [] }
        : {
            ...base,
            passes: false,
            reasons: [
              `${wo.open} of ${wo.total} work order${wo.total === 1 ? "" : "s"} ${wo.open === 1 ? "isn't" : "aren't"} complete.`,
            ],
          };
    }
    case "final_walkthrough": {
      const p = ctx.punch ?? { open: 0, finalWalkthroughDone: false, signedOff: false };
      if (p.signedOff || (p.finalWalkthroughDone && p.open === 0)) {
        return { ...base, passes: true, reasons: [] };
      }
      const reasons: string[] = [];
      if (!p.finalWalkthroughDone)
        reasons.push("The final walkthrough isn't marked completed yet.");
      if (p.open > 0)
        reasons.push(
          `${p.open} punch item${p.open === 1 ? " is" : "s are"} still open. Fix ${p.open === 1 ? "it" : "them"}, or capture the customer's sign-off.`,
        );
      return { ...base, passes: false, reasons };
    }
    case "completed": {
      const f = ctx.finalInvoice ?? null;
      if (f?.sent) return { ...base, passes: true, reasons: [] };
      return {
        ...base,
        passes: false,
        reasons: [
          f
            ? `The final invoice ${f.number} is drafted but not sent. Send it from Financial.`
            : "There's no final invoice yet. Draft it from Financial (it's drafted on its own when the job reaches Completed).",
        ],
      };
    }
    case "invoiced": {
      const m = ctx.money;
      if (!m) return { ...base, passes: false, reasons: ["The job's money isn't loaded."] };
      const reasons: string[] = [];
      if (m.billedCents <= 0) reasons.push("Nothing has been billed yet.");
      if (m.leftToBillCents > 0)
        reasons.push(
          `${moneyText(m.leftToBillCents)} is still left to bill. Create an invoice for it.`,
        );
      if (m.leftToBillCents < 0)
        reasons.push(
          `Invoices add up to ${moneyText(-m.leftToBillCents)} more than the contract. Void the extra invoice or issue a credit memo.`,
        );
      if (m.balanceCents > 0) reasons.push(`The balance is ${moneyText(m.balanceCents)}.`);
      if (m.balanceCents < 0)
        reasons.push(
          `The customer paid ${moneyText(-m.balanceCents)} more than was billed. Refund it first.`,
        );
      return { ...base, passes: reasons.length === 0, reasons };
    }
    case "paid_in_full": {
      const m = ctx.money;
      if (m && m.balanceCents !== 0) {
        return {
          ...base,
          passes: false,
          reasons: [
            `The balance is ${moneyText(m.balanceCents)} again (a payment bounced or was refunded). Collect it before closing.`,
          ],
        };
      }
      return { ...base, passes: true, reasons: [] };
    }
    default:
      return {
        ...base,
        passes: false,
        reasons: [
          `${gate.requirement.replace(/\.$/, "")}. An owner can override it with a reason.`,
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
