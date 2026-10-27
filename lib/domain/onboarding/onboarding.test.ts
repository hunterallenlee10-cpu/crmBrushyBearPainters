import { describe, expect, it } from "vitest";
import { ONBOARDING_REQUIREMENTS, onboardingRequirements } from "@/lib/domain/estimating/outputs";
import {
  depositRule,
  evaluateChecklist,
  evaluateRule,
  isManualClear,
  type OnboardingSnapshot,
  type StoredRequirement,
} from "./rules";
import {
  checklistSummary,
  groupChecklist,
  readyToSchedule,
  requirementActions,
  shortLabel,
  statusTone,
  summaryLine,
  type ChecklistRow,
} from "./checklist";

const ready: OnboardingSnapshot = {
  workTypes: ["exterior"],
  signedContractStored: true,
  estimateSigned: true,
  changeOrdersSent: 0,
  changeOrdersSigned: 0,
  deposit: {
    invoice: { number: "INV-2026-0001", status: "paid", totalCents: 300_000 },
    appliedCents: 300_000,
  },
  contact: { name: "Maya Lee", mobile: "+14255550111", email: "maya@example.com" },
  property: {
    hasHoa: true,
    occupancy: "occupied",
    pets: "One dog",
    parking: "Driveway",
    accessNotes: "Side gate",
  },
  colors: { total: 3, chosen: 3, confirmed: 1 },
  colorConsult: { completed: true, booked: true },
  documents: { hoa: 1, leadSafe: 1 },
  certifiedRenovatorAssigned: true,
  repairAllowanceAccepted: true,
  paintOrderStatuses: ["ordered"],
  crewCoversSkills: true,
  prepInstructionsSentAt: "2026-10-20T17:00:00Z",
  promisedStartDate: "2026-07-06",
  season: { start: "06-01", end: "09-30" },
};

const allKeys = ONBOARDING_REQUIREMENTS.map((r) => r.key);

