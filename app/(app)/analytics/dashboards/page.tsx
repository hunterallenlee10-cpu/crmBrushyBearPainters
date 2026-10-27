import type { Metadata } from "next";
import Link from "next/link";
import { LayoutDashboard, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { PREBUILT_DASHBOARDS, splitWidgets } from "@/lib/domain/analytics/dashboards";
import { FavoriteButton } from "../_components/favorite-button";

export const metadata: Metadata = { title: "Dashboards" };

type Card = {
  key: string;
  name: string;
  description: string;
  meta: string;
  shared?: boolean;
  mine?: boolean;
};

/** Analytics → Dashboards (SPEC §8.14): prebuilt + custom, favorites, shared. */
export default async function DashboardsPage() {
  const viewer = await requirePermission("analytics:read");
  const db = await createSupabaseServerClient();
  const [customRes, favRes] = await Promise.all([
    db.from("dashboards").select("id, name, description, widgets, shared, owner_id").order("name"),
    db.from("analytics_favorites").select("item_key").eq("item_type", "dashboard"),
  ]);
  const favs = new Set((favRes.data ?? []).map((f) => f.item_key));
  const prebuilt: Card[] = PREBUILT_DASHBOARDS.filter((d) =>
    d.requires.every((p) => viewer.can(p)),
  ).map((d) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    meta: `${d.kpis.length} tiles · ${d.charts.length} charts · prebuilt`,
  }));
  const custom: Card[] = (customRes.data ?? []).map((d) => {
    const w = splitWidgets(d.widgets);
    return {
      key: d.id,
      name: d.name,
      description: d.description ?? "",
      meta: `${w.kpis.length} tiles · ${w.charts.length} charts${d.shared ? " · shared" : ""}`,
      shared: d.shared,
      mine: d.owner_id === viewer.id,
    };
  });
  const all = [...prebuilt, ...custom];
  const favorites = all.filter((c) => favs.has(c.key));
  const canBuild = viewer.can("reports:build") && !viewer.impersonating;

  const grid = (cards: Card[]) => (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <li key={c.key} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/analytics/dashboards/${c.key}`}
              className="flex items-center gap-2 font-semibold text-bb-ink hover:underline"
            >
              <LayoutDashboard className="size-4 text-bb-forest" aria-hidden />
              {c.name}
            </Link>
            <FavoriteButton
              itemType="dashboard"
              itemKey={c.key}
              on={favs.has(c.key)}
              name={c.name}
              disabled={viewer.impersonating}
            />
          </div>
          {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
          <p className="mt-auto flex items-center gap-1 text-xs text-muted-foreground">
            {c.shared && <Users className="size-3" aria-hidden />}
            {c.meta}
          </p>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dashboards"
        description="Prebuilt dashboards for every part of the business, plus your own. Every chart has View data and Download CSV."
        actions={
          canBuild ? (
            <Button asChild variant="cta">
              <Link href="/analytics/dashboards/new">
                <Plus aria-hidden />
                New dashboard
              </Link>
            </Button>
          ) : undefined
        }
      />
      {favorites.length > 0 && (
        <section aria-labelledby="fav-title" className="flex flex-col gap-2">
          <h2 id="fav-title" className="text-sm font-semibold text-muted-foreground">
            Favorites
          </h2>
          {grid(favorites)}
        </section>
      )}
      <section aria-labelledby="prebuilt-title" className="flex flex-col gap-2">
        <h2 id="prebuilt-title" className="text-sm font-semibold text-muted-foreground">
          Prebuilt
        </h2>
        {grid(prebuilt)}
      </section>
      <section aria-labelledby="custom-title" className="flex flex-col gap-2">
        <h2 id="custom-title" className="text-sm font-semibold text-muted-foreground">
          Custom
        </h2>
        {custom.length ? (
          grid(custom)
        ) : (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No custom dashboards yet.{" "}
            {canBuild
              ? "Pick the tiles and charts you care about with “New dashboard”."
              : "Someone with report-building access can create and share one."}
          </p>
        )}
      </section>
    </div>
  );
}
