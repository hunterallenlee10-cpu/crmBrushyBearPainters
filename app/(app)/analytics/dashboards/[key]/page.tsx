import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { ChartWidget, KpiTableData, KpiTiles } from "@/components/analytics/widgets";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { buildAnalyticsView } from "@/lib/analytics/view";
import { loadAnalyticsOptions } from "@/lib/analytics/server";
import { prebuiltDashboard, splitWidgets } from "@/lib/domain/analytics/dashboards";
import { parseFilters } from "@/lib/domain/analytics/filters";
import { OVERVIEW_PRESETS, parsePeriodParams } from "@/lib/domain/analytics/periods";
import { FavoriteButton } from "../../_components/favorite-button";
import { DeleteDashboardButton } from "../_components/delete-dashboard";

export const metadata: Metadata = { title: "Dashboard" };

type Params = Promise<{ key: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A prebuilt or custom dashboard, filtered by date range, work type, city, owner and source. */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("analytics:read");
  const { key } = await params;
  const sp = await searchParams;
  const db = await createSupabaseServerClient();

  let def: {
    name: string;
    description: string;
    kpis: string[];
    charts: string[];
    mine: boolean;
    custom: boolean;
  };
  const pre = prebuiltDashboard(key);
  if (pre) {
    if (!pre.requires.every((p) => viewer.can(p))) notFound();
    def = {
      name: pre.name,
      description: pre.description,
      kpis: [...pre.kpis],
      charts: [...pre.charts],
      mine: false,
      custom: false,
    };
  } else {
    if (!UUID.test(key)) notFound();
    const { data } = await db
      .from("dashboards")
      .select("id, name, description, widgets, owner_id")
      .eq("id", key)
      .maybeSingle();
    if (!data) notFound();
    const w = splitWidgets(data.widgets);
    def = {
      name: data.name,
      description: data.description ?? "",
      kpis: w.kpis,
      charts: w.charts,
      mine: data.owner_id === viewer.id,
      custom: true,
    };
  }
  const { kpis, charts } = splitWidgets([...def.kpis, ...def.charts]);

  const options = await loadAnalyticsOptions(db);
  const range = parsePeriodParams(sp, OVERVIEW_PRESETS, "this_month");
  const filters = parseFilters(sp, {
    workTypes: options.workTypes.map((o) => o.value),
    sources: options.sources.map((o) => o.value),
    territoryIds: options.territories.map((o) => o.value),
    ownerIds: options.users.map((o) => o.value),
  });
  const { view } = await buildAnalyticsView(
    db,
    viewer,
    range,
    filters,
    charts,
    new Date(),
    options,
  );
  const { data: fav } = await db
    .from("analytics_favorites")
    .select("id")
    .eq("item_type", "dashboard")
    .eq("item_key", key)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-5" data-dashboard={key}>
      <Link
        href="/analytics/dashboards"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Dashboards
      </Link>
      <PageHeader
        title={def.name}
        description={def.description}
        actions={
          <>
            <FavoriteButton
              itemType="dashboard"
              itemKey={key}
              on={!!fav}
              name={def.name}
              disabled={viewer.impersonating}
            />
            {kpis.length > 0 && <KpiTableData ids={kpis} view={view} title={`${def.name} KPIs`} />}
            {def.custom && def.mine && !viewer.impersonating && (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/analytics/dashboards/new?edit=${key}`}>
                    <Pencil aria-hidden />
                    Edit
                  </Link>
                </Button>
                <DeleteDashboardButton id={key} name={def.name} />
              </>
            )}
          </>
        }
      />
      <AnalyticsFilterBar
        presets={OVERVIEW_PRESETS}
        preset={range.preset}
        custom={range.custom}
        workTypes={options.workTypes.filter((o) => o.active !== false)}
        cities={options.territories}
        owners={options.users}
        sources={options.sources.filter((o) => o.active !== false)}
        idPrefix="dash"
      />
      {kpis.length > 0 && <KpiTiles ids={kpis} view={view} label={`${def.name} KPIs`} />}
      {charts.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {charts.map((id) => (
            <ChartWidget key={id} id={id} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