describe("auto-verify rules", () => {
  it("verifies every requirement on a fully prepared job", () => {
    for (const key of allKeys) {
      const r = evaluateRule(key, ready);
      expect([r.key, r.status]).toEqual([key, "verified"]);
      expect(r.detail.length).toBeGreaterThan(5);
    }
  });

  it("signed contract: stored PDF, signed but still storing, or nothing", () => {
    expect(evaluateRule("signed_contract", { ...ready, signedContractStored: false }).status).toBe(
      "pending",
    );
    expect(
      evaluateRule("signed_contract", {
        ...ready,
        signedContractStored: false,
        estimateSigned: false,
      }).status,
    ).toBe("missing");
  });

  it("change orders: a sent one makes the item required and pending", () => {
    const r = evaluateRule("change_orders_resolved", { ...ready, changeOrdersSent: 2 });
    expect(r).toMatchObject({ status: "pending", required: true });
    expect(r.detail).toMatch(/2 change orders/);
  });

  it("deposit: reads the money applied to the deposit invoice (ledger)", () => {
    expect(depositRule({ invoice: null, appliedCents: null }).status).toBe("missing");
    expect(
      depositRule({
        invoice: { number: "INV-1", status: "void", totalCents: 100 },
        appliedCents: 0,
      }).status,
    ).toBe("missing");
    const waiting = depositRule({
      invoice: { number: "INV-1", status: "draft", totalCents: 150_000 },
      appliedCents: null,
    });
    expect(waiting).toMatchObject({ status: "pending" });
    expect(waiting.detail).toMatch(/\$1,500\.00/);
    expect(waiting.detail).toMatch(/Record the payment in Financial/);
    const partial = depositRule({
      invoice: { number: "INV-1", status: "partially_paid", totalCents: 150_000 },
      appliedCents: 50_000,
    });
    expect(partial.status).toBe("pending");
    expect(partial.detail).toMatch(/\$500\.00 of \$1,500\.00/);
    expect(
      depositRule({
        invoice: { number: "INV-1", status: "sent", totalCents: 150_000 },
        appliedCents: 0,
      }).status,
    ).toBe("pending");
    expect(
      depositRule({
        invoice: { number: "INV-1", status: "paid", totalCents: 150_000 },
        appliedCents: 150_001,
      }).status,
    ).toBe("verified");
  });

  it("contact: needs both a mobile and an email, and checks they look valid", () => {
    expect(evaluateRule("contact_reachable", { ...ready, contact: null }).status).toBe("missing");
    const noEmail = evaluateRule("contact_reachable", {
      ...ready,
      contact: { name: "Maya", mobile: "+14255550111", email: null },
    });
    expect(noEmail).toMatchObject({ status: "missing" });
    expect(noEmail.detail).toBe("Add an email address for Maya.");
    const neither = evaluateRule("contact_reachable", {
      ...ready,
      contact: { name: "Maya", mobile: " ", email: "" },
    });
    expect(neither.detail).toBe("Add a mobile number and an email address for Maya.");
    expect(
      evaluateRule("contact_reachable", {
        ...ready,
        contact: { name: "Maya", mobile: "425-555", email: "maya@" },
      }).status,
    ).toBe("needs_review");
  });

  it("access: lists what's missing on the property", () => {
    expect(evaluateRule("access_confirmed", { ...ready, property: null }).status).toBe("missing");
    const r = evaluateRule("access_confirmed", {
      ...ready,
      property: { ...ready.property!, pets: null, occupancy: null },
    });
    expect(r.status).toBe("missing");
    expect(r.detail).toMatch(/pets and occupancy/);
  });

  it("colors: every surface in scope needs a color", () => {
    expect(
      evaluateRule("colors_selected", { ...ready, colors: { total: 0, chosen: 0, confirmed: 0 } })
        .status,
    ).toBe("verified");
    expect(
      evaluateRule("colors_selected", { ...ready, colors: { total: 4, chosen: 0, confirmed: 0 } })
        .status,
    ).toBe("missing");
    const some = evaluateRule("colors_selected", {
      ...ready,
      colors: { total: 4, chosen: 3, confirmed: 0 },
    });
    expect(some.status).toBe("pending");
    expect(some.detail).toMatch(/3 of 4 surfaces/);
  });

  it("color consult: completed, booked, or not booked", () => {
    expect(
      evaluateRule("color_consult_done", {
        ...ready,
        colorConsult: { completed: false, booked: true },
      }).status,
    ).toBe("pending");
    expect(
      evaluateRule("color_consult_done", {
        ...ready,
        colorConsult: { completed: false, booked: false },
      }).status,
    ).toBe("missing");
  });

  it("HOA: required only for exterior work on an HOA property, cleared by an HOA document", () => {
    expect(evaluateRule("hoa_approval", { ...ready, workTypes: ["interior"] })).toMatchObject({
      status: "not_required",
      required: false,
    });
    expect(
      evaluateRule("hoa_approval", { ...ready, property: { ...ready.property!, hasHoa: false } }),
    ).toMatchObject({ status: "not_required", required: false });
    expect(
      evaluateRule("hoa_approval", { ...ready, documents: { hoa: 0, leadSafe: 1 } }),
    ).toMatchObject({
      status: "missing",
      required: true,
    });
  });

  it("lead-safe: acknowledgment document plus a certified renovator on the crew", () => {
    expect(
      evaluateRule("lead_safe_plan", { ...ready, documents: { hoa: 1, leadSafe: 0 } }).status,
    ).toBe("missing");
    expect(
      evaluateRule("lead_safe_plan", { ...ready, certifiedRenovatorAssigned: null }),
    ).toMatchObject({ status: "pending" });
    expect(
      evaluateRule("lead_safe_plan", { ...ready, certifiedRenovatorAssigned: false }).status,
    ).toBe("missing");
  });

  it("repair scope: accepted allowance or a signed change order", () => {
    expect(
      evaluateRule("repair_scope_approved", { ...ready, repairAllowanceAccepted: false }).status,
    ).toBe("pending");
    expect(
      evaluateRule("repair_scope_approved", {
        ...ready,
        repairAllowanceAccepted: false,
        changeOrdersSigned: 1,
      }).status,
    ).toBe("verified");
  });

  it("paint: the order must be placed (ordered or later)", () => {
    expect(evaluateRule("paint_ordered", { ...ready, paintOrderStatuses: [] }).status).toBe(
      "missing",
    );
    expect(
      evaluateRule("paint_ordered", { ...ready, paintOrderStatuses: ["draft", "canceled"] }),
    ).toMatchObject({
      status: "pending",
      detail: "The paint order is drafted, not placed. Mark it ordered in Schedule → Paint Orders.",
    });
    expect(
      evaluateRule("paint_ordered", { ...ready, paintOrderStatuses: ["draft", "picked_up"] })
        .status,
    ).toBe("verified");
  });

  it("crew: no crew, missing skills, or covered", () => {
    expect(
      evaluateRule("crew_assigned", { ...ready, crewAssigned: false, crewCoversSkills: false })
        .detail,
    ).toMatch(/^No crew assigned/);
    expect(
      evaluateRule("crew_assigned", {
        ...ready,
        crewAssigned: true,
        crewCoversSkills: false,
        crewMissingSkills: ["Spray finish / cabinets"],
      }),
    ).toMatchObject({
      status: "missing",
      detail: "The crew is missing: Spray finish / cabinets. Assign a crew with those skills.",
    });
    expect(
      evaluateRule("crew_assigned", { ...ready, crewAssigned: true, crewCoversSkills: true })
        .status,
    ).toBe("verified");
    expect(evaluateRule("crew_assigned", { ...ready, crewCoversSkills: null })).toMatchObject({
      status: "pending",
    });
  });

  it("prep instructions: a logged message clears it", () => {
    expect(
      evaluateRule("prep_instructions_sent", { ...ready, prepInstructionsSentAt: null }).status,
    ).toBe("missing");
  });

  it("season: exterior starts must fall in the season window", () => {
    expect(evaluateRule("start_in_season", { ...ready, workTypes: ["interior"] }).status).toBe(
      "not_required",
    );
    expect(evaluateRule("start_in_season", { ...ready, promisedStartDate: null }).status).toBe(
      "pending",
    );
    expect(
      evaluateRule("start_in_season", { ...ready, promisedStartDate: "2026-11-02" }).status,
    ).toBe("needs_review");
    expect(
      evaluateRule("start_in_season", {
        ...ready,
        workTypes: ["deck_fence"],
        promisedStartDate: "2026-09-30",
      }).status,
    ).toBe("verified");
  });
});

