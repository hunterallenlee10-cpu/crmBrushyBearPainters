import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import { logError } from "@/lib/log";
import {
  composeAnswer,
  planQuestion,
  presetLabel,
  type AnsweredMetric,
  type AskAnswer,
  type AskReport,
} from "@/lib/domain/analytics/ask";
import { describeFilters } from "@/lib/domain/analytics/filters";
import { resolvePeriod } from "@/lib/domain/analytics/periods";
import {
  analyticsLabels,
  loadAnalyticsOptions,
  loadAnalyticsStats,
  loadSeasonBacklog,
} from "@/lib/analytics/server";
import { seasonYear } from "@/lib/analytics/view";
import {
  ANALYTICS_BREAKDOWNS,
  analyticsFunnel,
  analyticsMetricValue,
  cityPerformance,
  estimatorLeaderboard,
  formatMoney,
  formatPercent,
  leadSourcePerformance,
  metricDelta,
  parseProductionStats,
  productionMetricValue,
  seasonBacklogRows,
  type AnalyticsMetricId,
  type AnalyticsStats,
} from "@/lib/metrics/registry";

/**
 * Runs an "Ask Brushy Bear" plan (lib/domain/analytics/ask.ts) on the server:
 * the registry's RPCs with the asker's row security. Numbers only ever come
 * from registry metrics; the reply cites their ids and the filters used.
 */

type Db = SupabaseClient<Database>;

export type AskResult =
  | {
      kind: "answer";
      answer: AskAnswer;
      breakdown: { title: string; rows: { label: string; value: string }[] } | null;
    }
  | { kind: "forbidden"; reason: string; citations: readonly string[] }
  | { kind: "unmapped"; suggestion: AskReport | null };

export async function answerQuestion(
  db: Db,
  viewer: Viewer,
  question: string,
  now: Date = new Date(),
): Promise<AskResult> {
  const [options, reportsRes] = await Promise.all([
    loadAnalyticsOptions(db),
    viewer.can("reports:read")
      ? db.from("reports").select("id, name, description, template_key").order("name").limit(200)
      : Promise.resolve(null),
  ]);
  const reports: AskReport[] = (reportsRes?.data ?? []).map((r) => ({
    key: r.template_key ?? r.id,
    name: r.name,
    description: r.description ?? "",
    href: `/analytics/reports/${r.id}`,
  }));
  const plan = planQuestion(question, {
    can: (p) => viewer.can(p),
    isOwner: viewer.isOwner,
    territories: options.territories,
    sources: options.sources,
    workTypes: options.workTypes,
    reports,
  });
  if (plan.kind === "unmapped") return plan;
  if (plan.kind === "forbidden")
    return { kind: "forbidden", reason: plan.reason, citations: plan.metricIds };

  const range = resolvePeriod(plan.period, now);
  const compareRange = plan.compare ? resolvePeriod(plan.compare, now) : null;
  const analyticsIds = plan.metricIds.filter((id): id is AnalyticsMetricId =>
    id.startsWith("kpi."),
  );
  const productionIds = plan.metricIds.filter(
    (id): id is "production.ready" | "production.unscheduled" => id.startsWith("production."),
  );
  const [stats, compareStats, production] = await Promise.all([
    analyticsIds.length || plan.breakdown
      ? loadAnalyticsStats(db, range, plan.filters)
      : Promise.resolve(null),
    compareRange && analyticsIds.length
      ? loadAnalyticsStats(db, compareRange, plan.filters)
      : Promise.resolve(null),
    productionIds.length ? db.rpc("production_stats") : Promise.resolve(null),
  ]);
  if (production?.error) logError("ask.production_stats", production.error);

  const metrics: AnsweredMetric[] = [];
  for (const id of analyticsIds) {
    const v = analyticsMetricValue(id, stats as AnalyticsStats, range.words);
    const out: AnsweredMetric = { id, label: v.label, display: v.display, caption: v.caption };
    if (compareStats) {
      const c = analyticsMetricValue(id, compareStats, compareRange!.words);
      const d = metricDelta(v.unit, v.value, c.value);
      out.compareDisplay = c.display;
      out.change = d ? d.display : null;
    }
    metrics.push(out);
  }
  if (production?.data !== undefined) {
    const p = parseProductionStats(production?.data ?? null);
    for (const id of productionIds) {
      const v = productionMetricValue(id, p);
      metrics.push({ id, label: v.label, display: v.display, caption: `${v.caption} · right now` });
    }
  }

  const labels = analyticsLabels(options);
  const answer = composeAnswer({
    question,
    plan,
    metrics,
    periodLabel: productionIds.length && !analyticsIds.length ? "Right now" : range.label,
    compareLabel: compareRange ? presetLabel(compareRange.preset) : null,
    filtersLabel: describeFilters(plan.filters, labels),
  });

  let breakdown: Extract<AskResult, { kind: "answer" }>["breakdown"] = null;
  if (plan.breakdown && stats) {
    const title = ANALYTICS_BREAKDOWNS[plan.breakdown].label;
    switch (plan.breakdown) {
      case "kpi.lead_funnel":
        breakdown = {
          title,
          rows: analyticsFunnel(stats).map((r) => ({
            label: r.label,
            value: `${r.count} (${formatPercent(r.ofTotal)})`,
          })),
        };
        break;
      case "kpi.lead_source_performance":
        breakdown = {
          title,
          rows: leadSourcePerformance(stats, labels.sources)
            .slice(0, 6)
            .map((r) => ({
              label: r.label,
              value: `${r.leads} leads · ${formatPercent(r.conversion)} converted`,
            })),
        };
        break;
      case "kpi.city_performance":
        breakdown = {
          title,
          rows: cityPerformance(stats)
            .filter((r) => r.rank !== null)
            .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
            .map((r) => ({
              label: r.city,
              value: `${r.leads} leads · ${r.soldJobs} sold${r.soldCents !== null ? ` · ${formatMoney(r.soldCents)}` : ""}`,
            })),
        };
        break;
      case "kpi.estimator_leaderboard":
        breakdown = {
          title,
          rows: estimatorLeaderboard(stats).map((r) => ({
            label: r.name,
            value: `${formatMoney(r.soldCents)} · ${r.jobs} jobs · ${formatPercent(r.closeRate)} close`,
          })),
        };
        break;
      case "kpi.season_backlog": {
        const season = await loadSeasonBacklog(db, seasonYear(range.lastDay));
        breakdown = {
          title,
          rows: seasonBacklogRows(season).map((r) => ({
            label: r.label,
            value: `${r.booked} of ${r.capacity} crew-days`,
          })),
        };
        break;
      }
      default:
        breakdown = null;
    }
  }
  return { kind: "answer", answer, breakdown };
}
