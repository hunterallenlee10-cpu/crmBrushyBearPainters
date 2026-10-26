import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { CURRENT_PHASE, visibleAdminSections } from "@/lib/admin-sections";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const sections = visibleAdminSections((p) => viewer.can(p));
  if (sections.length === 0) notFound();

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <aside className="lg:sticky lg:top-20 lg:h-fit lg:w-60 lg:shrink-0">
        <details className="rounded-2xl border bg-card p-3 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold">Setup sections</summary>
          <div className="pt-3">
            <AdminNav items={sections.map((s) => ({ ...s, built: s.phase <= CURRENT_PHASE }))} />
          </div>
        </details>
        <div className="hidden rounded-2xl border bg-card p-3 lg:block">
          <AdminNav items={sections.map((s) => ({ ...s, built: s.phase <= CURRENT_PHASE }))} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
