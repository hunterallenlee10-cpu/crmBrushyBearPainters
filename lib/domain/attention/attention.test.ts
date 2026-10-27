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

  it("sold without a deposit reads the deposit invoice (Phase 7)", () => {
    const sold = job({ stage: "onboarding", estimateAcceptedAt: "2026-10-22T17:00:00Z" });
    const partly = evaluateAttention(
      {
        ...empty,
        jobs: [
          {
            ...sold,
            deposit: { number: "INV-2026-0001", totalCents: 300_000, collectedCents: 100_000 },
            depositRequired: true,
          },
        ],
      },
      settings,
      now,
    );
    expect(partly.map((i) => i.detail)).toEqual([
      "Sold 4 days ago. Deposit invoice INV-2026-0001 is $3,000.00, $1,000.00 paid so far.",
    ]);
    // Paid in full (even before the milestone is stamped), or a 0% deposit: nothing to chase.
    expect(
      keys({
        ...empty,
        jobs: [
          {
            ...sold,
            deposit: { number: "INV-1", totalCents: 300_000, collectedCents: 300_000 },
            depositRequired: true,
          },
        ],
      }),
    ).toEqual([]);
    expect(keys({ ...empty, jobs: [{ ...sold, deposit: null, depositRequired: false }] })).toEqual(
      [],
    );
  });

  it("overdue invoices open at 7 days (medium) and escalate at 30 (high)", () => {
    const inv = {
      id: "i1",
      number: "INV-2026-0002",
      jobId: "j1",
      jobName: "Smith – Kirkland – Exterior",
      jobNumber: "BB-2026-0001",
      balanceCents: 225_000,
      daysPastDue: 6,
      ownerId: "poc",
    };
    expect(keys({ ...empty, invoices: [inv] })).toEqual([]);
    expect(keys({ ...empty, invoices: [{ ...inv, daysPastDue: 7 }] })).toEqual([
      "overdue_invoice:i1|medium",
    ]);
    const late = evaluateAttention(
      { ...empty, invoices: [{ ...inv, daysPastDue: 31 }] },
      settings,
      now,
    );
    expect(late[0]).toMatchObject({
      priority: "high",
      category: "financial",
      subjectType: "job",
      subjectId: "j1",
      ownerId: "poc",
      title: "Overdue invoice: Smith – Kirkland – Exterior (INV-2026-0002)",
      detail: "$2,250.00 is 31 days past due. Call the customer or record the payment.",
    });
    expect(keys({ ...empty, invoices: [{ ...inv, daysPastDue: 40, balanceCents: 0 }] })).toEqual(
      [],
    );
    const custom = {
      ...settings,
      rules: { overdue_invoice: { enabled: true, thresholds: { medium_days: 3, high_days: 10 } } },
    };
    expect(keys({ ...empty, invoices: [{ ...inv, daysPastDue: 10 }] }, custom)).toEqual([
      "overdue_invoice:i1|high",
    ]);
    const off = { ...settings, rules: { overdue_invoice: { enabled: false, thresholds: {} } } };
    expect(keys({ ...empty, invoices: [{ ...inv, daysPastDue: 40 }] }, off)).toEqual([]);
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

  it("onboarding stalled names what's open, and stays quiet when everything is cleared", () => {
    const stalled = job({
      stage: "onboarding",
      stageEnteredAt: "2026-10-18T17:00:00Z",
      depositPaidAt: "x",
      onboardingOpen: ["deposit", "colors"],
      blockingHolds: ["HOA Hold"],
    });
    const [item] = evaluateAttention({ ...empty, jobs: [stalled] }, settings, now);
    expect(item?.detail).toBe(
      "8 days in Onboarding. Still open: deposit, colors. On hold: HOA Hold.",
    );
    const many = job({
      stage: "onboarding",
      stageEnteredAt: "2026-10-18T17:00:00Z",
      depositPaidAt: "x",
      onboardingOpen: ["a", "b", "c", "d", "e", "f"],
    });
    expect(evaluateAttention({ ...empty, jobs: [many] }, settings, now)[0]?.detail).toMatch(
      /a, b, c, d, e…$/,
    );
    const none = job({
      stage: "onboarding",
      stageEnteredAt: "2026-10-18T17:00:00Z",
      depositPaidAt: "x",
      onboardingOpen: null,
    });
    expect(evaluateAttention({ ...empty, jobs: [none] }, settings, now)[0]?.detail).toMatch(
      /No onboarding checklist yet/,
    );
    const cleared = { ...stalled, onboardingOpen: [], blockingHolds: [] };
    expect(keys({ ...empty, jobs: [cleared] })).toEqual([]);
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

describe("production rules (Phase 6)", () => {
  const scheduled = (over: Partial<SnapshotJob>) =>
    job({ stage: "scheduled", depositPaidAt: "2026-10-01T00:00:00Z", ...over });

  it("missing crew: starts within 5 days with no crew", () => {
    expect(
      keys({ ...empty, jobs: [scheduled({ crewId: null, startDate: "2026-10-31" })] }),
    ).toEqual(["missing_crew:j1|high"]);
    expect(
      keys({ ...empty, jobs: [scheduled({ crewId: null, startDate: "2026-11-02" })] }),
    ).toEqual([]);
    expect(
      keys({ ...empty, jobs: [scheduled({ crewId: "c1", startDate: "2026-10-28" })] }),
    ).toEqual([]);
    const item = evaluateAttention(
      { ...empty, jobs: [scheduled({ crewId: null, startDate: "2026-10-27" })] },
      settings,
      now,
    )[0];
    expect(item?.detail).toBe("Starts tomorrow and no crew is assigned.");
  });

  it("paint not ordered: starts within 3 days and no placed order", () => {
    expect(
      keys({
        ...empty,
        jobs: [scheduled({ crewId: "c1", startDate: "2026-10-28", paintOrdered: false })],
      }),
    ).toEqual(["paint_not_ordered:j1|high"]);
    expect(
      keys({
        ...empty,
        jobs: [scheduled({ crewId: "c1", startDate: "2026-10-28", paintOrdered: true })],
      }),
    ).toEqual([]);
    const none = evaluateAttention(
      {
        ...empty,
        jobs: [scheduled({ crewId: "c1", startDate: "2026-10-26", paintOrdered: null })],
      },
      settings,
      now,
    )[0];
    expect(none?.detail).toBe("Starts today and there's no paint order.");
  });

  it("missed daily update: raised at 7:00 pm Pacific on a production day with no log", () => {
    const j = scheduled({
      stage: "in_progress",
      crewId: "c1",
      crewLeadId: "lead",
      productionDays: ["2026-10-26"],
      logDates: [],
    });
    // 6:59 pm and 7:00 pm Pacific on Monday Oct 26 (PDT, UTC−7).
    expect(keys({ ...empty, jobs: [j] }, settings, new Date("2026-10-27T01:59:00Z"))).toEqual([]);
    const at7 = evaluateAttention(
      { ...empty, jobs: [j] },
      settings,
      new Date("2026-10-27T02:00:00Z"),
    );
    expect(at7.map((i) => `${i.dedupeKey}|${i.priority}|${i.ownerId}`)).toEqual([
      "missed_daily_update:j1:2026-10-26|high|lead",
    ]);
    expect(at7[0]?.title).toBe("No daily update today: Smith – Kirkland – Exterior (BB-2026-0001)");
    // A log for the day clears it; a rain day doesn't count.
    expect(
      keys(
        { ...empty, jobs: [{ ...j, logDates: ["2026-10-26"] }] },
        settings,
        new Date("2026-10-27T02:00:00Z"),
      ),
    ).toEqual([]);
    expect(
      keys(
        { ...empty, jobs: [{ ...j, rainDelayDates: ["2026-10-26"] }] },
        settings,
        new Date("2026-10-27T02:00:00Z"),
      ),
    ).toEqual([]);
    // The cutoff is editable.
    const at6 = {
      ...settings,
      rules: { missed_daily_update: { enabled: true, thresholds: { cutoff_hour: 18 } } },
    };
    expect(keys({ ...empty, jobs: [j] }, at6, new Date("2026-10-27T01:30:00Z"))).toEqual([
      "missed_daily_update:j1:2026-10-26|high",
    ]);
  });

  it("start date missed uses the guarantee date and skips rain slips", () => {
    const late = scheduled({ promisedStartDate: "2026-10-25", guaranteeDate: "2026-10-22" });
    const withCredit = { ...settings, onTimeCreditCents: 25_000 };
    const item = evaluateAttention({ ...empty, jobs: [late] }, withCredit, now)[0];
    expect(item?.dedupeKey).toBe("start_date_missed:j1:2026-10-22");
    expect(item?.detail).toContain(
      "An On-Time Guarantee credit of $250.00 is drafted for owner approval.",
    );
    expect(keys({ ...empty, jobs: [{ ...late, rainDelayDates: ["2026-10-22"] }] })).toEqual([]);
  });

  it("punch list open: Final Walkthrough 3+ days with open items", () => {
    const fw = job({
      stage: "final_walkthrough",
      stageEnteredAt: "2026-10-22T17:00:00Z",
      depositPaidAt: "x",
      punchOpen: 2,
    });
    expect(keys({ ...empty, jobs: [fw] })).toEqual(["punch_list_open:j1|medium"]);
    expect(keys({ ...empty, jobs: [{ ...fw, punchOpen: 0 }] })).toEqual([]);
    expect(keys({ ...empty, jobs: [{ ...fw, stageEnteredAt: "2026-10-25T17:00:00Z" }] })).toEqual(
      [],
    );
  });

  it("sub compliance expiring: one item per subcontractor, high once something expired", () => {
    const subs = [
      {
        id: "s1",
        name: "Cedar Brush LLC",
        issues: [
          {
            level: "expiring" as const,
            message: "Insurance (COI) expires Fri, Nov 6.",
            expiresOn: "2026-11-06",
          },
        ],
      },
      {
        id: "s2",
        name: "Ridge Painting",
        issues: [{ level: "expired" as const, message: "No W-9 on file.", expiresOn: null }],
      },
      { id: "s3", name: "Fine Co", issues: [] },
    ];
    const items = evaluateAttention({ ...empty, subcontractors: subs }, settings, now);
    expect(items.map((i) => `${i.dedupeKey}|${i.priority}|${i.subjectType}`)).toEqual([
      "sub_compliance_expiring:s1|medium|subcontractor",
      "sub_compliance_expiring:s2|high|subcontractor",
    ]);
  });

  it("weather risk stays dormant until weather is connected", () => {
    const ext = scheduled({
      workTypes: ["exterior"],
      crewId: "c1",
      paintOrdered: true,
      startDate: "2026-11-02",
      weatherRiskDays: [{ date: "2026-11-02", precipProbability: 70 }],
    });
    expect(keys({ ...empty, jobs: [ext] })).toEqual([]);
    expect(keys({ ...empty, jobs: [ext] }, { ...settings, weatherConnected: true })).toEqual([
      "weather_risk:j1:2026-11-02|high",
    ]);
  });
});

describe("communication & customer rules (Phase 8)", () => {
  const thread = {
    id: "t1",
    subjectType: "job" as const,
    subjectId: "j1",
    subjectName: "Smith – Kirkland – Exterior",
    ownerId: "poc",
    preview: "Can you come Tuesday instead?",
  };

  it("unread customer message: high after 30 business minutes", () => {
    expect(
      keys({ ...empty, threads: [{ ...thread, lastInboundAt: "2026-10-26T16:45:00Z" }] }),
    ).toEqual([]);
    expect(
      keys({ ...empty, threads: [{ ...thread, lastInboundAt: "2026-10-26T16:25:00Z" }] }),
    ).toEqual(["unread_message:t1|high"]);
  });

  it("unread customer message counts business minutes (a Sunday text isn't late at 8:10 Monday)", () => {
    expect(
      keys(
        { ...empty, threads: [{ ...thread, lastInboundAt: "2026-10-25T20:00:00Z" }] },
        settings,
        new Date("2026-10-26T15:10:00Z"),
      ),
    ).toEqual([]);
  });

  it("unread threshold is editable", () => {
    const s = {
      ...settings,
      rules: { unread_message: { enabled: true, thresholds: { minutes: 5 } } },
    };
    expect(
      keys({ ...empty, threads: [{ ...thread, lastInboundAt: "2026-10-26T16:50:00Z" }] }, s),
    ).toEqual(["unread_message:t1|high"]);
  });

  const kase = {
    id: "k1",
    number: "CASE-2026-0001",
    title: "Peeling on the back door",
    type: "warranty",
    priority: "normal" as const,
    ownerId: "poc",
    customerName: "Smith Residence",
  };

  it("warranty request: high until the SLA, then critical; urgent is critical", () => {
    const items = evaluateAttention(
      { ...empty, cases: [{ ...kase, slaDueAt: "2026-10-28T17:00:00Z" }] },
      settings,
      now,
    );
    expect(items.map((i) => `${i.dedupeKey}|${i.priority}`)).toEqual(["warranty_request:k1|high"]);
    expect(items[0]?.subjectType).toBe("case");
    expect(items[0]?.title).toBe("Warranty request: Peeling on the back door (Smith Residence)");
    expect(keys({ ...empty, cases: [{ ...kase, slaDueAt: "2026-10-26T16:00:00Z" }] })).toEqual([
      "warranty_request:k1|critical",
    ]);
    expect(
      keys({
        ...empty,
        cases: [{ ...kase, priority: "urgent", slaDueAt: "2026-10-28T17:00:00Z" }],
      }),
    ).toEqual(["warranty_request:k1|critical"]);
  });

  it("rules can be switched off", () => {
    const s = {
      ...settings,
      rules: {
        unread_message: { enabled: false, thresholds: {} },
        warranty_request: { enabled: false, thresholds: {} },
      },
    };
    expect(
      keys(
        {
          ...empty,
          threads: [{ ...thread, lastInboundAt: "2026-10-26T10:00:00Z" }],
          cases: [{ ...kase, slaDueAt: "2026-10-26T16:00:00Z" }],
        },
        s,
      ),
    ).toEqual([]);
  });
});
