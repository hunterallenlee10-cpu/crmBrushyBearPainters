import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { centsToDollars } from "@/lib/validation/common";
import { monthStart, pacificToday, ymdString } from "@/lib/domain/analytics/periods";
import { monthLabel } from "@/lib/metrics/registry";
import { GoalsForm } from "./goals-form";

export const metadata: Metadata = { title: "Revenue Goals" };

/**
 * Admin → Revenue Goals (SPEC §8.2 Revenue Forecast "vs goal", §8.14 On Pace):
 * a sold-revenue goal per month. Until one is set, the forecast says
 * "No revenue goal configured". Goals are owner-entered numbers, never guessed.
 */
export default async function RevenueGoalsPage() {
  const viewer = await requirePermission("settings:manage");
  const today = ymdString(pacificToday());
  const months = Array.from({ length: 15 }, (_, i) => monthStart(today, i - 2));
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("revenue_goals")
    .select("month, goal_cents")
    .gte("month", months[0]!)
    .lte("month", months.at(-1)!);
  const goals = new Map((data ?? []).map((g) => [g.month, g.goal_cents]));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Revenue Goals"
        description="Monthly sold-revenue goals (contracts accepted). The Executive Overview's Revenue Forecast and Analytics → On Pace compare against them. Leave a month empty for no goal."
      />
      <GoalsForm
        months={months.map((m) => ({
          month: m,
          label: monthLabel(m),
          goal: goals.has(m) ? centsToDollars(Number(goals.get(m))) : "",
        }))}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
