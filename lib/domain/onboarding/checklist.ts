import {
  ONBOARDING_GROUPS,
  ONBOARDING_REQUIREMENTS,
  type OnboardingGroup,
  type OnboardingKey,
  type OnboardingStatus,
} from "@/lib/domain/estimating/outputs";
import { isManualClear, isOnboardingKey } from "./rules";

/**
 * The onboarding checklist as people see it (SPEC §6.4, §8.5 #2): progress
 * ("10/14 cleared · 3 auto-verified · 2 need attention"), the Ready to
 * Schedule gate, and which actions each item offers. Pure.
 */

export type ChecklistRow = {
  key: string;
  label: string;
  group: string;
  required: boolean;
  status: string;
  verifiedAuto: boolean;
};

export type ChecklistSummary = {
  /** Required items. */
  required: number;
  /** Required items cleared (verified, by a check or by hand). */
  cleared: number;
  /** Required items a check verified. */
  autoVerified: number;
  /** Required items marked missing or needing review. */
  needAttention: number;
  /** Required items still open, in checklist order. */
  open: { key: string; label: string; status: string }[];
  /** 0–1, null when nothing is required. */
  percent: number | null;
};

export function checklistSummary(rows: readonly ChecklistRow[]): ChecklistSummary {
  const req = rows.filter((r) => r.required);
  const cleared = req.filter((r) => r.status === "verified");
  const open = req.filter((r) => r.status !== "verified");
  return {
    required: req.length,
    cleared: cleared.length,
    autoVerified: cleared.filter((r) => r.verifiedAuto).length,
    needAttention: open.filter((r) => r.status === "missing" || r.status === "needs_review").length,
    open: open.map((r) => ({ key: r.key, label: r.label, status: r.status })),
    percent: req.length ? cleared.length / req.length : null,
  };
}

/** "10/14 cleared · 3 auto-verified · 2 need attention". */
export function summaryLine(s: ChecklistSummary): string {
  if (s.required === 0) return "No required items";
  return [
    `${s.cleared}/${s.required} cleared`,
    `${s.autoVerified} auto-verified`,
    `${s.needAttention} need${s.needAttention === 1 ? "s" : ""} attention`,
  ].join(" · ");
}

export type ReadyCheck = { passes: boolean; reasons: string[] };

/** Short names for the open items in gate messages. */
export const SHORT_LABELS: Record<OnboardingKey, string> = {
  signed_contract: "signed contract",
  change_orders_resolved: "change orders",
  deposit_received: "deposit",
  contact_reachable: "contact info",
  access_confirmed: "access details",
  colors_selected: "colors",
  color_consult_done: "color consult",
  hoa_approval: "HOA approval",
  lead_safe_plan: "lead-safe plan",
  repair_scope_approved: "repair approval",
  paint_ordered: "paint order",
  crew_assigned: "crew",
  prep_instructions_sent: "prep instructions",
  start_in_season: "season start date",
};

export function shortLabel(key: string, fallback: string): string {
  return isOnboardingKey(key) ? SHORT_LABELS[key] : fallback;
}

/**
 * Ready to Schedule = every required item cleared + no blocking holds (SPEC
 * §6.4). Must agree with app.job_gate_passes('onboarding') in SQL.
 */
export function readyToSchedule(
  rows: readonly ChecklistRow[],
  blockingHolds: readonly string[],
): ReadyCheck {
  const reasons: string[] = [];
  if (rows.length === 0) {
    reasons.push(
      "The onboarding checklist hasn't been built. It comes from the accepted estimate.",
    );
  } else {
    const s = checklistSummary(rows);
    if (s.open.length) {
      const names = s.open.map((o) => shortLabel(o.key, o.label));
      reasons.push(
        `${s.open.length} required onboarding item${s.open.length === 1 ? " is" : "s are"} still open: ${names.join(", ")}.`,
      );
    }
  }
  if (blockingHolds.length) {
    reasons.push(`Release the ${blockingHolds.join(", ")} first.`);
  }
  return { passes: reasons.length === 0, reasons };
}

// --- Actions per item (SPEC §6.4: Request from customer, Upload, Create task, Mark cleared) --

export type RequirementAction = "request" | "upload" | "task" | "clear" | "reopen";

/** What the customer is asked for when we "Request from customer". */
export const REQUESTABLE: Partial<Record<OnboardingKey, string>> = {
  contact_reachable: "contact",
  access_confirmed: "access",
  colors_selected: "colors",
  hoa_approval: "hoa",
  lead_safe_plan: "lead_safe",
  prep_instructions_sent: "prep",
};

/** Document category an upload for this item goes into. */
export const UPLOAD_CATEGORY: Partial<Record<OnboardingKey, "hoa" | "lead_safe" | "contract">> = {
  hoa_approval: "hoa",
  lead_safe_plan: "lead_safe",
  signed_contract: "contract",
};

export function requirementActions(row: ChecklistRow): RequirementAction[] {
  if (!isOnboardingKey(row.key)) return [];
  if (row.status === "not_required") return [];
  if (row.status === "verified") return isManualClear(row) ? ["reopen"] : [];
  const out: RequirementAction[] = [];
  if (REQUESTABLE[row.key]) out.push("request");
  if (UPLOAD_CATEGORY[row.key]) out.push("upload");
  out.push("task", "clear");
  return out;
}

export type ChecklistGroup<T extends ChecklistRow> = {
  group: OnboardingGroup;
  items: T[];
};

/** Rows grouped in SPEC order (groups with no rows left out), items by checklist order. */
export function groupChecklist<T extends ChecklistRow>(rows: readonly T[]): ChecklistGroup<T>[] {
  const order = new Map<string, number>(ONBOARDING_REQUIREMENTS.map((r, i) => [r.key, i]));
  return ONBOARDING_GROUPS.map((g) => ({
    group: g,
    items: rows
      .filter((r) => r.group === g)
      .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99)),
  })).filter((g) => g.items.length > 0);
}

/** Status chip tone. */
export function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status as OnboardingStatus;
  if (s === "verified") return "success";
  if (s === "missing") return "danger";
  if (s === "needs_review") return "warning";
  return "neutral";
}
