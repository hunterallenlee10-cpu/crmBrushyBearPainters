import {
  PRIMER_LABELS,
  UNIT_LABELS,
  type Container,
  type Primer,
  type Unit,
  type WorkOrderPhase,
} from "./constants";
import { roundToContainers, type ContainerBreakdown } from "./containers";
import { round2 } from "./measure";

/**
 * What an accepted estimate produces (SPEC §7.5, §6.4): the customer's scope in
 * plain English, the paint order draft, work orders by phase with budgeted
 * hours, color-selection rows to fill in, and the onboarding requirements.
 * Pure: the accept transaction stores what these return.
 */

// ---------------------------------------------------------------------------
// Plain-English scope
// ---------------------------------------------------------------------------

export function formatQuantity(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : round2(n).toLocaleString("en-US");
}

export type DescribeInput = {
  name: string;
  quantity: number;
  unit: Unit;
  kind: "production_rate" | "flat";
  coats?: number;
  primer?: Primer;
  sheenLabel?: string | null;
  sides?: number;
  /** Extra words the estimator typed for the customer. */
  note?: string | null;
};

/** "Walls — 420 sq ft · 2 coats · spot prime · Eggshell" (no prices, hours or costs). */
export function describeLine(l: DescribeInput): string {
  const parts: string[] = [];
  if (l.unit === "lump") {
    // A lump sum is the whole item; no quantity.
  } else {
    parts.push(`${formatQuantity(l.quantity)} ${UNIT_LABELS[l.unit]}`);
  }
  if (l.kind === "production_rate") {
    if (l.sides === 2) parts.push("both sides");
    if (l.coats) parts.push(`${l.coats} coat${l.coats === 1 ? "" : "s"}`);
    if (l.primer && l.primer !== "none") parts.push(PRIMER_LABELS[l.primer].toLowerCase());
    if (l.sheenLabel) parts.push(l.sheenLabel);
  }
  const head = parts.length ? `${l.name} — ${parts.join(" · ")}` : l.name;
  return l.note ? `${head}. ${l.note}` : head;
}

// ---------------------------------------------------------------------------
// Paint order draft
// ---------------------------------------------------------------------------

export type PaintLineInput = {
  productId: string | null;
  productLabel: string | null;
  containers: readonly Container[];
  costPerGalCents: number;
  sheen: string | null;
  gallonsNeeded: number;
  primerProductId: string | null;
  primerProductLabel: string | null;
  primerContainers: readonly Container[];
  primerCostPerGalCents: number;
  primerGallonsNeeded: number;
  sundriesCents: number;
};

export type PaintOrderLine = {
  paintProductId: string | null;
  label: string;
  sheen: string | null;
  isPrimer: boolean;
  isSundries: boolean;
  gallonsNeeded: number;
  gallons: number;
  containers: ContainerBreakdown | null;
  unitCostCents: number;
  costCents: number;
};

/**
 * Groups gallons by product and sheen (primer separately), then rounds each
 * group to containers once — cheaper than rounding every line — and adds one
 * sundries line.
 */
