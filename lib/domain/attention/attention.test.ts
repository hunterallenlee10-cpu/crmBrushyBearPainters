import { describe, expect, it } from "vitest";
import type { BusinessHours } from "@/lib/domain/company-settings";
import {
  evaluateAttention,
  urgencyScore,
  type AttentionSettings,
  type AttentionSnapshot,
  type SnapshotJob,
} from "./rules";
import { planAttentionSync, type ExistingItem } from "./sync";

const hours: BusinessHours = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
  sat: { by_appointment: true },
  sun: null,
};

const settings: AttentionSettings = {
  businessHours: hours,
  textBackSlaMinutes: 10,
  estimateSlaHours: 24,
  estimateSlaWarnHours: 20,
  exteriorSeasonStart: "06-01",
  exteriorSeasonEnd: "09-30",
  rules: {},
};

const empty: AttentionSnapshot = { leads: [], walkthroughs: [], jobs: [], approvals: [] };
// Monday 2026-10-26, 10:00 Pacific (PDT, UTC-7).
const now = new Date("2026-10-26T17:00:00Z");

const job = (over: Partial<SnapshotJob>): SnapshotJob => ({
  id: "j1",
  name: "Smith – Kirkland – Exterior",
  jobNumber: "BB-2026-0001",
  stage: "walkthrough_scheduled",
  stageEnteredAt: "2026-10-26T15:00:00Z",
  ownerId: "est",
  pointOfContactId: "poc",
  workTypes: ["interior"],
  promisedStartDate: null,
  actualStartDate: null,
  walkthroughCompletedAt: null,
  estimateSentAt: null,
  estimateAcceptedAt: null,
  depositPaidAt: null,
  onTimeGuaranteeStatus: "n/a",
  ...over,
});

const keys = (snapshot: AttentionSnapshot, s = settings, at = now) =>
  evaluateAttention(snapshot, s, at).map((i) => `${i.dedupeKey}|${i.priority}`);

