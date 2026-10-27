import { describe, expect, it } from "vitest";
import type { HealthFactor } from "@/lib/domain/jobs/health";
import { formatJobDate, formatMoney } from "@/components/jobs/format";
import { parseDollarInput, promisedStartSchema, releaseAllHoldsSchema } from "./schemas";
import {
  actionRequired,
  holdShortLabel,
  jobScopeAllows,
  milestoneSteps,
  nextHint,
  pacificLocalToUtcIso,
  pacificToUtcIso,
  parseHealthFactors,
  parseSection,
  sectionHref,
  utcToPacificLocal,
} from "./utils";

const ID = "11111111-1111-4111-8111-111111111111";

describe("sections", () => {
  it("defaults to Overview and ignores unknown sections", () => {
    expect(parseSection(undefined, { canAdmin: true })).toBe("overview");
    expect(parseSection("nope", { canAdmin: true })).toBe("overview");
    expect(parseSection(["photos", "x"], { canAdmin: false })).toBe("photos");
  });

  it("only owners can open Admin", () => {
    expect(parseSection("admin", { canAdmin: true })).toBe("admin");
    expect(parseSection("admin", { canAdmin: false })).toBe("overview");
  });

  it("builds section links (Overview has no query)", () => {
    expect(sectionHref(ID, "overview")).toBe(`/jobs/${ID}`);
    expect(sectionHref(ID, "messages", "compose=sms")).toBe(
      `/jobs/${ID}?section=messages&compose=sms`,
    );
    expect(sectionHref(ID, "overview", "result=walkthrough")).toBe(
      `/jobs/${ID}?result=walkthrough`,
    );
  });
});

describe("jobScopeAllows (mirrors app.can_edit_subject)", () => {
  const job = { ownerId: "a", createdBy: "b", teamUserIds: ["c"], territoryId: "t1" };
  it("all scope edits everything; no scope edits nothing", () => {
    expect(jobScopeAllows("all", job, { id: "z", territoryId: null })).toBe(true);
    expect(jobScopeAllows(undefined, job, { id: "a", territoryId: null })).toBe(false);
  });
  it("own scope: owner, creator or anyone on the team", () => {
    expect(jobScopeAllows("own", job, { id: "a", territoryId: null })).toBe(true);
    expect(jobScopeAllows("own", job, { id: "b", territoryId: null })).toBe(true);
    expect(jobScopeAllows("own", job, { id: "c", territoryId: null })).toBe(true);
    expect(jobScopeAllows("own", job, { id: "z", territoryId: "t1" })).toBe(false);
  });
  it("team scope adds the same territory", () => {
    expect(jobScopeAllows("team", job, { id: "z", territoryId: "t1" })).toBe(true);
    expect(jobScopeAllows("team", job, { id: "z", territoryId: "t2" })).toBe(false);
    expect(
      jobScopeAllows("team", { ...job, territoryId: null }, { id: "z", territoryId: null }),
    ).toBe(false);
  });
});

describe("time zones", () => {
  it("Pacific wall clock → UTC across DST", () => {
    expect(pacificToUtcIso("2026-11-10", "09:30")).toBe("2026-11-10T17:30:00.000Z");
    expect(pacificToUtcIso("2026-07-01", "14:00")).toBe("2026-07-01T21:00:00.000Z");
  });
  it("datetime-local round trip", () => {
    expect(pacificLocalToUtcIso("2026-10-20T08:15")).toBe("2026-10-20T15:15:00.000Z");
    expect(utcToPacificLocal("2026-10-20T15:15:00.000Z")).toBe("2026-10-20T08:15");
    expect(pacificLocalToUtcIso("")).toBe("");
    expect(utcToPacificLocal(null)).toBe("");
    expect(utcToPacificLocal("not a date")).toBe("");
  });
  it("calendar dates aren't shifted by the time zone", () => {
    expect(formatJobDate("2026-10-27")).toBe("Oct 27, 2026");
    expect(formatJobDate("2026-10-27T06:00:00.000Z")).toBe("Oct 26, 2026");
    expect(formatJobDate(null)).toBe("—");
  });
});

