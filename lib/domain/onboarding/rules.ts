import { isInSeason } from "@/lib/domain/company-settings";
import {
  ONBOARDING_REQUIREMENTS,
  type OnboardingKey,
  type OnboardingStatus,
} from "@/lib/domain/estimating/outputs";

/**
 * Onboarding auto-verify rules (SPEC §6.4). Pure: a snapshot of the job (its
 * documents, colors, payments, messages, property and contact) goes in; one
 * result per requirement comes out. The server writes the results with
 * `apply_onboarding_checks()`; a manual "cleared with a note" is never
 * overwritten (that happens in the database function).
 *
 * The deposit rule reads the money applied to the deposit invoice (the Phase 7
 * ledger), so recording the payment clears it on its own.
 */

export type DepositLedger = {
  /** The live (not void) deposit invoice, if any. */
  invoice: { number: string; status: string; totalCents: number } | null;
  /** Payments applied to the deposit invoice (cents, from the ledger); null when not loaded. */
  appliedCents: number | null;
};

export type OnboardingSnapshot = {
  /** Job work types (interior, exterior, cabinets, deck_fence, add_on_only). */
  workTypes: readonly string[];
  /** A signed proposal/contract document is stored for the accepted estimate. */
  signedContractStored: boolean;
  /** The accepted estimate has a signature (even if the PDF is still being made). */
  estimateSigned: boolean;
  /** Change orders waiting on the customer (status "sent"). */
  changeOrdersSent: number;
  /** Signed change orders on the job. */
  changeOrdersSigned: number;
  deposit: DepositLedger;
  contact: { name: string; mobile: string | null; email: string | null } | null;
  property: {
    hasHoa: boolean;
    occupancy: string | null;
    pets: string | null;
    parking: string | null;
    accessNotes: string | null;
  } | null;
  /** Color sheet rows for the accepted scope (deleted rows left out). */
  colors: { total: number; chosen: number; confirmed: number };
  /** Color consultation appointments on the job. */
  colorConsult: { completed: boolean; booked: boolean };
  /** Live documents by category on the job (or its customer). */
  documents: { hoa: number; leadSafe: number };
  /**
   * A certified renovator (current RRP certificate) is on the job's crew.
   * `null` when crew data isn't loaded.
   */
  certifiedRenovatorAssigned: boolean | null;
  /** The accepted scope includes a repair allowance the customer accepted. */
  repairAllowanceAccepted: boolean;
  /** Statuses of the job's live paint orders. */
  paintOrderStatuses: readonly string[];
  /** Crew skills cover the job (null: no crew data). */
  crewCoversSkills: boolean | null;
  /** Whether any crew is assigned, and the skills still missing (labels). */
  crewAssigned?: boolean;
  crewMissingSkills?: readonly string[];
  /** When the prep-instructions message was last sent or simulated. */
  prepInstructionsSentAt: string | null;
  /** Promised start date (YYYY-MM-DD) and the exterior season (MM-DD). */
  promisedStartDate: string | null;
  season: { start: string; end: string };
};

