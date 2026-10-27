import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { logError } from "@/lib/log";
import type { Option } from "@/lib/leads/service";
import { filtersToRpc, type AnalyticsFilters } from "@/lib/domain/analytics/filters";
import type { DateRange } from "@/lib/domain/analytics/periods";
import type { LabelMaps } from "@/lib/domain/reports/summarize";
import {
  parseAnalyticsMonthly,
  parseAnalyticsStats,
  parseSeasonBacklog,
  type AnalyticsMonthly,
  type AnalyticsStats,
  type SeasonBacklog,
} from "@/lib/metrics/registry";

/**
 * Server loaders for the analytics screens. Every number comes from a
 * Postgres aggregate (analytics_stats, analytics_monthly, season_backlog) run
 * with the viewer's row security; the registry turns payloads into metrics.
 */

type Db = SupabaseClient<Database>;

export type AnalyticsOptions = {
  workTypes: Option[];
  sources: Option[];
  subSources: Option[];
  territories: Option[];
  users: Option[];
};

const PICKLISTS = ["work_type", "lead_source", "lead_sub_source"] as const;

/** Options for filters and labels. Pass `orgId` with the service client (no row security). */
export async function loadAnalyticsOptions(db: Db, orgId?: string): Promise<AnalyticsOptions> {
  let lists = db
    .from("picklists")
    .select("key, picklist_values(value, label, active, sort_order)")
    .in("key", [...PICKLISTS]);
  let users = db.from("profiles").select("id, full_name").eq("is_active", true);
  let territories = db.from("territories").select("id, name").eq("active", true);
  if (orgId) {
    lists = lists.eq("org_id", orgId);
    users = users.eq("org_id", orgId);
    territories = territories.eq("org_id", orgId);
  }
  const [listsRes, usersRes, territoriesRes] = await Promise.all([
    lists,
    users.order("full_name"),
    territories.order("sort_order"),
  ]);
  const byKey = new Map<string, Option[]>();
  for (const l of listsRes.data ?? []) {
    byKey.set(
      l.key,
      [...l.picklist_values]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ value: v.value, label: v.label, active: v.active })),
    );
  }
  return {
    workTypes: byKey.get("work_type") ?? [],
    sources: byKey.get("lead_source") ?? [],
    subSources: byKey.get("lead_sub_source") ?? [],
    territories: (territoriesRes.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    users: (usersRes.data ?? []).map((u) => ({ value: u.id, label: u.full_name })),
  };
}

const toMap = (opts: readonly Option[]) =>
  Object.fromEntries(opts.map((o) => [o.value, o.label])) as Record<string, string>;

/** Label maps for report cells and breakdown rows. */
export function analyticsLabels(o: AnalyticsOptions): LabelMaps & {
  workTypes: Record<string, string>;
  sources: Record<string, string>;
  territories: Record<string, string>;
  owners: Record<string, string>;
} {
  return {
    "picklist:work_type": toMap(o.workTypes),
    "picklist:lead_source": toMap(o.sources),
    "picklist:lead_sub_source": toMap(o.subSources),
    workTypes: toMap(o.workTypes),
    sources: toMap(o.sources),
    territories: toMap(o.territories),
    owners: toMap(o.users),
  };
}

export async function loadAnalyticsStats(
  db: Db,
  range: Pick<DateRange, "from" | "to">,
  filters: AnalyticsFilters,
): Promise<AnalyticsStats> {
  const { data, error } = await db.rpc("analytics_stats", {
    p_from: range.from,
    p_to: range.to,
    p_filters: filtersToRpc(filters) as Json,
  });
  if (error) logError("analytics.stats", error);
  return parseAnalyticsStats(data);
}

export async function loadAnalyticsMonthly(
  db: Db,
  fromMonth: string,
  months: number,
  filters: AnalyticsFilters,
): Promise<AnalyticsMonthly> {
  const { data, error } = await db.rpc("analytics_monthly", {
    p_from_month: fromMonth,
    p_months: months,
    p_filters: filtersToRpc(filters) as Json,
  });
  if (error) logError("analytics.monthly", error);
  return parseAnalyticsMonthly(data);
}

export async function loadSeasonBacklog(db: Db, year: number): Promise<SeasonBacklog> {
  const { data, error } = await db.rpc("season_backlog", { p_year: year });
  if (error) logError("analytics.season", error);
  return parseSeasonBacklog(data);
}
