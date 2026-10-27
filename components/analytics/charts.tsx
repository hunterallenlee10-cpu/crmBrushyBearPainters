"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/components/kpi/chart-colors";

/**
 * Analytics charts (Recharts). Values come from the metrics registry on the
 * server; these only draw them. Like the other dashboard charts, the SVG is
 * a picture: `ariaLabel` summarizes it and the card's "View data" table is
 * the accessible version.
 */

const tickMoney = (v: number) =>
  Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;

export type ForecastPoint = {
  label: string;
  /** Dollars (not cents) for the axis. */
  actual: number | null;
  projected: number | null;
  goal: number | null;
};

/** Revenue Forecast: monthly actual (bars), run-rate projection and goal (lines). */
export function ForecastChart({
  data,
  ariaLabel,
  showGoal,
}: {
  data: readonly ForecastPoint[];
  ariaLabel: string;
  showGoal: boolean;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      <div aria-hidden className="h-60 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 240 }}
        >
          <ComposedChart
            data={[...data]}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickMoney}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, borderColor: CHART_COLORS.grid, fontSize: 12 }}
              formatter={(v: unknown, name: unknown) => [
                typeof v === "number" ? `$${Math.round(v).toLocaleString("en-US")}` : "—",
                String(name),
              ]}
              isAnimationActive={false}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={24}
              iconSize={10}
              wrapperStyle={{ fontSize: 12, color: CHART_COLORS.axis }}
            />
            <Bar
              dataKey="actual"
              name="Actual"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
            <Line
              dataKey="projected"
              name="Run-rate"
              stroke="#b7791f"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
            {showGoal && (
              <Line
                dataKey="goal"
                name="Goal"
                stroke="#4338ca"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type DonutSlice = { label: string; value: number; display: string };

/** Brand-tinted categorical palette (forest first), readable on cream and white. */
const DONUT_COLORS = [
  "#1f4d3a",
  "#b7791f",
  "#4338ca",
  "#0f766e",
  "#be123c",
  "#6d28d9",
  "#a16207",
  "#475569",
];

/** Lead Source Mix donut (top slices; the rest are grouped as "Other"). */
export function DonutChart({
  data,
  ariaLabel,
}: {
  data: readonly DonutSlice[];
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      <div aria-hidden className="h-56 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 224 }}
        >
          <PieChart accessibilityLayer={false}>
            <Pie
              data={[...data]}
              dataKey="value"
              nameKey="label"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={data.length > 1 ? 1 : 0}
              isAnimationActive={false}
              rootTabIndex={-1}
            >
              {data.map((d, i) => (
                <Cell key={d.label} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ borderRadius: 8, borderColor: CHART_COLORS.grid, fontSize: 12 }}
              formatter={(_v: unknown, _n: unknown, item: { payload?: DonutSlice }) => [
                item.payload?.display ?? "",
                item.payload?.label ?? "",
              ]}
              isAnimationActive={false}
            />
            <Legend
              layout="vertical"
              verticalAlign="middle"
              align="right"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, color: CHART_COLORS.axis }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
