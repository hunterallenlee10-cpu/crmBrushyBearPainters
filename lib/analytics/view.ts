import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import {
  analyticsLabels,
  loadAnalyticsMonthly,
  loadAnalyticsOptions,
  loadAnalyticsStats,
  loadSeasonBacklog,
  type AnalyticsOptions,
} from "@/lib/analytics/server";
import type { AnalyticsView } from "@/components/analytics/widgets";
import {
  daysInMonth,
  monthStart,
  pacificToday,
  ymdString,
  type DateRange,
} from "@/lib/domain/analytics/periods";
import type { AnalyticsFilters } from "@/lib/domain/analytics/filters";
import type { AnalyticsBreakdownId } from "@/lib/metrics/registry";

type Db = SupabaseClient<Database>;

/** Report template ids by key (drill-downs open the matching report). */
export async function loadTemplateIds(db: Db): Promise<Record<string, string>> {
  const { data } = await db.from("reports").select("id, template_key").eq("is_template", true);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.template_key) out[r.template_key] = r.id;
  return out;
}

/** The exterior season the backlog shows: this year's until it ends, then next year's. */
export function seasonYear(today: string): number {
  const y = Number(today.slice(0, 4));
  return today.slice(5) > "09-30" ? y + 1 : y;
}

/** Loads everything the widgets need, in parallel, with the viewer's row security. */
export async function buildAnalyticsView(
  db: Db,
  viewer: Viewer,
  range: DateRange,
  filters: AnalyticsFilters,
  charts: readonly AnalyticsBreakdownId[],
  now: Date = new Date(),
  preloaded?: AnalyticsOptions,
): Promise<{ view: AnalyticsView; options: AnalyticsOptions }> {
  const today = pacificToday(now);
  const day = ymdString(today);
  const needMonthly = charts.includes("kpi.revenue_forecast");
  const needSeason = charts.includes("kpi.season_backlog");
  const [stats, monthly, season, options, templates] = await Promise.all([
    loadAnalyticsStats(db, range, filters),
    // Six months back, this month and five ahead.
    needMonthly
      ? loadAnalyticsMonthly(db, monthStart(day, -6), 12, filters)
      : Promise.resolve(null),
    needSeason ? loadSeasonBacklog(db, seasonYear(day)) : Promise.resolve(null),
    preloaded ? Promise.resolve(preloaded) : loadAnalyticsOptions(db),
    loadTemplateIds(db),
  ]);
  const labels = analyticsLabels(options);
  return {
    options,
    view: {
      stats,
      monthly,
      season,
      range,
      filters,
      labels,
      territories: options.territories,
      templates,
      today: { day, dayOfMonth: today.d, daysInMonth: daysInMonth(today.y, today.m) },
      canSetGoals: viewer.can("settings:manage") && !viewer.impersonating,
      canSetSpend: viewer.can("settings:manage") && !viewer.impersonating,
    },
  };
}
