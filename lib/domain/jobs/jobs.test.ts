import { describe, expect, it } from "vitest";
import { JOB_STAGES, type JobStageId } from "@/lib/domain/stages";
import { EXIT_GATES, checkTransition, exitGate, nextStage, type GateContext } from "./gates";
import { computeJobHealth, healthLabel, type HealthInput } from "./health";

const open: GateContext = { walkthroughMeasured: false, blockingHolds: [] };
const measured: GateContext = { walkthroughMeasured: true, blockingHolds: [] };

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

  it("gates whose data comes later stay closed and say which phase", () => {
    const g = exitGate("walkthrough_complete", measured);
    expect(g.passes).toBe(false);
    expect(g.arrivesInPhase).toBe(4);
    expect(g.reasons[0]).toMatch(/Phase 4.*override/);
    for (const s of ["estimate_sent", "sold", "onboarding", "scheduled", "invoiced"] as const) {
      expect(exitGate(s, measured).passes).toBe(false);
    }
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
    const held: GateContext = { walkthroughMeasured: true, blockingHolds: ["HOA"] };
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

  it("checks from later phases are shown but never lower the score", () => {
    const h = computeJobHealth(
      {
        ...base,
        stage: "onboarding",
        contractSignedAt: "2026-10-20T00:00:00Z",
        depositPaidAt: "2026-10-21T00:00:00Z",
      },
      now,
    );
    const later = h?.factors.find((f) => f.key === "onboarding_cleared");
    expect(later).toMatchObject({ status: "unavailable", arrivesInPhase: 5 });
    expect(h?.score).toBe(100);
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
