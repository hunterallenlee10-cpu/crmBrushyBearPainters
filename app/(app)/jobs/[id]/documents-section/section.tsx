import { CircleAlert, Clock, FilePlus2, FileText, HardDrive, PenLine } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { DocumentList } from "@/components/documents/document-list";
import { createSupabaseServerClient } from "@/lib/db/server";
import { DOCUMENT_COLUMNS, toDocumentItems } from "@/lib/documents/load";
import { documentMetricValue, parseDocumentStats } from "@/lib/metrics/registry";
import { NoAccess } from "../_sections/section-card";

/**
 * Job → Documents (SPEC §8.5 #7): KPI tiles from the metrics registry, the
 * job's documents and the customer's own (not on a job), with upload,
 * preview, rename, recategorize, move and delete.
 */
export async function DocumentsSection({
  jobId,
  accountId,
  canRead,
  canManage,
}: {
  jobId: string;
  accountId: string | null;
  canRead: boolean;
  canManage: boolean;
}) {
  if (!canRead) return <NoAccess>Your role can&apos;t see this job&apos;s documents.</NoAccess>;
  const supabase = await createSupabaseServerClient();
  const [docs, customerDocs, stats, jobs] = await Promise.all([
    supabase
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(200),
    accountId
      ? supabase
          .from("documents")
          .select(DOCUMENT_COLUMNS)
          .eq("account_id", accountId)
          .is("job_id", null)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    supabase.rpc("document_stats", { p_job: jobId }),
    accountId
      ? supabase
          .from("jobs")
          .select("id, job_number, name")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const items = await toDocumentItems(supabase, docs.data ?? []);
  const customer = await toDocumentItems(supabase, customerDocs.data ?? []);
  const s = parseDocumentStats(stats.data);
  const v = (id: Parameters<typeof documentMetricValue>[0]) => documentMetricValue(id, s);
  const jobOptions = (jobs.data ?? []).map((j) => ({
    id: j.id,
    label: `${j.job_number} · ${j.name}`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={v("documents.total").label}
          value={v("documents.total").display}
          caption={v("documents.total").caption}
          icon={FileText}
        />
        <KpiCard
          label={v("documents.awaiting_signature").label}
          value={v("documents.awaiting_signature").display}
          caption={v("documents.awaiting_signature").caption}
          icon={PenLine}
          tone="info"
        />
        <KpiCard
          label={v("documents.needs_action").label}
          value={v("documents.needs_action").display}
          caption={v("documents.needs_action").caption}
          icon={CircleAlert}
          tone={s.needs_action ? "warning" : "neutral"}
          href={s.needs_action ? `/jobs/${jobId}?section=onboarding` : undefined}
          linkLabel="Checklist"
        />
        <KpiCard
          label={v("documents.recent").label}
          value={v("documents.recent").display}
          caption={v("documents.recent").caption}
          icon={Clock}
        />
        <KpiCard
          label={v("documents.storage_used").label}
          value={v("documents.storage_used").display}
          caption={v("documents.storage_used").caption}
          icon={HardDrive}
        />
      </div>
      <DocumentList
        items={items}
        canManage={canManage}
        uploadTarget={{ jobId }}
        jobOptions={jobOptions}
      />
      {customer.length > 0 && (
        <section aria-labelledby="customer-docs" className="flex flex-col gap-2">
          <h3
            id="customer-docs"
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <FilePlus2 className="size-4" aria-hidden /> On the customer (not linked to a job)
          </h3>
          <DocumentList
            items={customer}
            canManage={canManage}
            jobOptions={jobOptions}
            showTabs={false}
          />
        </section>
      )}
    </div>
  );
}
