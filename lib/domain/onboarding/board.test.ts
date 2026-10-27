import { describe, expect, it } from "vitest";
import {
  BOARD_LANES,
  boardLane,
  boardMove,
  dataAuditIssues,
  expediteList,
  filterCards,
  laneEnteredAt,
  placeCards,
  summarizeBoard,
  type BoardCard,
  type BoardHold,
} from "./board";

const NOW = new Date("2026-10-27T19:00:00Z"); // noon Pacific
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  id: "j1",
  jobNumber: "BB-2026-0001",
  name: "Lee – Kirkland – Exterior",
  accountName: "Lee Residence",
  city: "Kirkland",
  workTypes: ["exterior"],
  stage: "onboarding",
  stageEnteredAt: daysAgo(2),
  holds: [],
  contractCents: 1_000_000,
  collectedCents: null,
  depositCents: 300_000,
  soldAt: daysAgo(3),
  paidInFullAt: null,
  onboarding: { required: 10, cleared: 6 },
  readyToSchedule: false,
  leadSafe: false,
  hasHoa: false,
  priority: "normal",
  ...over,
});

const hold = (type: string, days = 1, blocks = true): BoardHold => ({
  type,
  label: `${type.toUpperCase()} hold`,
  blocksScheduling: blocks,
  placedAt: daysAgo(days),
});

describe("lanes", () => {
  it("derive from stage and holds", () => {
    expect(boardLane(card({ holds: [hold("deposit")] }), NOW)).toBe("deposit_hold");
    expect(boardLane(card({ stage: "sold", holds: [hold("deposit"), hold("hoa")] }), NOW)).toBe(
      "deposit_hold",
    );
    expect(boardLane(card({ holds: [hold("hoa")] }), NOW)).toBe("on_hold");
    expect(boardLane(card({ holds: [hold("customer", 1, false)] }), NOW)).toBe("needs_onboarding");
    expect(boardLane(card(), NOW)).toBe("needs_onboarding");
    expect(boardLane(card({ stage: "sold" }), NOW)).toBe("needs_onboarding");
    expect(boardLane(card({ stage: "ready_to_schedule" }), NOW)).toBe("ready");
    expect(
      boardLane(card({ stage: "ready_to_schedule", holds: [hold("weather", 1, false)] }), NOW),
    ).toBe("on_hold");
    expect(boardLane(card({ stage: "ready_to_schedule", holds: [hold("deposit")] }), NOW)).toBe(
      "deposit_hold",
    );
    for (const s of ["scheduled", "in_progress", "final_walkthrough"] as const) {
      expect(boardLane(card({ stage: s, holds: [hold("weather")] }), NOW)).toBe("in_production");
    }
    expect(boardLane(card({ stage: "completed" }), NOW)).toBe("invoicing");
    expect(boardLane(card({ stage: "invoiced" }), NOW)).toBe("invoicing");
    expect(boardLane(card({ stage: "paid_in_full" }), NOW)).toBe("paid");
    expect(boardLane(card({ stage: "closed_won", paidInFullAt: daysAgo(5) }), NOW)).toBe("paid");
    expect(boardLane(card({ stage: "closed_won", paidInFullAt: daysAgo(40) }), NOW)).toBeNull();
    expect(boardLane(card({ stage: "closed_won" }), NOW)).toBeNull();
    expect(boardLane(card({ stage: "estimate_sent" }), NOW)).toBeNull();
  });

  it("time in lane starts when the hold that put it there was placed", () => {
    const c = card({ holds: [hold("deposit", 4)], stageEnteredAt: daysAgo(1) });
    expect(laneEnteredAt(c, "deposit_hold")).toBe(daysAgo(4));
    const h = card({ holds: [hold("hoa", 2), hold("color", 9)] });
    expect(laneEnteredAt(h, "on_hold")).toBe(daysAgo(9));
    expect(laneEnteredAt(card({ stage: "paid_in_full", paidInFullAt: daysAgo(1) }), "paid")).toBe(
      daysAgo(1),
    );
    expect(laneEnteredAt(card(), "needs_onboarding")).toBe(daysAgo(2));
  });

  it("flags overdue cards by the lane's threshold and computes % collected", () => {
    const placed = placeCards(
      [
        card({ id: "a", holds: [hold("deposit", 3)] }),
        card({ id: "b", stageEnteredAt: daysAgo(6) }),
        card({ id: "c", stage: "estimate_sent" }),
        card({ id: "d", stage: "invoiced", collectedCents: 250_000 }),
      ],
      NOW,
    );
    expect(placed.map((p) => [p.id, p.lane, p.daysInLane, p.overdue])).toEqual([
      ["a", "deposit_hold", 3, true],
      ["b", "needs_onboarding", 6, false],
      ["d", "invoicing", 2, false],
    ]);
    expect(placed[2]?.collectedShare).toBeCloseTo(0.25);
    expect(placed[0]?.collectedShare).toBeNull();
  });
});

