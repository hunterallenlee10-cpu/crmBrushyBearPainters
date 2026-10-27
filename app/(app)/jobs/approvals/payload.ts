import { isJobStageId, type JobStageId } from "@/lib/domain/stages";

/**
 * What a stage-override request asks for, read from `approval_requests.payload`.
 * Pure (unit-tested). The job page writes the payload when someone asks for an
 * override: `{ from_stage, to_stage, gate_reasons: string[], lost_reason? }`.
 * Unknown or malformed fields read as missing rather than throwing.
 */
export type OverridePayload = {
  fromStage: JobStageId | null;
  toStage: JobStageId | null;
  gateReasons: string[];
  lostReason: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function stage(v: unknown): JobStageId | null {
  const s = str(v);
  return s && isJobStageId(s) ? s : null;
}

function reasons(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    const s = str(r);
    return s ? [s.slice(0, 500)] : [];
  });
}

export function parseOverridePayload(raw: unknown): OverridePayload {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lost = str(o.lost_reason);
  return {
    fromStage: stage(o.from_stage),
    toStage: stage(o.to_stage),
    gateReasons: reasons(o.gate_reasons ?? o.reasons).slice(0, 10),
    lostReason: lost && /^[a-z0-9_]{1,60}$/.test(lost) ? lost : null,
  };
}

/** stage_history.reason holds at most 1000 characters. */
export const HISTORY_REASON_MAX = 1000;

/** "<request reason> (approved by <owner name>)", trimmed so it always fits. */
export function approvedReason(requestReason: string, ownerName: string): string {
  const suffix = ` (approved by ${ownerName.trim() || "an owner"})`;
  const room = HISTORY_REASON_MAX - suffix.length;
  const base = requestReason.trim();
  const head = base.length > room ? `${base.slice(0, Math.max(0, room - 1)).trimEnd()}…` : base;
  return `${head}${suffix}`;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "canceled";

export function isApprovalStatus(v: string): v is ApprovalStatus {
  return v === "pending" || v === "approved" || v === "rejected" || v === "canceled";
}

/** Plain-English request types. */
export const APPROVAL_TYPE_LABELS: Record<string, string> = {
  stage_override: "Stage override",
  estimate_discount: "Estimate discount",
};

/** What a discount request asks for: `{ version_id, estimate_number, discount_percent }`. */
export type DiscountPayload = {
  versionId: string;
  estimateNumber: string | null;
  discountPercent: number;
};

export function parseDiscountPayload(raw: unknown): DiscountPayload | null {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const version = str(o.version_id);
  const pct = typeof o.discount_percent === "number" ? o.discount_percent : Number.NaN;
  if (
    !version ||
    !/^[0-9a-f-]{36}$/.test(version) ||
    !Number.isFinite(pct) ||
    pct < 0 ||
    pct > 100
  ) {
    return null;
  }
  return { versionId: version, estimateNumber: str(o.estimate_number), discountPercent: pct };
}

export function approvalTypeLabel(type: string): string {
  return APPROVAL_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}