function stored(
  rows = onboardingRequirements({
    workTypes: ["exterior"],
    hasHoa: true,
    leadSafeWork: true,
    hasRepairAllowance: true,
    hasColorConsult: false,
    depositCents: 300_000,
  }),
): StoredRequirement[] {
  return rows.map((r) => ({
    key: r.key,
    required: r.required,
    status: r.status,
    verifiedAuto: false,
  }));
}

describe("evaluateChecklist", () => {
  it("items that don't apply end up not required; unknown keys are skipped", () => {
    const rows = [
      ...stored(),
      { key: "made_up", required: true, status: "pending", verifiedAuto: false },
    ];
    const results = evaluateChecklist(rows, {
      ...ready,
      colorConsult: { completed: false, booked: false },
    });
    expect(results.find((r) => r.key === "color_consult_done")?.status).toBe("not_required");
    expect(results.find((r) => r.key === "change_orders_resolved")?.status).toBe("not_required");
    expect(results.some((r) => (r.key as string) === "made_up")).toBe(false);
    expect(results.filter((r) => r.status === "verified").length).toBe(12);
  });

  it("HOA can become required later (the property gained an HOA)", () => {
    const rows = stored(
      onboardingRequirements({
        workTypes: ["exterior"],
        hasHoa: false,
        leadSafeWork: false,
        hasRepairAllowance: false,
        hasColorConsult: false,
        depositCents: 1,
      }),
    );
    expect(rows.find((r) => r.key === "hoa_approval")?.required).toBe(false);
    const hoa = evaluateChecklist(rows, { ...ready, documents: { hoa: 0, leadSafe: 0 } }).find(
      (r) => r.key === "hoa_approval",
    );
    expect(hoa).toMatchObject({ status: "missing", required: true });
  });

  it("a required item whose rule finds nothing to check counts as verified", () => {
    const rows: StoredRequirement[] = [
      { key: "start_in_season", required: true, status: "pending", verifiedAuto: false },
    ];
    expect(evaluateChecklist(rows, { ...ready, workTypes: ["interior"] })[0]?.status).toBe(
      "verified",
    );
  });

  it("knows a manual clear from an automatic one", () => {
    expect(isManualClear({ status: "verified", verifiedAuto: false })).toBe(true);
    expect(isManualClear({ status: "verified", verifiedAuto: true })).toBe(false);
    expect(isManualClear({ status: "pending", verifiedAuto: false })).toBe(false);
  });
});

