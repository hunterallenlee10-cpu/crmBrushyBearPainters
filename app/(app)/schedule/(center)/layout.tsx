import { requirePermission } from "@/lib/auth/viewer";
import { CenterNav, type CenterLink } from "./center-nav";

/** Production Center workspace (SPEC §8.6): a left sub-nav beside each screen. */
export default async function ProductionCenterLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePermission("schedule:read");
  const links: CenterLink[] = [
    { href: "/schedule", label: "Command Center" },
    { href: "/schedule/master", label: "Master Schedule" },
    { href: "/schedule/dispatch", label: "Field Dispatch" },
    { href: "/schedule/readiness", label: "Readiness Queue" },
    { href: "/schedule/crew-queue", label: "Crew Queue" },
    ...(viewer.can("paint_orders:manage")
      ? [{ href: "/schedule/paint-orders", label: "Paint Orders" }]
      : []),
    { href: "/schedule/exceptions", label: "Exceptions" },
    ...(viewer.can("schedule:manage")
      ? [{ href: "/schedule/recommendations", label: "Recommendations" }]
      : []),
    { href: "/schedule/resources", label: "Resources" },
    ...(viewer.can("work_orders:read")
      ? [{ href: "/schedule/work-orders", label: "Work Orders" }]
      : []),
    { href: "/schedule/weather", label: "Weather" },
    ...(viewer.can("jobs:read")
      ? [{ href: "/schedule/onboarding", label: "Onboarding Board" }]
      : []),
  ];
  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:gap-6">
      <aside className="lg:sticky lg:top-20 lg:h-fit lg:w-52 lg:shrink-0">
        <p className="mb-2 hidden px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">
          Production Center
        </p>
        <CenterNav links={links} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
