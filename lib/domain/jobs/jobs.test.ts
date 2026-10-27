import { describe, expect, it } from "vitest";
import { JOB_STAGES, type JobStageId } from "@/lib/domain/stages";
import { EXIT_GATES, checkTransition, exitGate, nextStage, type GateContext } from "./gates";
import { computeJobHealth, healthLabel, type HealthInput } from "./health";

const open: GateContext = {
  walkthroughMeasured: false,
  estimateSent: false,
  estimateSigned: false,
  depositInvoiceReady: false,
  blockingHolds: [],
  onboardingOpen: null,
};
const measured: GateContext = { ...open, walkthroughMeasured: true };

describe("stage order", () => {
  it("walks the pipeline one stage at a time and stops when closed", () => {
    const seq: JobStageId[] = [];
    let s: JobStageId | null = "walkthrough_scheduled";
    while (s) {
      seq.push(s);
      s = nextStage(s);
    }
    expect(seq).toEqual(JOB_STAGES.filter((x) => x.id !== "closed_lost").map((x) => x.id));
    expect(nextStage("closed_lost")).toBeNull();
  });

  it("has an exit gate for every open stage", () => {
    for (const s of JOB_STAGES) {
      if (s.id === "closed_won" || s.id === "closed_lost") continue;
      expect(EXIT_GATES[s.id].requirement.length).toBeGreaterThan(5);
    }
  });
});