describe("summary", () => {
  it("totals each lane and the KPI strip; money only for people who can see it", () => {
    const placed = placeCards(
      [
        card({ id: "a", holds: [hold("deposit", 1)] }),
        card({
          id: "b",
          holds: [hold("deposit", 5)],
          contractCents: 500_000,
          depositCents: 150_000,
        }),
        card({ id: "c", stage: "ready_to_schedule", contractCents: 200_000 }),
        card({ id: "d", stage: "paid_in_full", paidInFullAt: daysAgo(1) }),
      ],
      NOW,
    );
    const s = summarizeBoard(placed, true);
    expect(s.lanes).toHaveLength(BOARD_LANES.length);
    expect(s.lanes.find((l) => l.lane === "deposit_hold")).toEqual({
      lane: "deposit_hold",
      count: 2,
      valueCents: 1_500_000,
      avgDays: 3,
      overdue: 1,
    });
    expect(s.lanes.find((l) => l.lane === "invoicing")).toMatchObject({ count: 0, avgDays: null });
    expect(s).toMatchObject({
      activeJobs: 3,
      activeValueCents: 1_700_000,
      depositHeldCents: 450_000,
    });
    expect(s.outstandingCents).toBeNull();
    const hidden = summarizeBoard(placed, false);
    expect(hidden.activeValueCents).toBeNull();
    expect(hidden.lanes[0]?.valueCents).toBeNull();
    expect(hidden.depositHeldCents).toBeNull();
  });

  it("outstanding is billed − collected once payments are known", () => {
    const placed = placeCards([card({ stage: "invoiced", collectedCents: 400_000 })], NOW);
    expect(summarizeBoard(placed, true).outstandingCents).toBe(600_000);
  });
});