export function buildPaintOrder(lines: readonly PaintLineInput[]): PaintOrderLine[] {
  type Group = {
    productId: string | null;
    label: string;
    sheen: string | null;
    isPrimer: boolean;
    containers: readonly Container[];
    cost: number;
    need: number;
  };
  const groups = new Map<string, Group>();
  const push = (g: Omit<Group, "need">, need: number) => {
    if (need <= 0 || !g.productId) return;
    const key = `${g.isPrimer ? "p" : "f"}:${g.productId}:${g.sheen ?? ""}`;
    const cur = groups.get(key) ?? { ...g, need: 0 };
    cur.need = round2(cur.need + need);
    groups.set(key, cur);
  };
  let sundries = 0;
  for (const l of lines) {
    push(
      {
        productId: l.productId,
        label: l.productLabel ?? "Paint",
        sheen: l.sheen,
        isPrimer: false,
        containers: l.containers,
        cost: l.costPerGalCents,
      },
      l.gallonsNeeded,
    );
    const primerId = l.primerProductId ?? l.productId;
    push(
      {
        productId: primerId,
        label: l.primerProductLabel ?? l.productLabel ?? "Primer",
        sheen: null,
        isPrimer: true,
        containers: l.primerProductId ? l.primerContainers : l.containers,
        cost: l.primerProductId ? l.primerCostPerGalCents : l.costPerGalCents,
      },
      l.primerGallonsNeeded,
    );
    sundries += Math.max(0, l.sundriesCents);
  }
  const out: PaintOrderLine[] = [...groups.values()]
    .sort((a, b) => Number(a.isPrimer) - Number(b.isPrimer) || a.label.localeCompare(b.label))
    .map((g) => {
      const r = roundToContainers(g.need, g.containers);
      return {
        paintProductId: g.productId,
        label: g.label,
        sheen: g.sheen,
        isPrimer: g.isPrimer,
        isSundries: false,
        gallonsNeeded: g.need,
        gallons: r.gallons,
        containers: r.containers,
        unitCostCents: g.cost,
        costCents: Math.round(r.gallons * g.cost),
      };
    });
  if (sundries > 0) {
    out.push({
      paintProductId: null,
      label: "Sundries (tape, plastic, caulk, patch)",
      sheen: null,
      isPrimer: false,
      isSundries: true,
      gallonsNeeded: 0,
      gallons: 0,
      containers: null,
      unitCostCents: sundries,
      costCents: sundries,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Work orders by phase
// ---------------------------------------------------------------------------

export type WorkLineInput = {
  description: string;
  workType: string | null;
  /** Catalog item's phase, when it names one (repair, prep for washing…). */
  phase: WorkOrderPhase | null;
  laborHours: number;
  prepHours: number;
};

export type WorkOrderDraft = {
  phase: WorkOrderPhase;
  budgetedHours: number;
  scopeSummary: string;
};

const PHASE_ORDER: WorkOrderPhase[] = [
  "prep",
  "repair",
  "paint",
  "cabinet_shop",
  "stain",
  "touch_up",
  "warranty",
];

export function buildWorkOrders(lines: readonly WorkLineInput[]): WorkOrderDraft[] {
  const acc = new Map<WorkOrderPhase, { hours: number; scope: string[] }>();
  const add = (phase: WorkOrderPhase, hours: number, text: string) => {
    if (hours <= 0 && !text) return;
    const cur = acc.get(phase) ?? { hours: 0, scope: [] };
    cur.hours += Math.max(0, hours);
    if (text && !cur.scope.includes(text)) cur.scope.push(text);
    acc.set(phase, cur);
  };
  for (const l of lines) {
    if (l.phase) {
      add(l.phase, l.laborHours, l.description);
    } else if (l.workType === "cabinets") {
      add("cabinet_shop", l.laborHours, l.description);
    } else if (l.workType === "deck_fence") {
      add("stain", l.laborHours, l.description);
    } else {
      const prep = Math.min(l.prepHours, l.laborHours);
      if (prep > 0) add("prep", prep, l.description);
      add("paint", l.laborHours - prep, l.description);
    }
  }
  return PHASE_ORDER.filter((p) => acc.has(p)).map((p) => {
    const a = acc.get(p) as { hours: number; scope: string[] };
    const summary = a.scope.join("\n");
    return {
      phase: p,
      budgetedHours: round2(a.hours),
      scopeSummary: summary.length > 2000 ? `${summary.slice(0, 1997)}…` : summary,
    };
  });
}

// ---------------------------------------------------------------------------
// Color selections to fill in
// ---------------------------------------------------------------------------

export type ColorSeedInput = {
  lineId: string;
  areaName: string | null;
  surface: string;
  productId: string | null;
  brand: string | null;
  sheen: string | null;
  paints: boolean;
};

export type ColorSeed = {
  lineId: string;
  area: string;
  surface: string;
  productId: string | null;
  brand: string | null;
  sheen: string | null;
};

export function colorSelectionSeeds(lines: readonly ColorSeedInput[]): ColorSeed[] {
  return lines
    .filter((l) => l.paints)
    .map((l) => ({
      lineId: l.lineId,
      area: l.areaName?.trim() || "General",
      surface: l.surface,
      productId: l.productId,
      brand: l.brand,
      sheen: l.sheen,
    }));
}

// ---------------------------------------------------------------------------
// Onboarding requirements (SPEC §6.4)
// ---------------------------------------------------------------------------

export const ONBOARDING_GROUPS = [
  "contract",
  "money",
  "customer",
  "colors",
  "compliance",
  "materials",
  "crew",
  "customer_prep",
  "weather",
] as const;
export type OnboardingGroup = (typeof ONBOARDING_GROUPS)[number];
export const ONBOARDING_GROUP_LABELS: Record<OnboardingGroup, string> = {
  contract: "Contract & Agreement",
  money: "Money",
  customer: "Customer & Access",
  colors: "Colors & Products",
  compliance: "Property & Compliance",
  materials: "Materials",
  crew: "Crew",
  customer_prep: "Customer Prep",
  weather: "Weather",
};

export const ONBOARDING_STATUSES = [
  "verified",
  "pending",
  "missing",
  "needs_review",
  "not_required",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  verified: "Verified",
  pending: "Pending",
  missing: "Missing",
  needs_review: "Needs review",
  not_required: "Not required",
};

/** Roles that own a requirement (who clears it). */
export type OnboardingOwnerRole = "estimator" | "office" | "point_of_contact" | "project_manager";

type RequirementDef = {
  key: string;
  group: OnboardingGroup;
  label: string;
  ownerRole: OnboardingOwnerRole;
  /** Auto-verify rule key (checks run in Phase 5). */
  rule: string;
  /** "Required when", in words. */
  when: string;
};

export const ONBOARDING_REQUIREMENTS = [
  {
    key: "signed_contract",
    group: "contract",
    label: "Signed contract/proposal on file",
    ownerRole: "estimator",
    rule: "signed_document_exists",
    when: "Always",
  },
  {
    key: "change_orders_resolved",
    group: "contract",
    label: "Change orders resolved",
    ownerRole: "estimator",
    rule: "no_change_order_sent",
    when: "When a change order is waiting on the customer",
  },
  {
    key: "deposit_received",
    group: "money",
    label: "Deposit received",
    ownerRole: "office",
    rule: "deposit_invoice_paid",
    when: "Always (deposit % from settings)",
  },
  {
    key: "contact_reachable",
    group: "customer",
    label: "Primary contact reachable (mobile + email)",
    ownerRole: "point_of_contact",
    rule: "primary_contact_mobile_and_email",
    when: "Always",
  },
  {
    key: "access_confirmed",
    group: "customer",
    label: "Access, pets, parking, occupancy confirmed",
    ownerRole: "point_of_contact",
    rule: "property_access_fields_filled",
    when: "Always",
  },
  {
    key: "colors_selected",
    group: "colors",
    label: "Color selected for every area/surface in scope",
    ownerRole: "estimator",
    rule: "color_selections_complete",
    when: "Always",
  },
  {
    key: "color_consult_done",
    group: "colors",
    label: "Color consult done",
    ownerRole: "estimator",
    rule: "color_consult_appointment_completed",
    when: "When the color consultation add-on is purchased",
  },
  {
    key: "hoa_approval",
    group: "compliance",
    label: "HOA approval on file",
    ownerRole: "office",
    rule: "hoa_document_uploaded",
    when: "Exterior work on a property with an HOA",
  },
  {
    key: "lead_safe_plan",
    group: "compliance",
    label: "Lead-safe (RRP) plan + “Renovate Right” pamphlet acknowledgment",
    ownerRole: "project_manager",
    rule: "lead_safe_ack_signed_and_certified_renovator",
    when: "Pre-1978 (or not sure) and the scope disturbs painted surfaces",
  },
  {
    key: "repair_scope_approved",
    group: "compliance",
    label: "Wood rot / repair scope approved",
    ownerRole: "estimator",
    rule: "repair_line_approved_or_change_order_signed",
    when: "When the estimate has a repair allowance",
  },
  {
    key: "paint_ordered",
    group: "materials",
    label: "Paint & materials ordered",
    ownerRole: "project_manager",
    rule: "paint_order_ordered",
    when: "Always",
  },
  {
    key: "crew_assigned",
    group: "crew",
    label: "Crew assigned with required skills",
    ownerRole: "office",
    rule: "crew_skills_cover_job",
    when: "Always",
  },
  {
    key: "prep_instructions_sent",
    group: "customer_prep",
    label:
      "Prep instructions sent (move furniture/valuables, clear exterior perimeter, water & power access)",
    ownerRole: "point_of_contact",
    rule: "prep_instructions_message_logged",
    when: "Always",
  },
  {
    key: "start_in_season",
    group: "weather",
    label: "Start date inside production season",
    ownerRole: "office",
    rule: "promised_start_in_season",
    when: "Exterior and deck/fence work",
  },
] as const satisfies readonly RequirementDef[];

export type OnboardingKey = (typeof ONBOARDING_REQUIREMENTS)[number]["key"];

export type OnboardingInput = {
  /** Job work types plus the work types of every accepted line. */
  workTypes: readonly string[];
  hasHoa: boolean;
  /** Any accepted line is flagged lead-safe. */
  leadSafeWork: boolean;
  /** Any accepted line is a repair allowance. */
  hasRepairAllowance: boolean;
  /** The color consultation add-on was selected. */
  hasColorConsult: boolean;
  depositCents: number;
};

export type OnboardingRow = {
  key: OnboardingKey;
  group: OnboardingGroup;
  label: string;
  required: boolean;
  ownerRole: OnboardingOwnerRole;
  status: OnboardingStatus;
  autoVerifyRule: string;
  sortOrder: number;
};

const SEASONAL = new Set(["exterior", "deck_fence"]);

export function onboardingRequirements(input: OnboardingInput): OnboardingRow[] {
  const exterior = input.workTypes.includes("exterior");
  const seasonal = input.workTypes.some((w) => SEASONAL.has(w));
  const requiredWhen: Record<OnboardingKey, boolean> = {
    signed_contract: true,
    change_orders_resolved: false,
    deposit_received: input.depositCents > 0,
    contact_reachable: true,
    access_confirmed: true,
    colors_selected: true,
    color_consult_done: input.hasColorConsult,
    hoa_approval: exterior && input.hasHoa,
    lead_safe_plan: input.leadSafeWork,
    repair_scope_approved: input.hasRepairAllowance,
    paint_ordered: true,
    crew_assigned: true,
    prep_instructions_sent: true,
    start_in_season: seasonal,
  };
  return ONBOARDING_REQUIREMENTS.map((r, i) => {
    const required = requiredWhen[r.key];
    return {
      key: r.key,
      group: r.group,
      label: r.label,
      required,
      ownerRole: r.ownerRole,
      status: required ? "pending" : "not_required",
      autoVerifyRule: r.rule,
      sortOrder: (i + 1) * 10,
    };
  });
}

/** "10/14 cleared" style progress over required items. */
export function onboardingProgress(rows: readonly { required: boolean; status: string }[]): {
  required: number;
  cleared: number;
} {
  const required = rows.filter((r) => r.required);
  return {
    required: required.length,
    cleared: required.filter((r) => r.status === "verified").length,
  };
}