describe("gates", () => {
  it("the walkthrough gate passes once the walkthrough is measured", () => {
    expect(exitGate("walkthrough_scheduled", open).passes).toBe(false);
    expect(exitGate("walkthrough_scheduled", open).reasons[0]).toMatch(/Measured/);
    expect(exitGate("walkthrough_scheduled", measured).passes).toBe(true);
  });

  it("estimate gates read the estimate, the signature and the deposit invoice (Phase 4)", () => {
    expect(exitGate("walkthrough_complete", measured)).toMatchObject({
      passes: false,
      reasons: ["No estimate has been sent yet."],
    });
    expect(exitGate("walkthrough_complete", { ...measured, estimateSent: true }).passes).toBe(true);
    expect(exitGate("estimate_sent", { ...measured, estimateSent: true }).reasons[0]).toMatch(
      /accepted and signed/,
    );
    expect(exitGate("estimate_sent", { ...measured, estimateSigned: true }).passes).toBe(true);
    expect(exitGate("sold", measured).reasons[0]).toMatch(/deposit invoice/);
    expect(exitGate("sold", { ...measured, depositInvoiceReady: true }).passes).toBe(true);
  });

  it("production gates read the schedule, materials, work orders and punch list", () => {
    const g = exitGate("ready_to_schedule", measured);
    expect(g.passes).toBe(false);
    expect(g.reasons[0]).toMatch(/Publish changes/);
    expect(exitGate("ready_to_schedule", { ...measured, schedulePublished: true }).passes).toBe(
      true,
    );
    const sched = exitGate("scheduled", {
      ...measured,
      firstPublishedStart: "2027-07-12",
      today: "2027-07-10",
      materialsOpen: ["PO-2027-0001"],
    });
    expect(sched.reasons).toEqual([
      "Paint isn't picked up or delivered yet (PO-2027-0001). Update it in Paint Orders.",
      "The first production day is Mon, Jul 12. The job starts then.",
    ]);
    expect(exitGate("scheduled", measured).reasons).toEqual(["No production dates are published."]);
    expect(
      exitGate("scheduled", {
        ...measured,
        firstPublishedStart: "2027-07-12",
        today: "2027-07-12",
        materialsOpen: [],
      }).passes,
    ).toBe(true);
    expect(exitGate("in_progress", measured).reasons).toEqual(["This job has no work orders."]);
    expect(
      exitGate("in_progress", { ...measured, workOrders: { total: 3, open: 1 } }).reasons,
    ).toEqual(["1 of 3 work orders isn't complete."]);
    expect(
      exitGate("in_progress", { ...measured, workOrders: { total: 2, open: 2 } }).reasons[0],
    ).toBe("2 of 2 work orders aren't complete.");
    expect(exitGate("in_progress", { ...measured, workOrders: { total: 1, open: 0 } }).passes).toBe(
      true,
    );
    expect(exitGate("final_walkthrough", measured).reasons).toEqual([
      "The final walkthrough isn't marked completed yet.",
    ]);
    expect(
      exitGate("final_walkthrough", {
        ...measured,
        punch: { open: 2, finalWalkthroughDone: true, signedOff: false },
      }).reasons,
    ).toEqual(["2 punch items are still open. Fix them, or capture the customer's sign-off."]);
    expect(
      exitGate("final_walkthrough", {
        ...measured,
        punch: { open: 0, finalWalkthroughDone: true, signedOff: false },
      }).passes,
    ).toBe(true);
    expect(
      exitGate("final_walkthrough", {
        ...measured,
        punch: { open: 2, finalWalkthroughDone: false, signedOff: true },
      }).passes,
    ).toBe(true);
  });

  it("money gates read the final invoice and the ledger (Phase 7)", () => {
    expect(exitGate("completed", measured).reasons[0]).toMatch(/no final invoice yet/);
    expect(
      exitGate("completed", { ...measured, finalInvoice: { number: "INV-1", sent: false } })
        .reasons[0],
    ).toBe("The final invoice INV-1 is drafted but not sent. Send it from Financial.");
    expect(
      exitGate("completed", { ...measured, finalInvoice: { number: "INV-1", sent: true } }).passes,
    ).toBe(true);
    const money = (billedCents: number, leftToBillCents: number, balanceCents: number) => ({
      ...measured,
      money: { billedCents, leftToBillCents, balanceCents },
    });
    expect(exitGate("invoiced", measured).passes).toBe(false);
    expect(exitGate("invoiced", money(1000, 0, 0)).passes).toBe(true);
    expect(exitGate("invoiced", money(1000, 0, 250)).reasons).toEqual(["The balance is $2.50."]);
    expect(exitGate("invoiced", money(0, 0, 0)).reasons).toEqual(["Nothing has been billed yet."]);
    expect(exitGate("invoiced", money(1000, 500, 0)).reasons[0]).toMatch(/\$5.00 is still left/);
    expect(exitGate("invoiced", money(1000, -100, -50)).reasons).toHaveLength(2);
    expect(exitGate("paid_in_full", money(1000, 0, 300)).passes).toBe(false);
    expect(exitGate("paid_in_full", money(1000, 0, 0)).passes).toBe(true);
  });

  it("the onboarding gate needs a cleared checklist and no blocking holds", () => {
    expect(exitGate("onboarding", measured).reasons[0]).toMatch(/hasn't been built/);
    const open2 = exitGate("onboarding", { ...measured, onboardingOpen: ["deposit", "colors"] });
    expect(open2.passes).toBe(false);
    expect(open2.reasons).toEqual(["2 required onboarding items are still open: deposit, colors."]);
    expect(exitGate("onboarding", { ...measured, onboardingOpen: ["deposit"] }).reasons[0]).toMatch(
      /1 required onboarding item is still open/,
    );
    const held = exitGate("onboarding", {
      ...measured,
      onboardingOpen: [],
      blockingHolds: ["HOA"],
    });
    expect(held).toMatchObject({ passes: false, reasons: ["Release the HOA hold first."] });
    expect(exitGate("onboarding", { ...measured, onboardingOpen: [] }).passes).toBe(true);
    // Forward move: allowed when cleared; holds still stop it, with one message.
    expect(
      checkTransition("onboarding", "ready_to_schedule", { ...measured, onboardingOpen: [] })
        .allowed,
    ).toBe(true);
    const blocked = checkTransition("onboarding", "ready_to_schedule", {
      ...measured,
      onboardingOpen: [],
      blockingHolds: ["Deposit Hold"],
    });
    expect(blocked).toMatchObject({ allowed: false, overridable: false, blockedByHolds: true });
    expect(blocked.reasons).toEqual([
      "Release the Deposit Hold first. Holds stop scheduling even with an override.",
    ]);
    const notCleared = checkTransition("onboarding", "ready_to_schedule", {
      ...measured,
      onboardingOpen: ["colors"],
    });
    expect(notCleared).toMatchObject({ allowed: false, overridable: true });
  });

  it("Paid in Full may close as won", () => {
    expect(exitGate("paid_in_full", open).passes).toBe(true);
  });
});

describe("transitions", () => {
  it("moves one stage forward only when the gate passes", () => {
    expect(
      checkTransition("walkthrough_scheduled", "walkthrough_complete", measured),
    ).toMatchObject({
      kind: "forward",
      allowed: true,
      overridable: false,
    });
    expect(checkTransition("walkthrough_scheduled", "walkthrough_complete", open)).toMatchObject({
      kind: "forward",
      allowed: false,
      overridable: true,
    });
  });

  it("skipping, going back and reopening need an override", () => {
    expect(checkTransition("walkthrough_scheduled", "sold", measured)).toMatchObject({
      kind: "skip",
      allowed: false,
      overridable: true,
    });
    expect(checkTransition("sold", "estimate_sent", measured)).toMatchObject({
      kind: "back",
      allowed: false,
      overridable: true,
    });
    expect(checkTransition("closed_lost", "sold", measured)).toMatchObject({
      kind: "reopen",
      allowed: false,
      overridable: true,
    });
    expect(checkTransition("in_progress", "closed_won", measured).kind).toBe("skip");
  });

  it("Closed Lost needs only a lost reason", () => {
    expect(checkTransition("onboarding", "closed_lost", open)).toMatchObject({
      kind: "lost",
      allowed: false,
      needsLostReason: true,
      overridable: false,
    });
    expect(
      checkTransition("onboarding", "closed_lost", open, { lostReason: "price" }),
    ).toMatchObject({
      allowed: true,
    });
    expect(
      checkTransition("closed_won", "closed_lost", open, { lostReason: "price" }),
    ).toMatchObject({ allowed: false, overridable: true });
  });

  it("blocking holds stop Ready to Schedule and later, even with an override", () => {
    const held: GateContext = { ...measured, blockingHolds: ["HOA"] };
    const r = checkTransition("onboarding", "ready_to_schedule", held);
    expect(r).toMatchObject({ allowed: false, overridable: false, blockedByHolds: true });
    expect(r.reasons[0]).toMatch(/Release the HOA hold/);
    expect(checkTransition("sold", "onboarding", held).blockedByHolds).toBe(false);
    expect(
      checkTransition("onboarding", "closed_lost", held, { lostReason: "price" }).allowed,
    ).toBe(true);
  });

  it("refuses moving to the same stage", () => {
    expect(checkTransition("sold", "sold", open).allowed).toBe(false);
  });
});

const now = new Date("2026-10-26T18:00:00Z"); // 11:00 Pacific
const base: HealthInput = {
  stage: "walkthrough_scheduled",
  stageEnteredAt: "2026-10-25T18:00:00Z",
  pointOfContactId: "u1",
  nextAppointmentAt: "2026-10-28T17:00:00Z",
  walkthroughDone: false,
  overdueTaskCount: 0,
  contractSignedAt: null,
  depositPaidAt: null,
  promisedStartDate: null,
  actualStartDate: null,
};

describe("job health", () => {
  it("a healthy new job scores 100", () => {
    const h = computeJobHealth(base, now);
    expect(h?.score).toBe(100);
    expect(h?.factors.map((f) => f.key)).toEqual([
      "poc_assigned",
      "next_appointment",
      "no_overdue_tasks",
      "stage_not_stale",
    ]);
  });

  it("failed checks lower the score and say what to do", () => {
    const h = computeJobHealth(
      { ...base, pointOfContactId: null, nextAppointmentAt: null, overdueTaskCount: 2 },
      now,
    );
    // 10 + 15 + 15 failed of 60 → 20/60
    expect(h?.score).toBe(33);
    const tasks = h?.factors.find((f) => f.key === "no_overdue_tasks");
    expect(tasks?.recommendation).toMatch(/2 tasks are overdue/);
    expect(tasks?.action).toBe("review_tasks");
  });

  it("flags a stale stage", () => {
    const h = computeJobHealth({ ...base, stageEnteredAt: "2026-10-01T18:00:00Z" }, now);
    const f = h?.factors.find((x) => x.key === "stage_not_stale");
    expect(f?.status).toBe("fail");
    expect(f?.recommendation).toMatch(/25 days in Walkthrough Scheduled/);
  });

  it("checks contract and deposit from Sold / Onboarding on", () => {
    const sold = computeJobHealth({ ...base, stage: "sold", nextAppointmentAt: null }, now);
    expect(sold?.factors.some((f) => f.key === "contract_signed" && f.status === "fail")).toBe(
      true,
    );
    expect(sold?.factors.some((f) => f.key === "deposit_paid")).toBe(false);
    const onboarding = computeJobHealth(
      { ...base, stage: "onboarding", contractSignedAt: "2026-10-20T00:00:00Z" },
      now,
    );
    expect(onboarding?.factors.find((f) => f.key === "deposit_paid")?.status).toBe("fail");
  });

  it("the balance check reads the ledger once the job is completed (Phase 7)", () => {
    const done = {
      ...base,
      stage: "completed" as const,
      contractSignedAt: "2026-10-20T00:00:00Z",
      depositPaidAt: "2026-10-21T00:00:00Z",
    };
    const unknown = computeJobHealth(done, now);
    expect(unknown?.factors.find((f) => f.key === "balance_current")).toBeUndefined();
    expect(unknown?.factors.find((f) => f.key === "crew_assigned")).toBeUndefined();
    const current = computeJobHealth({ ...done, money: { dueCents: 0, overdueInvoices: 0 } }, now);
    expect(current?.factors.find((f) => f.key === "balance_current")?.status).toBe("pass");
    const late = computeJobHealth({ ...done, money: { dueCents: 22500, overdueInvoices: 1 } }, now);
    expect(late?.factors.find((f) => f.key === "balance_current")).toMatchObject({
      status: "fail",
      action: "collect_payment",
      recommendation:
        "$225.00 is past due on 1 invoice. Follow up with the customer or record the payment.",
    });
    expect(late?.score).toBeLessThan(current?.score ?? 0);
  });

  it("crew, schedule and daily-log checks count in production", () => {
    const ready = computeJobHealth(
      {
        ...base,
        stage: "ready_to_schedule",
        contractSignedAt: "2026-10-20T00:00:00Z",
        depositPaidAt: "2026-10-21T00:00:00Z",
        crewAssigned: false,
        scheduled: false,
      },
      now,
    );
    expect(ready?.factors.find((f) => f.key === "crew_assigned")).toMatchObject({
      status: "fail",
      action: "assign_crew",
    });
    expect(ready?.factors.find((f) => f.key === "on_schedule")?.action).toBe("schedule_job");
    const running = computeJobHealth(
      {
        ...base,
        stage: "in_progress",
        contractSignedAt: "2026-10-20T00:00:00Z",
        depositPaidAt: "2026-10-21T00:00:00Z",
        crewAssigned: true,
        scheduled: true,
        dailyLogs: { due: 4, missed: 1 },
      },
      now,
    );
    expect(running?.factors.find((f) => f.key === "daily_logs")?.recommendation).toBe(
      "1 of 4 production days has no daily log. Post the daily update so the customer hears from us.",
    );
    expect(running?.factors.find((f) => f.key === "on_schedule")).toBeUndefined();
    const ok = computeJobHealth(
      { ...base, stage: "in_progress", crewAssigned: true, dailyLogs: { due: 2, missed: 0 } },
      now,
    );
    expect(ok?.factors.find((f) => f.key === "daily_logs")?.status).toBe("pass");
  });

  it("onboarding progress and a cleared deposit item count", () => {
    const input = {
      ...base,
      stage: "onboarding" as const,
      contractSignedAt: "2026-10-20T00:00:00Z",
      onboarding: { required: 10, cleared: 7, open: ["deposit", "colors", "paint order"] },
    };
    const h = computeJobHealth(input, now);
    const ob = h?.factors.find((f) => f.key === "onboarding_cleared");
    expect(ob).toMatchObject({ status: "fail", action: "review_onboarding" });
    expect(ob?.recommendation).toBe(
      "7 of 10 onboarding items cleared. Still open: deposit, colors, paint order.",
    );
    expect(h?.factors.find((f) => f.key === "deposit_paid")?.status).toBe("fail");
    const cleared = computeJobHealth(
      {
        ...input,
        depositCleared: true,
        onboarding: { required: 10, cleared: 10, open: [] },
      },
      now,
    );
    expect(cleared?.factors.find((f) => f.key === "deposit_paid")?.status).toBe("pass");
    expect(cleared?.factors.find((f) => f.key === "onboarding_cleared")?.status).toBe("pass");
    const many = computeJobHealth(
      { ...input, onboarding: { required: 9, cleared: 4, open: ["a", "b", "c", "d", "e"] } },
      now,
    );
    expect(many?.factors.find((f) => f.key === "onboarding_cleared")?.recommendation).toMatch(
      /Still open: a, b, c, d…$/,
    );
    const noList = computeJobHealth({ ...input, onboarding: null }, now);
    expect(noList?.factors.some((f) => f.key === "onboarding_cleared")).toBe(false);
  });

  it("photos: before and progress while in progress, after from the final walkthrough", () => {
    const start = {
      ...base,
      contractSignedAt: "2026-10-01T00:00:00Z",
      depositPaidAt: "2026-10-02T00:00:00Z",
    };
    const inProgress = computeJobHealth(
      { ...start, stage: "in_progress", photos: { before: 0, progress: 0, after: 0 } },
      now,
    );
    expect(inProgress?.factors.find((f) => f.key === "photos")).toMatchObject({
      status: "fail",
      recommendation: "No before or progress photos yet. Add them in Photos.",
      action: "upload_photos",
    });
    const finalWalk = computeJobHealth(
      { ...start, stage: "final_walkthrough", photos: { before: 2, progress: 0, after: 0 } },
      now,
    );
    expect(finalWalk?.factors.find((f) => f.key === "photos")?.recommendation).toBe(
      "No after photos yet. Add them in Photos.",
    );
    const ok = computeJobHealth(
      { ...start, stage: "final_walkthrough", photos: { before: 2, progress: 0, after: 1 } },
      now,
    );
    expect(ok?.factors.find((f) => f.key === "photos")?.status).toBe("pass");
    const unknown = computeJobHealth({ ...start, stage: "in_progress" }, now);
    expect(unknown?.factors.some((f) => f.key === "photos")).toBe(false);
  });

  it("a passed promised start date without a start fails", () => {
    const h = computeJobHealth(
      {
        ...base,
        stage: "scheduled",
        contractSignedAt: "2026-10-01T00:00:00Z",
        depositPaidAt: "2026-10-02T00:00:00Z",
        promisedStartDate: "2026-10-25",
      },
      now,
    );
    expect(h?.factors.find((f) => f.key === "start_on_track")?.status).toBe("fail");
  });

  it("closed jobs have no health score", () => {
    expect(computeJobHealth({ ...base, stage: "closed_won" }, now)).toBeNull();
  });

  it("labels", () => {
    expect(healthLabel(90)).toBe("Healthy");
    expect(healthLabel(70)).toBe("Needs attention");
    expect(healthLabel(40)).toBe("At risk");
    expect(healthLabel(null)).toBe("—");
  });
});
