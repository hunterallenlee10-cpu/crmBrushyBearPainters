import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { BUSINESS_TZ } from "@/lib/domain/leads/speed-to-lead";
import { getStage, type JobStageId } from "@/lib/domain/stages";

/**
 * Onboarding Board (SPEC §8.7). Pure: lanes come from the job's stage and its
 * active holds; moves between lanes map to stage changes only where a gate can
 * pass, and every other drop explains why not.
 */

export const BOARD_LANES = [
  "deposit_hold",
  "needs_onboarding",
  "on_hold",
  "ready",
  "in_production",
  "invoicing",
  "paid",
] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export const LANE_LABELS: Record<BoardLane, string> = {
  deposit_hold: "Deposit Hold",
  needs_onboarding: "Needs Onboarding",
  on_hold: "On Hold / Expediting",
  ready: "Ready to Schedule",
  in_production: "Scheduled / In Progress",
  invoicing: "Invoicing / Collections",
  paid: "Paid in Full",
};

/** Stages a job can be in to appear on the board (closed-won only when paid this month). */
export const BOARD_STAGES: readonly JobStageId[] = [
  "sold",
  "onboarding",
  "ready_to_schedule",
  "scheduled",
  "in_progress",
  "final_walkthrough",
  "completed",
  "invoiced",
  "paid_in_full",
  "closed_won",
];

/**
 * Days in a lane before a card counts as overdue. Defaults match the
 * attention rules (sold with no deposit 3, onboarding stalled 7, ready not
 * scheduled 5); the page passes the live thresholds.
 */
export type LaneThresholds = Partial<Record<BoardLane, number>>;
export const DEFAULT_LANE_THRESHOLDS: LaneThresholds = {
  deposit_hold: 3,
  needs_onboarding: 7,
  on_hold: 7,
  ready: 5,
};

export type BoardHold = {
  type: string;
  label: string;
  blocksScheduling: boolean;
  placedAt: string;
};

export type BoardCard = {
  id: string;
  jobNumber: string;
  name: string;
  accountName: string | null;
  city: string | null;
  workTypes: readonly string[];
  stage: JobStageId;
  stageEnteredAt: string;
  holds: readonly BoardHold[];
  /** Contract amount; null when the viewer can't see money. */
  contractCents: number | null;
  /** Collected so far; null until payments exist (Phase 7). */
  collectedCents: number | null;
  /** Deposit invoice total; null when none or hidden. */
  depositCents: number | null;
  soldAt: string | null;
  paidInFullAt: string | null;
  /** Onboarding checklist progress; null before acceptance. */
  onboarding: { required: number; cleared: number } | null;
  /** The onboarding gate passes (all required cleared, no blocking holds). */
  readyToSchedule: boolean;
  leadSafe: boolean;
  hasHoa: boolean;
  priority: string;
};

function pacificDay(at: Date): Date {
  const z = toZonedTime(at, BUSINESS_TZ);
  return new Date(z.getFullYear(), z.getMonth(), z.getDate());
}

function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, differenceInCalendarDays(pacificDay(now), pacificDay(new Date(fromIso))));
}

const PRE_SCHEDULING = new Set<JobStageId>(["sold", "onboarding", "ready_to_schedule"]);

/** The lane a job sits in. Null when it doesn't belong on the board. */
export function boardLane(
  card: Pick<BoardCard, "stage" | "holds" | "paidInFullAt">,
  now: Date,
): BoardLane | null {
  const active = card.holds;
  const deposit = active.some((h) => h.type === "deposit");
  const blocking = active.some((h) => h.type !== "deposit" && h.blocksScheduling);
  switch (card.stage) {
    case "sold":
    case "onboarding":
      if (deposit) return "deposit_hold";
      if (blocking) return "on_hold";
      return "needs_onboarding";
    case "ready_to_schedule":
      return deposit ? "deposit_hold" : active.length ? "on_hold" : "ready";
    case "scheduled":
    case "in_progress":
    case "final_walkthrough":
      return "in_production";
    case "completed":
    case "invoiced":
      return "invoicing";
    case "paid_in_full":
      return "paid";
    case "closed_won": {
      if (!card.paidInFullAt) return null;
      const paid = toZonedTime(new Date(card.paidInFullAt), BUSINESS_TZ);
      const today = toZonedTime(now, BUSINESS_TZ);
      return paid.getFullYear() === today.getFullYear() && paid.getMonth() === today.getMonth()
        ? "paid"
        : null;
    }
    default:
      return null;
  }
}

