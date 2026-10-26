"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart as RechartsBarChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "./chart-colors";

/**
 * Bar chart wrapper for dashboards (Recharts). One series = one color for every
 * bar; several series stack (e.g. converted + not converted). The chart is a
 * picture for sighted mouse users; its `ariaLabel` summarizes it and the
 * card's "View data" table is the full accessible alternative, so the SVG
 * itself is kept out of the keyboard/screen-reader flow.
 */

export type BarSeries = { key: string; label: string; color: string };
export type BarDatum = {
  label: string;
  /** Shown at the end of each bar. */
  total: number;
  /** Drill-down opened when the bar is clicked. */
  href?: string;
} & Record<string, string | number | undefined>;

export function BarChart({
  data,
  series,
  ariaLabel,
  orientation = "horizontal",
  height,
}: {
  data: readonly BarDatum[];
  series: readonly BarSeries[];
  ariaLabel: string;
  /** "horizontal": bars grow right (category on the left). "vertical": columns. */
  orientation?: "horizontal" | "vertical";
  height?: number;
}) {
  const router = useRouter();
  const horizontal = orientation === "horizontal";
  const longest = data.reduce((m, d) => Math.max(m, d.label.length), 0);
  const categoryWidth = Math.min(150, Math.max(56, Math.round(longest * 6.6) + 8));
  const h = height ?? (horizontal ? data.length * 34 + 12 : 190);
  const stacked = series.length > 1;
  const onBarClick = (entry: unknown) => {
    const href =
      entry && typeof entry === "object" && "payload" in entry
        ? (entry.payload as BarDatum | undefined)?.href
        : undefined;
    if (href) router.push(href);
  };
  const clickable = data.some((d) => d.href);

  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      <div aria-hidden className="w-full" style={{ height: h }}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: h }}
        >
          <RechartsBarChart
            data={[...data]}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={
              horizontal
                ? { top: 0, right: 40, bottom: 0, left: 0 }
                : { top: 20, right: 4, bottom: 0, left: 4 }
            }
            barCategoryGap={horizontal ? 8 : "20%"}
            accessibilityLayer={false}
          >
            {horizontal ? (
              <>
                <XAxis type="number" hide allowDecimals={false} domain={[0, "dataMax"]} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={categoryWidth}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                />
              </>
            ) : (
              <>
                <XAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
                />
                <YAxis type="number" hide allowDecimals={false} domain={[0, "dataMax"]} />
              </>
            )}
            <Tooltip
              cursor={{ fill: "rgba(31, 77, 58, 0.06)" }}
              contentStyle={{ borderRadius: 8, borderColor: CHART_COLORS.grid, fontSize: 12 }}
              isAnimationActive={false}
            />
            {stacked && (
              <Legend
                verticalAlign="top"
                align="left"
                height={24}
                iconType="square"
                iconSize={10}
                wrapperStyle={{ fontSize: 12, color: CHART_COLORS.axis }}
                formatter={(value: string) => (
                  <span style={{ color: CHART_COLORS.axis }}>{value}</span>
                )}
              />
            )}
            {series.map((s, i) => {
              const last = i === series.length - 1;
              const radius: [number, number, number, number] = last
                ? horizontal
                  ? [0, 4, 4, 0]
                  : [4, 4, 0, 0]
                : [0, 0, 0, 0];
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  stackId={stacked ? "stack" : undefined}
                  radius={radius}
                  maxBarSize={horizontal ? 20 : 48}
                  isAnimationActive={false}
                  onClick={clickable ? onBarClick : undefined}
                  cursor={clickable ? "pointer" : undefined}
                >
                  {last && (
                    <LabelList
                      dataKey="total"
                      position={horizontal ? "right" : "top"}
                      style={{
                        fontSize: 12,
                        fill: CHART_COLORS.label,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                  )}
                </Bar>
              );
            })}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
