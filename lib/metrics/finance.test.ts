import { describe, expect, it } from "vitest";
import {
  AGING_METRIC_IDS,
  EMPTY_FINANCE_STATS,
  FINANCE_METRICS,
  agingCount,
  financeMetricValue,
  getMetric,
  parseFinanceStats,
} from "@/lib/metrics/registry";

/**
 * Money metrics (SPEC §12.1) against a fixture shaped like
 * public.finance_stats() — the same scenario as supabase/tests/013_money.test.sql
 * (one overdue final invoice with $2,250 owed, $5 unapplied).
 */
const FIXTURE = {
  can_see_money: true,
  can_see_costs: true,
  ar_outstanding_cents: 225_000,
  ar_open_invoices: 1,
  overdue_cents: 225_000,
  overdue_invoices: 1,
  aging: { current: 0, d1_30: 225_000, d31_60: 0, d61_90: 0, d90_plus: 0 },
  aging_counts: { current: 0, d1_30: 1, d31_60: 0, d61_90: 0, d90_plus: 0 },
  collected_cents: 750_000,
  refunded_cents: 5_000,
  billed_cents: 975_000,
  billed_collected_cents: 750_000,
  unapplied_cents: 5_000,
  sold_cents: 1_000_000,
  sold_jobs: 1,
  completed_cents: 975_000,
  completed_jobs: 1,
  margin_revenue_cents: 975_000,
  margin_cost_cents: 585_000,
  paid_jobs: 2,
  days_completed_to_paid_avg: 12.5,
  pending_credit_cents: 10_000,
  invoices: { all: 3, draft: 1, open: 1, overdue: 1, paid: 1, void: 0 },
};

describe("finance metrics", () => {
  const s = parseFinanceStats(FIXTURE);
  it("reads every number from finance_stats", () => {
    const shown = Object.fromEntries(
      (Object.keys(FINANCE_METRICS) as (keyof typeof FINANCE_METRICS)[]).map((id) => [
        id,
        financeMetricValue(id, s).display,
      ]),
    );
    expect(shown).toEqual({
      "finance.ar_outstanding": "$2,250",
      "finance.overdue": "$2,250",
      "finance.overdue_invoices": "1",
      "finance.collected": "$7,500",
      "finance.billed": "$9,750",
      "finance.collection_rate": "77%",
      "finance.revenue_sold": "$10,000",
      "finance.revenue_completed": "$9,750",
      "finance.gross_margin_completed": "40%",
      "finance.days_completed_to_paid": "13 days",
      "finance.unapplied": "$50",
      "finance.aging_current": "$0",
      "finance.aging_1_30": "$2,250",
      "finance.aging_31_60": "$0",
      "finance.aging_61_90": "$0",
      "finance.aging_90_plus": "$0",
      "finance.invoices_open": "1",
      "finance.invoices_draft": "1",
      "finance.pending_credits": "$100",
    });
    expect(AGING_METRIC_IDS.map((id) => agingCount(s, id))).toEqual([0, 1, 0, 0, 0]);
    expect(getMetric("finance.gross_margin_completed").ownerOnly).toBe(true);
  });

  it("hides money without financials:read and margin without job costing", () => {
    const hidden = parseFinanceStats({ can_see_money: false });
    expect(financeMetricValue("finance.ar_outstanding", hidden).display).toBe("—");
    expect(financeMetricValue("finance.collection_rate", hidden).value).toBeNull();
    const noCosts = parseFinanceStats({ ...FIXTURE, can_see_costs: false });
    expect(financeMetricValue("finance.gross_margin_completed", noCosts).value).toBeNull();
    expect(financeMetricValue("finance.collected", noCosts).display).toBe("$7,500");
  });

  it("never divides by zero and survives a malformed payload", () => {
    const empty = parseFinanceStats({ can_see_money: true });
    expect(financeMetricValue("finance.collection_rate", empty).display).toBe("—");
    expect(financeMetricValue("finance.gross_margin_completed", empty).display).toBe("—");
    expect(parseFinanceStats("nonsense")).toEqual(EMPTY_FINANCE_STATS);
    expect(parseFinanceStats({ aging: "x", invoices: 3 }).aging.d1_30).toBe(0);
  });
});