/** When the card entered its lane: the hold that put it there, else the stage. */
export function laneEnteredAt(card: BoardCard, lane: BoardLane): string {
  if (lane === "deposit_hold") {
    const h = card.holds.find((x) => x.type === "deposit");
    if (h) return h.placedAt;
  }
  if (lane === "on_hold" && card.holds.length) {
    return card.holds.map((h) => h.placedAt).sort()[0] ?? card.stageEnteredAt;
  }
  if (lane === "paid" && card.paidInFullAt) return card.paidInFullAt;
  return card.stageEnteredAt;
}

export type PlacedCard = BoardCard & {
  lane: BoardLane;
  daysInLane: number;
  overdue: boolean;
  /** 0–1 share collected; null until payments exist or when money is hidden. */
  collectedShare: number | null;
};

export function placeCards(
  cards: readonly BoardCard[],
  now: Date,
  thresholds: LaneThresholds = DEFAULT_LANE_THRESHOLDS,
): PlacedCard[] {
  const out: PlacedCard[] = [];
  for (const c of cards) {
    const lane = boardLane(c, now);
    if (!lane) continue;
    const days = daysBetween(laneEnteredAt(c, lane), now);
    const limit = thresholds[lane];
    out.push({
      ...c,
      lane,
      daysInLane: days,
      overdue: limit !== undefined && days >= limit,
      collectedShare:
        c.collectedCents === null || c.contractCents === null || c.contractCents <= 0
          ? null
          : Math.min(1, Math.max(0, c.collectedCents / c.contractCents)),
    });
  }
  return out;
}

export type LaneSummary = {
  lane: BoardLane;
  count: number;
  /** Sum of contract amounts; null when money is hidden. */
  valueCents: number | null;
  avgDays: number | null;
  overdue: number;
};

/** Aggregates for the KPI strip and lane headers (the metrics registry reads this). */
export type BoardSummary = {
  canSeeMoney: boolean;
  lanes: LaneSummary[];
  activeJobs: number;
  activeValueCents: number | null;
  depositHeldCents: number | null;
  /** Billed − collected; null until payments exist (Phase 7). */
  outstandingCents: number | null;
};

export function summarizeBoard(placed: readonly PlacedCard[], canSeeMoney: boolean): BoardSummary {
  const lanes = BOARD_LANES.map((lane): LaneSummary => {
    const cards = placed.filter((c) => c.lane === lane);
    const days = cards.map((c) => c.daysInLane);
    return {
      lane,
      count: cards.length,
      valueCents: canSeeMoney ? cards.reduce((s, c) => s + (c.contractCents ?? 0), 0) : null,
      avgDays: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
      overdue: cards.filter((c) => c.overdue).length,
    };
  });
  const active = placed.filter((c) => c.lane !== "paid");
  const deposit = placed.filter((c) => c.lane === "deposit_hold");
  const invoicing = placed.filter((c) => c.lane === "invoicing");
  const knownCollected = invoicing.every((c) => c.collectedCents !== null);
  return {
    canSeeMoney,
    lanes,
    activeJobs: active.length,
    activeValueCents: canSeeMoney ? active.reduce((s, c) => s + (c.contractCents ?? 0), 0) : null,
    depositHeldCents: canSeeMoney ? deposit.reduce((s, c) => s + (c.depositCents ?? 0), 0) : null,
    outstandingCents:
      canSeeMoney && invoicing.length > 0 && knownCollected
        ? invoicing.reduce(
            (s, c) => s + Math.max(0, (c.contractCents ?? 0) - (c.collectedCents ?? 0)),
            0,
          )
        : null,
  };
}

// --- Moves -----------------------------------------------------------------------

export type BoardMove =
  | { allowed: true; from: JobStageId; to: JobStageId; message: string }
  | { allowed: false; reason: string };

function holdNames(card: Pick<BoardCard, "holds">, filter: (h: BoardHold) => boolean): string {
  const names = card.holds.filter(filter).map((h) => h.label);
  return names.join(", ") || "hold";
}

/**
 * What dropping a card on another lane does. Only Needs Onboarding → Ready to
 * Schedule changes a stage here (through advanceJobStage, when the gate
 * passes); every other drop says what to do instead.
 */