export type RuleResult = {
  key: OnboardingKey;
  status: OnboardingStatus;
  /** Plain words: what was found, or what to do next. */
  detail: string;
  /** Set when the rule decides whether the item applies (HOA, change orders). */
  required?: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const ORDERED = new Set(["ordered", "partially_received", "picked_up", "delivered"]);
const SEASONAL = new Set(["exterior", "deck_fence"]);

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function blank(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Deposit received: the deposit invoice is paid ≥ its amount (ledger inputs). */
export function depositRule(d: DepositLedger): Omit<RuleResult, "key"> {
  if (!d.invoice) {
    return {
      status: "missing",
      detail: "There's no deposit invoice. It's created when the customer accepts the estimate.",
    };
  }
  if (d.invoice.status === "void") {
    return { status: "missing", detail: `Deposit invoice ${d.invoice.number} was voided.` };
  }
  const due = d.invoice.totalCents;
  if (d.appliedCents === null || d.appliedCents <= 0) {
    return {
      status: "pending",
      detail: `Waiting for ${money(due)} (invoice ${d.invoice.number}). Record the payment in Financial when it's in; this clears on its own.`,
    };
  }
  if (d.appliedCents >= due) {
    return {
      status: "verified",
      detail: `Deposit paid: ${money(d.appliedCents)} applied to ${d.invoice.number}.`,
    };
  }
  return {
    status: "pending",
    detail: `Partly paid: ${money(d.appliedCents)} of ${money(due)} on ${d.invoice.number}.`,
  };
}

/** One rule per requirement key. Required/not-required is decided by the caller's row. */
export function evaluateRule(key: OnboardingKey, s: OnboardingSnapshot): RuleResult {
  switch (key) {
    case "signed_contract":
      if (s.signedContractStored) {
        return {
          key,
          status: "verified",
          detail: "Signed proposal and contract are in Documents.",
        };
      }
      return s.estimateSigned
        ? {
            key,
            status: "pending",
            detail: "Signed. The signed PDF is still being stored; this clears on its own.",
          }
        : { key, status: "missing", detail: "No signed proposal or contract on file." };

    case "change_orders_resolved":
      return s.changeOrdersSent > 0
        ? {
            key,
            status: "pending",
            required: true,
            detail: `${plural(s.changeOrdersSent, "change order")} waiting for the customer's signature.`,
          }
        : { key, status: "verified", detail: "No change orders are waiting on the customer." };

    case "deposit_received":
      return { key, ...depositRule(s.deposit) };

    case "contact_reachable": {
      if (!s.contact) {
        return { key, status: "missing", detail: "The job has no primary contact." };
      }
      const missing: string[] = [];
      if (blank(s.contact.mobile)) missing.push("a mobile number");
      if (blank(s.contact.email)) missing.push("an email address");
      if (missing.length) {
        return { key, status: "missing", detail: `Add ${list(missing)} for ${s.contact.name}.` };
      }
      const bad: string[] = [];
      if (!E164.test(s.contact.mobile ?? "")) bad.push("mobile number");
      if (!EMAIL.test(s.contact.email ?? "")) bad.push("email address");
      return bad.length
        ? {
            key,
            status: "needs_review",
            detail: `Check ${s.contact.name}'s ${list(bad)}; it doesn't look valid.`,
          }
        : {
            key,
            status: "verified",
            detail: `${s.contact.name} has a mobile number and email on file.`,
          };
    }

    case "access_confirmed": {
      if (!s.property) return { key, status: "missing", detail: "The job has no property." };
      const missing: string[] = [];
      if (blank(s.property.accessNotes)) missing.push("access notes");
      if (blank(s.property.pets)) missing.push("pets");
      if (blank(s.property.parking)) missing.push("parking");
      if (blank(s.property.occupancy)) missing.push("occupancy");
      return missing.length
        ? {
            key,
            status: "missing",
            detail: `Fill in ${list(missing)} on the property ("none" is fine).`,
          }
        : { key, status: "verified", detail: "Access, pets, parking and occupancy are filled in." };
    }

    case "colors_selected": {
      const { total, chosen } = s.colors;
      if (total === 0) {
        return { key, status: "verified", detail: "Nothing in the accepted scope needs a color." };
      }
      if (chosen < total) {
        return {
          key,
          status: chosen === 0 ? "missing" : "pending",
          detail: `${chosen} of ${plural(total, "surface")} have a color. Fill in the color schedule.`,
        };
      }
      return {
        key,
        status: "verified",
        detail: `Colors chosen for all ${plural(total, "surface")}.`,
      };
    }

    case "color_consult_done":
      if (s.colorConsult.completed) {
        return { key, status: "verified", detail: "The color consultation is completed." };
      }
      return s.colorConsult.booked
        ? { key, status: "pending", detail: "The color consultation is booked, not completed yet." }
        : { key, status: "missing", detail: "Book the color consultation." };

    case "hoa_approval": {
      const applies = s.workTypes.includes("exterior") && (s.property?.hasHoa ?? false);
      if (!applies) {
        return { key, status: "not_required", required: false, detail: "No HOA approval needed." };
      }
      return s.documents.hoa > 0
        ? {
            key,
            status: "verified",
            required: true,
            detail: "HOA approval is uploaded to Documents.",
          }
        : {
            key,
            status: "missing",
            required: true,
            detail: "Upload the HOA's approval (category HOA) to Documents.",
          };
    }

    case "lead_safe_plan": {
      const hasAck = s.documents.leadSafe > 0;
      if (!hasAck) {
        return {
          key,
          status: "missing",
          detail:
            "Upload the signed “Renovate Right” acknowledgment (category Lead-Safe) and assign a certified renovator.",
        };
      }
      if (s.certifiedRenovatorAssigned === null) {
        return {
          key,
          status: "pending",
          detail: "Acknowledgment on file. Assign a crew with a current RRP certified renovator.",
        };
      }
      return s.certifiedRenovatorAssigned
        ? {
            key,
            status: "verified",
            detail: "Acknowledgment on file and a certified renovator is assigned.",
          }
        : {
            key,
            status: "missing",
            detail: "Acknowledgment on file. Assign a certified renovator to the crew.",
          };
    }

    case "repair_scope_approved":
      if (s.changeOrdersSigned > 0) {
        return { key, status: "verified", detail: "A change order for the work is signed." };
      }
      return s.repairAllowanceAccepted
        ? {
            key,
            status: "verified",
            detail: "The customer accepted the repair allowance with the estimate.",
          }
        : {
            key,
            status: "pending",
            detail: "Price the repairs found and get a signed change order.",
          };

    case "paint_ordered": {
      if (s.paintOrderStatuses.some((st) => ORDERED.has(st))) {
        return { key, status: "verified", detail: "Paint and materials are ordered." };
      }
      return s.paintOrderStatuses.length
        ? {
            key,
            status: "pending",
            detail:
              "The paint order is drafted, not placed. Mark it ordered in Schedule → Paint Orders.",
          }
        : { key, status: "missing", detail: "There's no paint order for this job yet." };
    }

    case "crew_assigned":
      if (s.crewCoversSkills === null) {
        return {
          key,
          status: "pending",
          detail: "Assign a crew with the skills this job needs.",
        };
      }
      if (s.crewAssigned === false) {
        return {
          key,
          status: "missing",
          detail:
            "No crew assigned. Assign one on the job's Schedule section or the Master Schedule.",
        };
      }
      return s.crewCoversSkills
        ? { key, status: "verified", detail: "The crew has every skill this job needs." }
        : {
            key,
            status: "missing",
            detail: s.crewMissingSkills?.length
              ? `The crew is missing: ${s.crewMissingSkills.join(", ")}. Assign a crew with those skills.`
              : "Assign a crew with the skills this job needs.",
          };

    case "prep_instructions_sent":
      return s.prepInstructionsSentAt
        ? { key, status: "verified", detail: "Prep instructions were sent to the customer." }
        : { key, status: "missing", detail: "Send the prep instructions to the customer." };

    case "start_in_season": {
      const applies = s.workTypes.some((w) => SEASONAL.has(w));
      if (!applies) {
        return { key, status: "not_required", detail: "Interior and cabinet work runs all year." };
      }
      if (!s.promisedStartDate) {
        return { key, status: "pending", detail: "No promised start date yet." };
      }
      return isInSeason(s.promisedStartDate, s.season.start, s.season.end)
        ? {
            key,
            status: "verified",
            detail: "The promised start date is inside the exterior season.",
          }
        : {
            key,
            status: "needs_review",
            detail:
              "The promised start date is outside the exterior season. Move it, or clear this with a note if the owner approved.",
          };
    }
  }
}

export type StoredRequirement = {
  key: string;
  required: boolean;
  status: string;
  verifiedAuto: boolean;
};

export function isOnboardingKey(key: string): key is OnboardingKey {
  return ONBOARDING_REQUIREMENTS.some((r) => r.key === key);
}

/** A row someone cleared by hand (the checks never overwrite it). */
export function isManualClear(row: Pick<StoredRequirement, "status" | "verifiedAuto">): boolean {
  return row.status === "verified" && !row.verifiedAuto;
}

/**
 * Results to write for a job's stored rows. A row that doesn't apply ends up
 * "not required"; one that applies takes the rule's status. Unknown keys are
 * skipped.
 */
export function evaluateChecklist(
  rows: readonly StoredRequirement[],
  s: OnboardingSnapshot,
): RuleResult[] {
  const out: RuleResult[] = [];
  for (const row of rows) {
    if (!isOnboardingKey(row.key)) continue;
    const r = evaluateRule(row.key, s);
    const required = r.required ?? row.required;
    if (!required) {
      out.push({
        ...r,
        status: "not_required",
        ...(r.required === undefined ? {} : { required }),
      });
    } else if (r.status === "not_required") {
      // Applies (row says required) but the rule found nothing to check: clear.
      out.push({ ...r, status: "verified" });
    } else {
      out.push(r);
    }
  }
  return out;
}
