import { describe, expect, it } from "vitest";
import {
  JOB_STAGES,
  MILESTONES,
  TERMINAL_STAGES,
  getStage,
  isJobStageId,
  milestoneForStage,
} from "@/lib/domain/stages";

describe("job stages (SPEC §6.2)", () => {
  it("has the 12 pipeline stages plus Closed Won and Closed Lost, in order", () => {
    expect(JOB_STAGES.map((s) => s.label)).toEqual([
      "Walkthrough Scheduled",
      "Walkthrough Complete",
      "Estimate Sent",
      "Sold",
      "Onboarding",
      "Ready to Schedule",
      "Scheduled",
      "In Progress",
      "Final Walkthrough",
      "Completed",
      "Invoiced",
      "Paid in Full",
      "Closed Won",
      "Closed Lost",
    ]);
    expect(JOB_STAGES.map((s) => s.order)).toEqual(JOB_STAGES.map((_, i) => i + 1));
  });

  it("ids, labels and colors are unique (no ambiguous stage names, SPEC §3.4)", () => {
    for (const field of ["id", "label", "color"] as const) {
      const values = JOB_STAGES.map((s) => s[field].toLowerCase());
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("terminal stages are the two closed stages", () => {
    expect([...TERMINAL_STAGES]).toEqual(["closed_won", "closed_lost"]);
  });

  it("looks up stages and rejects unknown ids", () => {
    expect(getStage("sold").label).toBe("Sold");
    expect(isJobStageId("in_progress")).toBe(true);
    expect(isJobStageId("installed")).toBe(false);
  });
});

describe("milestones stepper (SPEC §6.3)", () => {
  it("is Lead → Estimate → Sold → In Progress → Completed → Closed", () => {
    expect(MILESTONES.map((m) => m.label)).toEqual([
      "Lead",
      "Estimate",
      "Sold",
      "In Progress",
      "Completed",
      "Closed",
    ]);
  });

  it("maps every stage to exactly one milestone, preserving stage order", () => {
    const flattened = MILESTONES.flatMap((m) => [...m.stages]);
    expect(flattened).toEqual(JOB_STAGES.map((s) => s.id));
    expect(milestoneForStage("onboarding").id).toBe("sold");
    expect(milestoneForStage("paid_in_full").id).toBe("completed");
  });
});