describe("moves", () => {
  const place = (c: BoardCard) => placeCards([c], NOW)[0]!;

  it("Needs Onboarding → Ready to Schedule only when the gate passes", () => {
    expect(boardMove(place(card({ readyToSchedule: true })), "ready")).toEqual({
      allowed: true,
      from: "onboarding",
      to: "ready_to_schedule",
      message: "Moved to Ready to Schedule.",
    });
    const blocked = boardMove(place(card()), "ready");
    expect(blocked).toMatchObject({ allowed: false });
    expect(!blocked.allowed && blocked.reason).toMatch(
      /4 required onboarding items are still open/,
    );
    const one = boardMove(place(card({ onboarding: { required: 3, cleared: 2 } })), "ready");
    expect(!one.allowed && one.reason).toMatch(
      /1 required onboarding item is still open. Clear it/,
    );
    const noList = boardMove(place(card({ onboarding: null })), "ready");
    expect(!noList.allowed && noList.reason).toMatch(/isn't cleared yet/);
    const sold = boardMove(place(card({ stage: "sold", readyToSchedule: true })), "ready");
    expect(!sold.allowed && sold.reason).toMatch(/still in Sold/);
  });

  it("explains every other drop", () => {
    const reason = (c: BoardCard, to: Parameters<typeof boardMove>[1]) => {
      const m = boardMove(place(c), to);
      return m.allowed ? "ALLOWED" : m.reason;
    };
    expect(reason(card(), "needs_onboarding")).toMatch(/already in that lane/);
    expect(reason(card({ holds: [hold("deposit")] }), "needs_onboarding")).toMatch(
      /Waiting for the deposit/,
    );
    expect(reason(card({ holds: [hold("hoa")] }), "ready")).toMatch(/Release the HOA hold/);
    expect(reason(card(), "deposit_hold")).toMatch(/on their own/);
    expect(reason(card(), "on_hold")).toMatch(/Place a hold/);
    expect(reason(card({ stage: "ready_to_schedule" }), "needs_onboarding")).toMatch(
      /owner override/,
    );
    expect(reason(card({ stage: "ready_to_schedule" }), "in_production")).toMatch(
      /Master Schedule/,
    );
    expect(reason(card({ stage: "in_progress" }), "paid")).toMatch(/Phase 7/);
    expect(reason(card({ stage: "in_progress" }), "invoicing")).toMatch(/final invoice/);
    expect(reason(card(), "in_production")).toMatch(/one step at a time/);
  });
});

describe("filters, expedite and data audit", () => {
  const cards = [
    card({ id: "a", workTypes: ["interior"], city: "Bellevue", soldAt: "2026-10-01T18:00:00Z" }),
    card({ id: "b", holds: [hold("hoa")], soldAt: "2026-10-20T18:00:00Z" }),
    card({ id: "c", holds: [hold("lead_safe")], soldAt: null }),
  ];

  it("filters by work type, city, holds and sold date (Pacific days)", () => {
    const ids = (f: Parameters<typeof filterCards>[1]) => filterCards(cards, f).map((c) => c.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ workType: "interior" })).toEqual(["a"]);
    expect(ids({ city: "bellevue" })).toEqual(["a"]);
    expect(ids({ hold: "any" })).toEqual(["b", "c"]);
    expect(ids({ hold: "none" })).toEqual(["a"]);
    expect(ids({ hold: "lead_safe" })).toEqual(["c"]);
    expect(ids({ soldFrom: "2026-10-02" })).toEqual(["b"]);
    expect(ids({ soldTo: "2026-10-01" })).toEqual(["a"]);
  });

  it("expedite lists held or overdue cards, longest wait first", () => {
    const placed = placeCards(
      [
        card({ id: "x", stageEnteredAt: daysAgo(1) }),
        card({ id: "y", holds: [hold("hoa", 2)] }),
        card({ id: "z", stageEnteredAt: daysAgo(10) }),
      ],
      NOW,
    );
    expect(expediteList(placed).map((c) => c.id)).toEqual(["z", "y"]);
  });

  it("lists missing data", () => {
    const base = {
      stage: "onboarding" as const,
      hasPrimaryContact: true,
      contactMobile: "+14255550111",
      contactEmail: "a@b.co",
      hasProperty: true,
      pointOfContactId: "u1",
      promisedStartDate: null,
      soldAt: daysAgo(1),
      hasChecklist: true,
    };
    expect(dataAuditIssues(base)).toEqual([]);
    expect(
      dataAuditIssues({
        ...base,
        stage: "ready_to_schedule",
        contactEmail: null,
        contactMobile: null,
        hasProperty: false,
        pointOfContactId: null,
        soldAt: null,
        hasChecklist: false,
      }),
    ).toEqual([
      "No mobile number",
      "No email",
      "No property",
      "No point of contact",
      "No sold date",
      "No onboarding checklist",
      "No promised start date",
    ]);
    expect(dataAuditIssues({ ...base, hasPrimaryContact: false })).toEqual(["No primary contact"]);
  });
});
