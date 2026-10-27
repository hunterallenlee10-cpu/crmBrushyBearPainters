import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { PurgeDemoForm } from "./purge-form";

export const metadata: Metadata = { title: "Demo Data" };

const LABELS: Record<string, string> = {
  leads: "Leads",
  accounts: "Accounts",
  contacts: "Contacts",
  properties: "Properties",
  jobs: "Jobs",
  estimates: "Estimates",
  invoices: "Invoices",
  payments: "Payments",
  daily_logs: "Daily logs",
  crews: "Crews",
  subcontractors: "Subcontractors",
  appointments: "Appointments",
  job_holds: "Holds",
  attention_items: "Attention items",
};

/** Admin → Demo Data (owners): what the demo script loaded, and a purge. */
export default async function DemoDataPage() {
  const viewer = await requireViewer();
  if (!viewer.isOwner) {
    return (
      <EmptyState icon={FlaskConical} title="Owners only">
        Only owners can see and remove demo data.
      </EmptyState>
    );
  }
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const { data } = await service.rpc("demo_data_counts", { p_org: viewer.orgId });
  const counts = (data ?? {}) as Record<string, number>;
  const total = Object.values(counts).reduce((s, n) => s + Number(n), 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Demo Data"
        description="Sample records for training and screenshots, loaded with `pnpm seed:demo` on a test copy of the CRM. Every demo record is tagged, so it can be removed without touching real work."
      />
      {total === 0 ? (
        <EmptyState icon={FlaskConical} title="No demo data here">
          This company has no demo records. Demo data is never loaded into the live CRM (the script
          refuses), so there is nothing to purge.
        </EmptyState>
      ) : (
        <>
          <section className="rounded-2xl border bg-card p-5" aria-labelledby="demo-counts">
            <h2 id="demo-counts" className="mb-3 text-base font-semibold">
              Demo records
            </h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(counts)
                .filter(([, n]) => Number(n) > 0)
                .map(([k, n]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{LABELS[k] ?? k}</dt>
                    <dd className="text-xl font-bold tabular-nums">
                      {Number(n).toLocaleString("en-US")}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
          {!viewer.impersonating && <PurgeDemoForm />}
        </>
      )}
    </div>
  );
}
