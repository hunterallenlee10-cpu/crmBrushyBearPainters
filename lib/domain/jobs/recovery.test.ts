import { describe, expect, it } from "vitest";
import {
  STAGE_MILESTONES,
  daysBetween,
  findRecoveryIssues,
  percentile90,
  stuckJobs,
  type RecoveryFacts,
} from "@/lib/domain/jobs/recovery";
import { MILESTONE_FIELDS } from "@/lib/domain/jobs/constants";

const NOW = new Date("2026-10-27T12:00:00Z");
const base: RecoveryFacts = {
  jobId: "j",
  jobNumber: "BB-2026-0001",
  name: "Alder – Kirkland – Interior",
  stage: "sold",
  status: "open",
  stageEnteredAt: "2026-10-25T12:00:00Z",
  lastFromStage: "estimate_sent",
  lastOverride: false,
  gatePasses: true,
  blockingHolds: 0,
  milestones: { walkthrough_completed_at: "x", estimate_sent_at: "x", estimate_accepted_at: "x" },
  hasPublishedSchedule: false,
  hasAcceptedEstimate: true,
};

describe("job recovery", () => {
  it("a healthy job has no issues", () => {
    const [row] = findRecoveryIssues([base], NOW);
    expect(row!.issues).toEqual([]);
    expect(row!.daysInStage).toBe(2);
    expect(stuckJobs([row!])).toEqual([]);
  });

  it("flags a gate that no longer passes, with a move-back fix", () => {
    const [row] = findRecoveryIssues([{ ...base, gatePasses: false }], NOW);
    expect(row!.issues[0]).toMatchObject({
      kind: "gate_no_longer_passes",
      severity: "high",
      fixes: [{ kind: "move_stage", to: "estimate_sent" }, { kind: "open_job" }],
    });
  });

  it("flags missing milestones for stages already passed", () => {
    const [row] = findRecoveryIssues(
      [{ ...base, stage: "invoiced", milestones: {}, hasPublishedSchedule: true }],
      NOW,
    );
    const fields = row!.issues.filter((i) => i.kind === "missing_milestone").map((i) => i.fixes[0]);
    expect(fields.map((f) => (f && f.kind === "set_milestone" ? f.field : null))).toEqual([
      "walkthrough_completed_at",
      "estimate_sent_at",
      "estimate_accepted_at",
      "ready_to_schedule_at",
      "scheduled_at",
      "completed_at",
      "final_invoiced_at",
    ]);
  });

  it("flags scheduled jobs without a schedule, holds that block a scheduled job, sold without estimate", () => {
    const [row] = findRecoveryIssues(
      [
        {
          ...base,
          stage: "scheduled",
          blockingHolds: 1,
          hasAcceptedEstimate: false,
          milestones: { ...base.milestones, ready_to_schedule_at: "x", scheduled_at: "x" },
        },
      ],
      NOW,
    );
    expect(row!.issues.map((i) => i.kind).sort()).toEqual([
      "hold_but_scheduled",
      "scheduled_without_schedule",
      "sold_without_estimate",
    ]);
  });

  it("flags long stays past the threshold and the company's own 90th percentile", () => {
    const old = { ...base, jobId: "old", stageEnteredAt: "2026-09-01T12:00:00Z" };
    expect(findRecoveryIssues([old], NOW)[0]!.issues.map((i) => i.kind)).toEqual([
      "stage_too_long",
    ]);
    // With 10+ jobs where most are as old, the percentile keeps it quiet.
    const crowd = Array.from({ length: 12 }, (_, i) => ({ ...old, jobId: `c${i}` }));
    expect(findRecoveryIssues(crowd, NOW).every((r) => r.issues.length === 0)).toBe(true);
  });

  it("orders stuck jobs by severity then age", () => {
    const rows = findRecoveryIssues(
      [
        { ...base, jobId: "a", stageEnteredAt: "2026-09-01T12:00:00Z" },
        { ...base, jobId: "b", gatePasses: false },
      ],
      NOW,
    );
    expect(stuckJobs(rows).map((r) => r.jobId)).toEqual(["b", "a"]);
  });

  it("helpers", () => {
    expect(percentile90([])).toBeNull();
    expect(percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(daysBetween(null, NOW)).toBeNull();
    expect(daysBetween("garbage", NOW)).toBeNull();
    const fields = new Set<string>(MILESTONE_FIELDS.map(([f]) => f));
    for (const m of STAGE_MILESTONES) expect(fields.has(m.field)).toBe(true);
  });
});