const row = (over: Partial<ChecklistRow>): ChecklistRow => ({
  key: "colors_selected",
  label: "Color selected for every area/surface in scope",
  group: "colors",
  required: true,
  status: "pending",
  verifiedAuto: false,
  ...over,
});

describe("checklist summary and the Ready to Schedule gate", () => {
  const rows: ChecklistRow[] = [
    row({ key: "signed_contract", group: "contract", status: "verified", verifiedAuto: true }),
    row({ key: "deposit_received", group: "money", status: "verified", verifiedAuto: false }),
    row({ key: "colors_selected", status: "missing" }),
    row({ key: "start_in_season", group: "weather", status: "needs_review" }),
    row({ key: "paint_ordered", group: "materials", status: "pending" }),
    row({ key: "hoa_approval", group: "compliance", required: false, status: "not_required" }),
  ];

  it("counts cleared, auto-verified and needing attention over required items", () => {
    const s = checklistSummary(rows);
    expect(s).toMatchObject({ required: 5, cleared: 2, autoVerified: 1, needAttention: 2 });
    expect(s.percent).toBeCloseTo(0.4);
    expect(s.open.map((o) => o.key)).toEqual([
      "colors_selected",
      "start_in_season",
      "paint_ordered",
    ]);
    expect(summaryLine(s)).toBe("2/5 cleared · 1 auto-verified · 2 need attention");
    expect(summaryLine(checklistSummary([]))).toBe("No required items");
    expect(summaryLine({ ...s, needAttention: 1 })).toMatch(/1 needs attention/);
    expect(checklistSummary([]).percent).toBeNull();
  });

  it("passes only when every required item is cleared and no hold blocks", () => {
    const g = readyToSchedule(rows, []);
    expect(g.passes).toBe(false);
    expect(g.reasons[0]).toBe(
      "3 required onboarding items are still open: colors, season start date, paint order.",
    );
    const cleared = rows.map((r) => (r.required ? { ...r, status: "verified" } : r));
    expect(readyToSchedule(cleared, [])).toEqual({ passes: true, reasons: [] });
    expect(readyToSchedule(cleared, ["HOA hold"]).reasons).toEqual(["Release the HOA hold first."]);
    expect(readyToSchedule([], []).reasons[0]).toMatch(/hasn't been built/);
    expect(readyToSchedule([row({ status: "missing" })], []).reasons[0]).toMatch(
      /1 required onboarding item is still open/,
    );
  });

  it("offers request, upload, task and clear on open items; reopen on manual clears", () => {
    expect(requirementActions(row({ key: "hoa_approval", status: "missing" }))).toEqual([
      "request",
      "upload",
      "task",
      "clear",
    ]);
    expect(requirementActions(row({ key: "paint_ordered", status: "pending" }))).toEqual([
      "task",
      "clear",
    ]);
    expect(requirementActions(row({ status: "verified", verifiedAuto: true }))).toEqual([]);
    expect(requirementActions(row({ status: "verified", verifiedAuto: false }))).toEqual([
      "reopen",
    ]);
    expect(requirementActions(row({ status: "not_required" }))).toEqual([]);
    expect(requirementActions(row({ key: "unknown" }))).toEqual([]);
  });

  it("groups rows in SPEC order and picks status tones", () => {
    const groups = groupChecklist(rows);
    expect(groups.map((g) => g.group)).toEqual([
      "contract",
      "money",
      "colors",
      "compliance",
      "materials",
      "weather",
    ]);
    expect(statusTone("verified")).toBe("success");
    expect(statusTone("missing")).toBe("danger");
    expect(statusTone("needs_review")).toBe("warning");
    expect(statusTone("pending")).toBe("neutral");
    expect(shortLabel("deposit_received", "x")).toBe("deposit");
    expect(shortLabel("other", "Fallback")).toBe("Fallback");
  });
});
