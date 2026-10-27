import type { MetricFilter } from "@/lib/metrics/registry";

/**
 * Analytics filters (SPEC §12.1: work type, city, owner, source). Pure: read
 * from the URL, validated, and turned into the `p_filters` jsonb the
 * analytics RPCs take. Unknown values are dropped (the RPC ignores them too).
 */

export type AnalyticsFilters = {
  work_type: string | null;
  territory_id: string | null;
  owner_id: string | null;
  source: string | null;
};

export const NO_FILTERS: AnalyticsFilters = {
  work_type: null,
  territory_id: null,
  owner_id: null,
  source: null,
};

/** URL parameter for each filter. */
export const FILTER_PARAMS: Record<MetricFilter, keyof AnalyticsFilters> = {
  work_type: "work_type",
  city: "territory_id",
  owner: "owner_id",
  source: "source",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{1,60}$/;

export type FilterOptions = {
  workTypes?: readonly string[];
  sources?: readonly string[];
  territoryIds?: readonly string[];
  ownerIds?: readonly string[];
};

/** Reads filters from search params; when option lists are given, values must be in them. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
  options: FilterOptions = {},
  allowed: readonly MetricFilter[] = ["work_type", "city", "owner", "source"],
): AnalyticsFilters {
  const one = (k: string) => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s !== "" && s !== "all" ? s : null;
  };
  const pick = (
    key: string,
    ok: (v: string) => boolean,
    list: readonly string[] | undefined,
    filter: MetricFilter,
  ): string | null => {
    if (!allowed.includes(filter)) return null;
    const v = one(key);
    if (!v || !ok(v)) return null;
    return list && !list.includes(v) ? null : v;
  };
  return {
    work_type: pick("work_type", (v) => KEY.test(v), options.workTypes, "work_type"),
    territory_id: pick("territory_id", (v) => UUID.test(v), options.territoryIds, "city"),
    owner_id: pick("owner_id", (v) => UUID.test(v), options.ownerIds, "owner"),
    source: pick("source", (v) => KEY.test(v), options.sources, "source"),
  };
}

/** The jsonb for analytics_stats / analytics_monthly (only set filters). */
export function filtersToRpc(f: AnalyticsFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = v;
  return out;
}

export function hasFilters(f: AnalyticsFilters): boolean {
  return Object.values(f).some((v) => v !== null);
}

/** Search params for links that keep the filters. */
export function filterQuery(f: AnalyticsFilters): Record<string, string> {
  return filtersToRpc(f);
}

/** "Exterior · Bellevue" for captions and Ask answers. */
export function describeFilters(
  f: AnalyticsFilters,
  labels: {
    workTypes?: Readonly<Record<string, string>>;
    sources?: Readonly<Record<string, string>>;
    territories?: Readonly<Record<string, string>>;
    owners?: Readonly<Record<string, string>>;
  } = {},
): string {
  const parts: string[] = [];
  if (f.work_type) parts.push(labels.workTypes?.[f.work_type] ?? f.work_type);
  if (f.territory_id) parts.push(labels.territories?.[f.territory_id] ?? "One city");
  if (f.owner_id) parts.push(labels.owners?.[f.owner_id] ?? "One owner");
  if (f.source) parts.push(labels.sources?.[f.source] ?? f.source);
  return parts.length ? parts.join(" · ") : "All work types, cities, owners and sources";
}