describe("holds and money", () => {
  it("strips the trailing Hold so the pill doesn't say it twice", () => {
    expect(holdShortLabel("HOA Hold")).toBe("HOA");
    expect(holdShortLabel("Repair Approval Hold")).toBe("Repair Approval");
    expect(holdShortLabel("Hold")).toBe("Hold");
  });
  it("parses dollar input into cents", () => {
    expect(parseDollarInput("12,500")).toBe(1_250_000);
    expect(parseDollarInput("$12,500.5")).toBe(1_250_050);
    expect(parseDollarInput("0.99")).toBe(99);
    expect(parseDollarInput("")).toBeNull();
    expect(parseDollarInput("12.345")).toBe("invalid");
    expect(parseDollarInput("-5")).toBe("invalid");
    expect(parseDollarInput("abc")).toBe("invalid");
    expect(formatMoney(1_250_000)).toBe("$12,500.00");
  });
  it("release-all needs a note; promised start takes a date or empty", () => {
    expect(releaseAllHoldsSchema.safeParse({ job_id: ID, note: "" }).success).toBe(false);
    expect(releaseAllHoldsSchema.safeParse({ job_id: ID, note: "HOA approved" }).success).toBe(
      true,
    );
    expect(promisedStartSchema.parse({ id: ID, value: "" }).value).toBeNull();
    expect(promisedStartSchema.parse({ id: ID, value: "2026-11-02" }).value).toBe("2026-11-02");
    expect(promisedStartSchema.safeParse({ id: ID, value: "11/02/2026" }).success).toBe(false);
  });
});

describe("milestones stepper", () => {
  const dates = {
    leadCreatedAt: null,
    createdAt: "2026-10-01T17:00:00Z",
    estimateSentAt: "2026-10-03T17:00:00Z",
    estimateAcceptedAt: null,
    contractSignedAt: "2026-10-05T17:00:00Z",
    actualStartDate: null,
    completedAt: null,
    closedAt: null,
  };
  it("marks done / current / upcoming and picks dates", () => {
    const steps = milestoneSteps("onboarding", dates);
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(steps[0]?.date).toBe(dates.createdAt); // falls back to the job's creation
    expect(steps[2]?.date).toBe(dates.contractSignedAt);
  });
  it("the first stage highlights Lead; closed jobs highlight Closed", () => {
    expect(milestoneSteps("walkthrough_scheduled", dates)[0]?.state).toBe("current");
    expect(milestoneSteps("closed_lost", dates)[5]?.state).toBe("current");
  });
  it("next hint names the next stage and its requirement", () => {
    expect(nextHint("walkthrough_scheduled")).toMatchObject({
      to: "walkthrough_complete",
      label: "Walkthrough Complete",
    });
    expect(nextHint("walkthrough_complete")?.arrivesInPhase).toBeUndefined();
    expect(nextHint("onboarding")?.arrivesInPhase).toBeUndefined();
    expect(nextHint("ready_to_schedule")?.arrivesInPhase).toBe(6);
    expect(nextHint("closed_won")).toBeNull();
  });
});

describe("health factors and action required", () => {
  it("reads stored factors defensively", () => {
    const parsed = parseHealthFactors([
      {
        key: "poc_assigned",
        label: "POC",
        weight: 10,
        status: "fail",
        action: "assign_poc",
        recommendation: "Assign one.",
      },
      { key: "x", label: "X", weight: 5, status: "unavailable", arrivesInPhase: 6 },
      { key: "bad", label: "Bad", status: "weird" },
      "junk",
      null,
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ action: "assign_poc", recommendation: "Assign one." });
    expect(parsed[1]?.arrivesInPhase).toBe(6);
    expect(parseHealthFactors({})).toEqual([]);
  });

  const now = new Date("2026-10-27T18:00:00Z");
  const fail: HealthFactor = {
    key: "no_overdue_tasks",
    label: "No overdue tasks",
    weight: 15,
    status: "fail",
    recommendation: "1 task is overdue.",
    action: "review_tasks",
  };

  it("lists failed checks, missing appointment, holds and pending approval", () => {
    const items = actionRequired({
      stage: "onboarding",
      factors: [fail],
      appointments: [{ status: "completed", startsAt: "2026-10-20T18:00:00Z" }],
      pendingApproval: { toLabel: "Ready to Schedule" },
      blockingHolds: ["HOA Hold"],
      now,
    });
    expect(items.map((i) => i.key)).toEqual([
      "health:no_overdue_tasks",
      "no_upcoming",
      "holds",
      "approval",
    ]);
    expect(items[0]?.section).toBe("tasks");
  });

  it("an upcoming appointment clears the schedule item; closed jobs need nothing", () => {
    const items = actionRequired({
      stage: "walkthrough_scheduled",
      factors: [],
      appointments: [{ status: "scheduled", startsAt: "2026-10-28T18:00:00Z" }],
      pendingApproval: null,
      blockingHolds: [],
      now,
    });
    expect(items).toEqual([]);
    expect(
      actionRequired({
        stage: "closed_lost",
        factors: [fail],
        appointments: [],
        pendingApproval: null,
        blockingHolds: [],
        now,
      }),
    ).toEqual([]);
  });
});
