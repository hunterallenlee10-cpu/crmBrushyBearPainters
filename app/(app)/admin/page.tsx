import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { visibleAdminSections } from "@/lib/admin-sections";

export const metadata: Metadata = { title: "Setup" };

export default async function AdminHomePage() {
  const viewer = await requireViewer();
  const sections = visibleAdminSections((p) => viewer.can(p));
  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Setup" description="Everything an owner configures, in one place." />
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {group}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sections
              .filter((s) => s.group === group)
              .map((s) => {
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    className="rounded-2xl transition-colors hover:[&>div]:border-bb-forest/40"
                  >
                    <div className="flex h-full flex-col gap-1 rounded-2xl border bg-card p-4">
                      <p className="font-semibold">{s.label}</p>
                      <p className="text-sm text-muted-foreground">{s.description}</p>
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
