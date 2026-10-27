import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { widgetCatalog } from "@/lib/domain/analytics/dashboards";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  type AnalyticsBreakdownId,
  type AnalyticsMetricId,
} from "@/lib/metrics/registry";
import { DashboardForm } from "../_components/dashboard-form";

export const metadata: Metadata = { title: "Custom dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Build or edit a custom dashboard: pick registry tiles and charts, share it or keep it. */
export default async function NewDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("reports:build", "analytics:read");
  const sp = await searchParams;
  const editId = typeof sp.edit === "string" ? sp.edit : null;
  let initial = {
    id: undefined as string | undefined,
    name: "",
    description: "",
    widgets: [] as string[],
    shared: false,
  };
  if (editId) {
    const db = await createSupabaseServerClient();
    const { data } = await db
      .from("dashboards")
      .select("id, name, description, widgets, shared, owner_id")
      .eq("id", editId)
      .maybeSingle();
    if (!data || data.owner_id !== viewer.id) notFound();
    initial = {
      id: data.id,
      name: data.name,
      description: data.description ?? "",
      widgets: data.widgets,
      shared: data.shared,
    };
  }
  const visible = (id: string) => {
    const req =
      id in ANALYTICS_METRICS
        ? ANALYTICS_METRICS[id as AnalyticsMetricId].requires
        : ANALYTICS_BREAKDOWNS[id as AnalyticsBreakdownId].requires;
    return req.every((p) => viewer.can(p));
  };
  const catalog = widgetCatalog().map((w) => ({
    ...w,
    description:
      w.kind === "kpi"
        ? ANALYTICS_METRICS[w.id as AnalyticsMetricId].description
        : ANALYTICS_BREAKDOWNS[w.id as AnalyticsBreakdownId].description,
    hiddenForYou: !visible(w.id),
  }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={editId ? "Edit dashboard" : "New dashboard"}
        description="Pick KPI tiles and charts from the metrics registry. Shared dashboards show each person only what their role may see."
      />
      <DashboardForm initial={initial} catalog={catalog} readOnly={viewer.impersonating} />
    </div>
  );
}
