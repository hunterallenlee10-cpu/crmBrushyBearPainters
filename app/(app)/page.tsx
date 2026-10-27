import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { readPreferences, roleDefaultHome } from "@/lib/validation/users";
import { ExecutiveOverview } from "@/components/analytics/executive-overview";
import { MyDay } from "@/components/analytics/my-day";

export const metadata: Metadata = { title: "Home" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home (SPEC §8.2, §8.3): the Executive Overview for owners, My Day for
 * everyone else, unless the person picked another default in Settings →
 * Preferences. `?view=executive` / `?view=my_day` switch for one visit. The
 * Executive Overview needs analytics:read.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const asked = Array.isArray(params.view) ? params.view[0] : params.view;
  const canExecutive = viewer.can("analytics:read");
  let home: "executive_overview" | "my_day";
  if (asked === "executive" || asked === "my_day") {
    home = asked === "executive" ? "executive_overview" : "my_day";
  } else {
    const db = await createSupabaseServerClient();
    const { data } = await db
      .from("profiles")
      .select("preferences")
      .eq("id", viewer.id)
      .maybeSingle();
    home = readPreferences(data?.preferences, roleDefaultHome(viewer.isOwner)).default_home;
  }
  if (home === "executive_overview" && canExecutive) {
    return <ExecutiveOverview viewer={viewer} params={params} />;
  }
  return <MyDay viewer={viewer} params={params} />;
}
