"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart } from "@/components/kpi/bar-chart";
import { CHART_COLORS } from "@/components/kpi/chart-colors";
import { DonutChart } from "@/components/analytics/charts";

export type ReportPoint = { label: string; value: number; display: string };

/** A report's grouped summary as a bar, line or donut chart (first summary column). */
export function ReportChart({
  type,
  data,
  seriesLabel,
  ariaLabel,
}: {
  type: "bar" | "line" | "donut";
  data: readonly ReportPoint[];
  seriesLabel: string;
  ariaLabel: string;
}) {
  if (type === "donut") {
    return (
      <DonutChart
        data={data.map((d) => ({ label: d.label, value: d.value, display: d.display }))}
        ariaLabel={ariaLabel}
      />
    );
  }
  if (type === "bar") {
    return (
      <BarChart
        orientation={data.length > 8 ? "horizontal" : "vertical"}
        ariaLabel={ariaLabel}
        series={[{ key: "value", label: seriesLabel, color: CHART_COLORS.primary }]}
        data={data.map((d) => ({
          label: d.label,
          value: d.value,
          total: Math.round(d.value * 10) / 10,
        }))}
      />
    );
  }
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      <div aria-hidden className="h-56 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 224 }}
        >
          <AreaChart
            data={[...data]}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, borderColor: CHART_COLORS.grid, fontSize: 12 }}
              formatter={(_v: unknown, _n: unknown, item: { payload?: ReportPoint }) => [
                item.payload?.display ?? "",
                seriesLabel,
              ]}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={CHART_COLORS.primary}
              fill={CHART_COLORS.secondary}
              fillOpacity={0.6}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
