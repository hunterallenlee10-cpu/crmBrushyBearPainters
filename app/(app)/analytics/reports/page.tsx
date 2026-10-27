import type { Metadata } from "next";
import Link from "next/link";
import { FileBarChart, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatRelative } from "@/lib/format/dates";
import {
  REPORT_CATEGORY_LABELS,
  templateByKey,
  type ReportCategory,
} from "@/lib/domain/reports/templates";
import { REPORT_MODULES, isReportModuleId } from "@/lib/domain/reports/modules";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/domain/reports/schedule";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "../_components/favorite-button";

export const metadata: Metadata = { title: "Reports" };

const TABS = [
  { id: "all", label: "All" },
  { id: "mine", label: "My reports" },
  { id: "favorites", label: "Favorites" },
  { id: "templates", label: "Templates" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Analytics → Reports (SPEC §8.14): name, category, last run, frequency, updated by. */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("reports:read");
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "all";
  const db = await createSupabaseServerClient();
  const [reportsRes, runsRes, schedRes, favRes, peopleRes] = await Promise.all([
    db
      .from("reports")
      .select(
        "id, name, description, category, module, is_template, template_key, owner_id, shared, updated_at, updated_by",
      )
      .order("is_template", { ascending: false })
      .order("name"),
    db.from("report_run_stats").select("report_id, last_run_at"),
    viewer.can("reports:build")
      ? db.from("report_schedules").select("report_id, frequency, active")
      : Promise.resolve(null),
    db.from("analytics_favorites").select("item_key").eq("item_type", "report"),
    db.from("profiles").select("id, full_name"),
  ]);
  const runs = new Map((runsRes.data ?? []).map((r) => [r.report_id, r.last_run_at]));
  const freq = new Map<string, Frequency>();
  for (const s of schedRes?.data ?? [])
    if (s.active) freq.set(s.report_id, s.frequency as Frequency);
  const favs = new Set((favRes.data ?? []).map((f) => f.item_key));
  const people = new Map((peopleRes.data ?? []).map((p) => [p.id, p.full_name]));
  const canRead = (module: string, key: string | null) => {
    if (!isReportModuleId(module) || !viewer.can(REPORT_MODULES[module].requires)) return false;
    const t = key ? templateByKey(key) : undefined;
    return !t?.requires || t.requires.every((p) => viewer.can(p));
  };
  const all = (reportsRes.data ?? []).filter((r) => canRead(r.module, r.template_key));
  const rows = all.filter((r) =>
    tab === "mine"
      ? r.owner_id === viewer.id
      : tab === "favorites"
        ? favs.has(r.id)
        : tab === "templates"
          ? r.is_template
          : true,
  );
  const canBuild = viewer.can("reports:build") && !viewer.impersonating;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="Ten ready-made templates plus your own reports. Grouping and totals run on the server over every matching record."
        actions={
          canBuild ? (
            <Button asChild variant="cta">
              <Link href="/analytics/reports/new">
                <Plus aria-hidden />
                New report
              </Link>
            </Button>
          ) : undefined
        }
      />
      <nav aria-label="Report lists" className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "all" ? "/analytics/reports" : `/analytics/reports?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center rounded-full px-3 text-sm whitespace-nowrap",
              tab === t.id
                ? "bg-accent font-semibold text-bb-forest"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {tab === "favorites"
            ? "Star a report to keep it here."
            : tab === "mine"
              ? canBuild
                ? "You haven't saved a report yet. Start from a template or “New report”."
                : "Your role can run reports but not save new ones."
              : "No reports here yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Reports</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Favorite</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Category
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Last run
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Frequency
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Updated by
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <FavoriteButton
                      itemType="report"
                      itemKey={r.id}
                      on={favs.has(r.id)}
                      name={r.name}
                      disabled={viewer.impersonating}
                    />
                  </td>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link
                      href={`/analytics/reports/${r.id}`}
                      className="inline-flex items-center gap-2 hover:underline"
                    >
                      <FileBarChart className="size-4 text-bb-forest" aria-hidden />
                      {r.name}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.is_template ? "Template · " : r.shared ? "Shared · " : ""}
                      {r.description}
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    {REPORT_CATEGORY_LABELS[r.category as ReportCategory] ?? r.category}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {runs.has(r.id) ? formatRelative(runs.get(r.id)!) : "Never"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {freq.has(r.id) ? FREQUENCY_LABELS[freq.get(r.id)!] : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.is_template ? "System" : (r.updated_by && people.get(r.updated_by)) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
