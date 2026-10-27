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
import { CHART_COLORS } from "@/components/kpi/chart-colors";

/**
 * Daily sold value (or jobs sold, for people without financials) as an area
 * chart. The values are computed by the metrics registry on the server; this
 * only draws them. Like the bar chart, the SVG is a picture: `ariaLabel`
 * summarizes it and the card's "View data" table is the accessible version.
 */

export type SoldPoint = { label: string; value: number; display: string };

export function SoldChart({
  data,
  ariaLabel,
  seriesLabel,
  money,
}: {
  data: readonly SoldPoint[];
  ariaLabel: string;
  seriesLabel: string;
  money: boolean;
}) {
  const tick = (v: number) =>
    money
      ? v >= 1000
        ? `$${Math.round(v / 1000)}k`
        : `$${Math.round(v)}`
      : Math.round(v).toLocaleString("en-US");
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      <div aria-hidden className="h-52 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 208 }}
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
              minTickGap={24}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickFormatter={tick}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, borderColor: CHART_COLORS.grid, fontSize: 12 }}
              formatter={(_v, _n, item) => [
                (item.payload as SoldPoint | undefined)?.display ?? "",
                seriesLabel,
              ]}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={seriesLabel}
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