describe("untouched new lead", () => {
  const lead = {
    id: "l1",
    name: "Jane Smith",
    status: "new",
    ownerId: "est",
    firstContactedAt: null,
    lastActivityAt: "2026-10-26T16:45:00Z",
  };

  it("opens after 10 business minutes with no human touch", () => {
    expect(keys({ ...empty, leads: [{ ...lead, createdAt: "2026-10-26T16:55:00Z" }] })).toEqual([]);
    expect(keys({ ...empty, leads: [{ ...lead, createdAt: "2026-10-26T16:45:00Z" }] })).toEqual([
      "untouched_lead:l1|critical",
    ]);
  });

  it("counts business minutes only (a Sunday-night lead isn't late on Monday at 8:05)", () => {
    const monday805 = new Date("2026-10-26T15:05:00Z");
    expect(
      keys(
        { ...empty, leads: [{ ...lead, createdAt: "2026-10-26T05:00:00Z" }] },
        settings,
        monday805,
      ),
    ).toEqual([]);
  });

  it("clears once a person contacts them", () => {
    expect(
      keys({
        ...empty,
        leads: [
          { ...lead, createdAt: "2026-10-26T16:00:00Z", firstContactedAt: "2026-10-26T16:30:00Z" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("aging lead", () => {
  const lead = (lastActivityAt: string) => ({
    id: "l2",
    name: "Bo",
    status: "contacted",
    ownerId: "est",
    createdAt: "2026-09-01T17:00:00Z",
    firstContactedAt: "2026-09-01T17:05:00Z",
    lastActivityAt,
  });

  it("medium at 3 days, high at 7, says 14+ after two weeks", () => {
    expect(keys({ ...empty, leads: [lead("2026-10-24T17:00:00Z")] })).toEqual([]);
    expect(keys({ ...empty, leads: [lead("2026-10-23T17:00:00Z")] })).toEqual([
      "aging_lead:l2|medium",
    ]);
    expect(keys({ ...empty, leads: [lead("2026-10-19T17:00:00Z")] })).toEqual([
      "aging_lead:l2|high",
    ]);
    const stale = evaluateAttention(
      { ...empty, leads: [lead("2026-10-01T17:00:00Z")] },
      settings,
      now,
    );
    expect(stale[0]?.title).toMatch(/^14\+ days/);
  });

  it("respects edited thresholds and disabled rules", () => {
    const custom: AttentionSettings = {
      ...settings,
      rules: {
        aging_lead: { enabled: true, thresholds: { medium_days: 1, high_days: 2, stale_days: 5 } },
      },
    };
    expect(keys({ ...empty, leads: [lead("2026-10-24T17:00:00Z")] }, custom)).toEqual([
      "aging_lead:l2|high",
    ]);
    const off: AttentionSettings = {
      ...settings,
      rules: { aging_lead: { enabled: false, thresholds: {} } },
    };
    expect(keys({ ...empty, leads: [lead("2026-10-01T17:00:00Z")] }, off)).toEqual([]);
  });
});

describe("walkthrough unconfirmed", () => {
  const w = {
    id: "a1",
    startsAt: "2026-10-27T17:00:00Z", // Tuesday 10:00
    status: "scheduled",
    subjectType: "job" as const,
    subjectId: "j1",
    subjectName: "Smith",
    ownerId: "est",
  };

  it("opens at 5 pm the day before and stays until it's confirmed", () => {
    expect(keys({ ...empty, walkthroughs: [w] })).toEqual([]); // Monday 10:00
    const monday5pm = new Date("2026-10-27T00:00:00Z");
    expect(keys({ ...empty, walkthroughs: [w] }, settings, monday5pm)).toEqual([
      "walkthrough_unconfirmed:a1|high",
    ]);
    expect(
      keys({ ...empty, walkthroughs: [{ ...w, status: "confirmed" }] }, settings, monday5pm),
    ).toEqual([]);
  });
});

describe("job rules", () => {
  it("estimate SLA warns at 20 h and breaches at 24 h", () => {
    const at = (h: number) =>
      keys({
        ...empty,
        jobs: [
          job({
            stage: "walkthrough_complete",
            walkthroughCompletedAt: new Date(now.getTime() - h * 3_600_000).toISOString(),
          }),
        ],
      });
    expect(at(19)).toEqual([]);
    expect(at(21)).toEqual(["estimate_sla:j1|high"]);
    expect(at(25)).toEqual(["estimate_sla:j1|critical"]);
  });

  it("sold without a deposit after 3 days", () => {
    const sold = job({ stage: "sold", estimateAcceptedAt: "2026-10-22T17:00:00Z" });
    expect(keys({ ...empty, jobs: [sold] })).toEqual(["sold_no_deposit:j1|high"]);
    expect(keys({ ...empty, jobs: [{ ...sold, depositPaidAt: "2026-10-23T00:00:00Z" }] })).toEqual(
      [],
    );
  });

  it("onboarding stalled after 7 days", () => {
    expect(
      keys({
        ...empty,
        jobs: [
          job({ stage: "onboarding", stageEnteredAt: "2026-10-18T17:00:00Z", depositPaidAt: "x" }),
        ],
      }),
    ).toEqual(["onboarding_stalled:j1|medium"]);
  });

  it("ready-not-scheduled is season-aware for exteriors", () => {
    const ready = job({
      stage: "ready_to_schedule",
      stageEnteredAt: "2026-10-15T17:00:00Z",
      depositPaidAt: "x",
    });
    expect(keys({ ...empty, jobs: [ready] })).toEqual(["ready_not_scheduled:j1|medium"]);
    expect(keys({ ...empty, jobs: [{ ...ready, workTypes: ["exterior"] }] })).toEqual([]); // October
    const july = new Date("2026-07-20T17:00:00Z");
    expect(
      keys(
        {
          ...empty,
          jobs: [{ ...ready, stageEnteredAt: "2026-07-10T17:00:00Z", workTypes: ["exterior"] }],
        },
        settings,
        july,
      ),
    ).toEqual(["ready_not_scheduled:j1|medium"]);
  });

  it("start date missed unless weather; the key changes when the date moves", () => {
    const late = job({ stage: "scheduled", promisedStartDate: "2026-10-23", depositPaidAt: "x" });
    expect(keys({ ...empty, jobs: [late] })).toEqual(["start_date_missed:j1:2026-10-23|critical"]);
    expect(
      keys({ ...empty, jobs: [{ ...late, onTimeGuaranteeStatus: "missed_weather" }] }),
    ).toEqual([]);
    expect(keys({ ...empty, jobs: [{ ...late, actualStartDate: "2026-10-23" }] })).toEqual([]);
  });

  it("closed jobs raise nothing", () => {
    expect(
      keys({ ...empty, jobs: [job({ stage: "closed_lost", promisedStartDate: "2026-01-01" })] }),
    ).toEqual([]);
  });
});

describe("approvals", () => {
  it("open after 2 hours waiting", () => {
    const a = { id: "r1", jobId: "j1", jobName: "Smith", requesterName: "Ella" };
    expect(keys({ ...empty, approvals: [{ ...a, requestedAt: "2026-10-26T16:00:00Z" }] })).toEqual(
      [],
    );
    expect(keys({ ...empty, approvals: [{ ...a, requestedAt: "2026-10-26T14:00:00Z" }] })).toEqual([
      "approval_pending:r1|high",
    ]);
  });
});

describe("sync plan", () => {
  const desired = evaluateAttention(
    {
      ...empty,
      jobs: [
        job({
          stage: "walkthrough_complete",
          walkthroughCompletedAt: new Date(now.getTime() - 25 * 3_600_000).toISOString(),
        }),
      ],
    },
    settings,
    now,
  );
  const row = (over: Partial<ExistingItem>): ExistingItem => ({
    id: "i1",
    dedupeKey: "estimate_sla:j1",
    status: "pending",
    priority: "critical",
    title: desired[0]!.title,
    detail: desired[0]!.detail,
    dueAt: desired[0]!.dueAt,
    ownerId: "est",
    snoozedUntil: null,
    resolution: null,
    conditionClearedAt: null,
    ...over,
  });

  it("opens new items", () => {
    expect(planAttentionSync(desired, [], now).inserts).toHaveLength(1);
  });

  it("leaves unchanged items alone (database timestamp format doesn't count as a change)", () => {
    const pgDue = desired[0]!.dueAt!.replace(".000Z", "+00:00");
    const plan = planAttentionSync(desired, [row({ dueAt: pgDue })], now);
    expect(plan).toMatchObject({ inserts: [], updates: [], seen: ["i1"], autoResolve: [] });
  });

  it("escalates in place", () => {
    const plan = planAttentionSync(
      desired,
      [row({ priority: "high", title: "Estimate due soon" })],
      now,
    );
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: "i1", priority: "critical", unsnooze: false }),
    ]);
  });

  it("auto-resolves when the problem clears", () => {
    expect(planAttentionSync([], [row({})], now).autoResolve).toEqual(["i1"]);
  });

  it("brings snoozed items back when the snooze ends", () => {
    const past = planAttentionSync(
      desired,
      [row({ status: "snoozed", snoozedUntil: "2026-10-26T16:00:00Z" })],
      now,
    );
    expect(past.updates[0]?.unsnooze).toBe(true);
    const future = planAttentionSync(
      desired,
      [row({ status: "snoozed", snoozedUntil: "2026-10-27T16:00:00Z" })],
      now,
    );
    expect(future.seen).toEqual(["i1"]);
  });

  it("doesn't reopen what a person resolved until the problem clears", () => {
    const manual = row({ status: "resolved", resolution: "manual" });
    expect(planAttentionSync(desired, [manual], now)).toMatchObject({
      inserts: [],
      markCleared: [],
    });
    expect(planAttentionSync([], [manual], now).markCleared).toEqual(["i1"]);
    // After it cleared, a new occurrence opens a new item.
    expect(
      planAttentionSync(desired, [{ ...manual, conditionClearedAt: "2026-10-26T12:00:00Z" }], now)
        .inserts,
    ).toHaveLength(1);
  });
});

describe("urgency", () => {
  it("orders by priority, then how overdue", () => {
    const opened = "2026-10-26T12:00:00Z";
    const crit = urgencyScore({ priority: "critical", dueAt: null, openedAt: opened }, now);
    const highOverdue = urgencyScore(
      { priority: "high", dueAt: "2026-10-25T17:00:00Z", openedAt: opened },
      now,
    );
    const highLater = urgencyScore(
      { priority: "high", dueAt: "2026-10-28T17:00:00Z", openedAt: opened },
      now,
    );
    expect(crit).toBeGreaterThan(highOverdue);
    expect(highOverdue).toBeGreaterThan(highLater);
  });
});

describe("estimate rules (Phase 4)", () => {
  const est = {
    id: "e1",
    number: "EST-2026-0001",
    jobId: "j1",
    jobName: "Smith",
    jobNumber: "BB-2026-0001",
    status: "sent",
    sentAt: "2026-10-22T17:00:00Z",
    viewedAt: null,
    expiresAt: "2026-11-21T17:00:00Z",
    ownerId: "poc",
  };

  it("flags an estimate sent 3+ days ago that the customer hasn't opened", () => {
    expect(keys({ ...empty, estimates: [est] })).toEqual(["estimate_awaiting_reply:e1|medium"]);
    const item = evaluateAttention({ ...empty, estimates: [est] }, settings, now)[0];
    expect(item?.detail).toMatch(/sent 4 days ago/);
    expect(keys({ ...empty, estimates: [{ ...est, sentAt: "2026-10-25T17:00:00Z" }] })).toEqual([]);
    expect(
      keys({ ...empty, estimates: [{ ...est, status: "viewed", viewedAt: now.toISOString() }] }),
    ).toEqual([]);
  });

  it("flags an estimate expiring within 5 days", () => {
    const soon = { ...est, sentAt: "2026-10-25T17:00:00Z", expiresAt: "2026-10-29T18:00:00Z" };
    expect(keys({ ...empty, estimates: [soon] })).toEqual(["estimate_expiring:e1|medium"]);
    const today = {
      ...soon,
      status: "viewed",
      viewedAt: soon.sentAt,
      expiresAt: "2026-10-26T20:00:00Z",
    };
    expect(evaluateAttention({ ...empty, estimates: [today] }, settings, now)[0]?.detail).toMatch(
      /expires today/,
    );
    expect(keys({ ...empty, estimates: [{ ...soon, expiresAt: "2026-10-20T00:00:00Z" }] })).toEqual(
      [],
    );
    expect(keys({ ...empty, estimates: [{ ...soon, expiresAt: null }] })).toEqual([]);
    expect(keys({ ...empty, estimates: [{ ...soon, status: "accepted" }] })).toEqual([]);
  });

  it("respects thresholds and switches", () => {
    const s = {
      ...settings,
      rules: {
        estimate_awaiting_reply: { enabled: false, thresholds: {} },
        estimate_expiring: { enabled: true, thresholds: { days: 30 } },
      },
    };
    expect(keys({ ...empty, estimates: [est] }, s)).toEqual(["estimate_expiring:e1|medium"]);
  });

  it("says which kind of approval is waiting", () => {
    const approval = {
      id: "a1",
      type: "estimate_discount",
      jobId: "j1",
      jobName: "Smith",
      requestedAt: "2026-10-26T12:00:00Z",
      requesterName: "Eli",
    };
    expect(
      evaluateAttention({ ...empty, approvals: [approval] }, settings, now)[0]?.detail,
    ).toMatch(/discount over their limit/);
  });
});
