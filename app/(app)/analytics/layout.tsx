import { requirePermission } from "@/lib/auth/viewer";
import { CenterNav, type CenterLink } from "@/app/(app)/schedule/(center)/center-nav";

/** Analytics workspace (SPEC §8.14): a left sub-nav beside each screen. */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePermission("analytics:read");
  const links: CenterLink[] = [
    { href: "/analytics", label: "Overview" },
    { href: "/analytics/dashboards", label: "Dashboards" },
    ...(viewer.can("reports:read") ? [{ href: "/analytics/reports", label: "Reports" }] : []),
    ...(viewer.can("reports:build") ? [{ href: "/analytics/schedules", label: "Schedules" }] : []),
  ];
  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:gap-6">
      <aside className="lg:sticky lg:top-20 lg:h-fit lg:w-52 lg:shrink-0">
        <p className="mb-2 hidden px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">
          Analytics
        </p>
        <CenterNav links={links} label="Analytics" exact="/analytics" />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