export function boardMove(card: PlacedCard, to: BoardLane): BoardMove {
  const from = card.lane;
  if (from === to) return { allowed: false, reason: "The job is already in that lane." };
  const fromIdx = BOARD_LANES.indexOf(from);
  const toIdx = BOARD_LANES.indexOf(to);

  if (from === "deposit_hold") {
    return {
      allowed: false,
      reason:
        "Waiting for the deposit. When it's in, clear the deposit item on the job's onboarding checklist and the Deposit Hold releases on its own.",
    };
  }
  if (from === "on_hold" && to !== "deposit_hold") {
    return {
      allowed: false,
      reason: `Release the ${holdNames(card, () => true)} on the job's Onboarding → Holds first.`,
    };
  }
  if (to === "deposit_hold") {
    return {
      allowed: false,
      reason: "Jobs land here on their own when a Deposit Hold is placed.",
    };
  }
  if (to === "on_hold") {
    return {
      allowed: false,
      reason: "Place a hold from the job's Onboarding → Holds tab; the card moves here on its own.",
    };
  }
  if (toIdx < fromIdx) {
    return {
      allowed: false,
      reason: "Moving a job back needs an owner override from the job page.",
    };
  }
  if (from === "needs_onboarding" && to === "ready") {
    if (card.stage === "sold") {
      return {
        allowed: false,
        reason: "The job is still in Sold. It moves to Onboarding once the deposit invoice exists.",
      };
    }
    if (!card.readyToSchedule) {
      const left = card.onboarding ? card.onboarding.required - card.onboarding.cleared : null;
      return {
        allowed: false,
        reason:
          left && left > 0
            ? `${left} required onboarding item${left === 1 ? " is" : "s are"} still open. Clear ${left === 1 ? "it" : "them"} on the job's checklist first.`
            : "The onboarding checklist isn't cleared yet. Open the job to see what's left.",
      };
    }
    return {
      allowed: true,
      from: "onboarding",
      to: "ready_to_schedule",
      message: `Moved to ${getStage("ready_to_schedule").label}.`,
    };
  }
  if (from === "ready" && to === "in_production") {
    return {
      allowed: false,
      reason: "Jobs get scheduled on the Master Schedule, which arrives in Phase 6.",
    };
  }
  if (to === "invoicing" || to === "paid") {
    return {
      allowed: false,
      reason:
        to === "paid"
          ? "A job is paid in full when its balance reaches $0 (payments arrive in Phase 7)."
          : "Jobs move to invoicing when the work is complete and the final invoice is sent.",
    };
  }
  return {
    allowed: false,
    reason: "Jobs move one step at a time through their gates. Open the job to move it.",
  };
}

// --- Filters ---------------------------------------------------------------------

export const HOLD_FILTERS = ["any", "none", "deposit", "hoa", "lead_safe", "weather"] as const;
export type HoldFilter = (typeof HOLD_FILTERS)[number];

export type BoardFilters = {
  workType?: string | null;
  hold?: HoldFilter | null;
  city?: string | null;
  /** YYYY-MM-DD (Pacific), inclusive. */
  soldFrom?: string | null;
  soldTo?: string | null;
};

function pacificIso(iso: string): string {
  const d = toZonedTime(new Date(iso), BUSINESS_TZ);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function filterCards<T extends BoardCard>(cards: readonly T[], f: BoardFilters): T[] {
  return cards.filter((c) => {
    if (f.workType && !c.workTypes.includes(f.workType)) return false;
    if (f.city && (c.city ?? "").toLowerCase() !== f.city.toLowerCase()) return false;
    if (f.hold === "any" && c.holds.length === 0) return false;
    if (f.hold === "none" && c.holds.length > 0) return false;
    if (f.hold && !["any", "none"].includes(f.hold) && !c.holds.some((h) => h.type === f.hold))
      return false;
    if (f.soldFrom || f.soldTo) {
      if (!c.soldAt) return false;
      const day = pacificIso(c.soldAt);
      if (f.soldFrom && day < f.soldFrom) return false;
      if (f.soldTo && day > f.soldTo) return false;
    }
    return true;
  });
}

/** Expedite tab: cards held up or overdue, longest wait first. */
export function expediteList<T extends PlacedCard>(cards: readonly T[]): T[] {
  return cards
    .filter((c) => c.overdue || c.lane === "on_hold" || c.lane === "deposit_hold")
    .sort((a, b) => b.daysInLane - a.daysInLane);
}

// --- Data audit (records missing required data) -------------------------------------

export type AuditInput = {
  stage: JobStageId;
  hasPrimaryContact: boolean;
  contactMobile: string | null;
  contactEmail: string | null;
  hasProperty: boolean;
  pointOfContactId: string | null;
  promisedStartDate: string | null;
  soldAt: string | null;
  hasChecklist: boolean;
};

export function dataAuditIssues(a: AuditInput): string[] {
  const out: string[] = [];
  if (!a.hasPrimaryContact) out.push("No primary contact");
  else {
    if (!a.contactMobile) out.push("No mobile number");
    if (!a.contactEmail) out.push("No email");
  }
  if (!a.hasProperty) out.push("No property");
  if (!a.pointOfContactId) out.push("No point of contact");
  if (!a.soldAt) out.push("No sold date");
  if (!a.hasChecklist && PRE_SCHEDULING.has(a.stage)) out.push("No onboarding checklist");
  if (!a.promisedStartDate && a.stage !== "sold" && a.stage !== "onboarding")
    out.push("No promised start date");
  return out;
}
