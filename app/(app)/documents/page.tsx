import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, CircleAlert, Clock, FileText, HardDrive, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/kpi/kpi-card";
import { NativeSelect } from "@/components/forms/native-select";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { DocumentList } from "@/components/documents/document-list";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  DOCUMENT_TABS,
  DOCUMENT_TYPE_FILTERS,
  isDocumentTab,
  isDocumentTypeFilter,
  tabCategories,
  tabCounts,
} from "@/lib/domain/documents";
import { DOCUMENT_COLUMNS, toDocumentItems } from "@/lib/documents/load";
import { logError } from "@/lib/log";
import {
  documentMetricValue,
  parseDocumentStats,
  type DocumentMetricId,
} from "@/lib/metrics/registry";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Documents" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 50;

const KPIS: { id: DocumentMetricId; icon: typeof FileText }[] = [
  { id: "documents.total", icon: FileText },
  { id: "documents.awaiting_signature", icon: PenLine },
  { id: "documents.needs_action", icon: CircleAlert },
  { id: "documents.linked_to_jobs", icon: Briefcase },
  { id: "documents.recent", icon: Clock },
  { id: "documents.storage_used", icon: HardDrive },
];

/**
 * Documents (SPEC §8.13): every document you can see with its linked job or
 * customer, filtered by category, type and title on the server (paginated),
 * with the KPIs from the metrics registry.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("documents:read");
  const sp = await searchParams;
  const tab = isDocumentTab(one(sp.tab))
    ? (one(sp.tab) as (typeof DOCUMENT_TABS)[number]["id"])
    : "all";
  const rawType = one(sp.type);
  const type = isDocumentTypeFilter(rawType) ? rawType : null;
  const q = (one(sp.q) ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const supabase = await createSupabaseServerClient();

  let list = supabase.from("documents").select(DOCUMENT_COLUMNS, { count: "exact" });
  const cats = tabCategories(tab);
  if (cats.length) list = list.in("category", [...cats]);
  if (type) list = list.in("mime_type", [...DOCUMENT_TYPE_FILTERS[type].mimes]);
  if (q) list = list.ilike("title", `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  const [stats, rows] = await Promise.all([
    supabase.rpc("document_stats", {}),
    list
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  if (stats.error) logError("documents.stats", stats.error);
  if (rows.error) throw rows.error;
  const s = parseDocumentStats(stats.data);
  const counts = tabCounts(s.by_category);
  const items = await toDocumentItems(supabase, rows.data ?? []);
  const total = rows.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: { tab?: string; page?: number }) => {
    const p = new URLSearchParams();
    const t = patch.tab ?? tab;
    if (t !== "all") p.set("tab", t);
    if (type) p.set("type", type);
    if (q) p.set("q", q);
    if (patch.page && patch.page > 1) p.set("page", String(patch.page));
    const qs = p.toString();
    return `/documents${qs ? `?${qs}` : ""}`;
  };
  const filtered = tab !== "all" || type || q;

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="Proposals, contracts, color sheets and uploads across every job and customer. Upload from the job's Documents section."
      />
      <section
        aria-label="Document KPIs"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
      >
        {KPIS.map(({ id, icon }) => {
          const m = documentMetricValue(id, s);
          return (
            <KpiCard key={id} label={m.label} value={m.display} caption={m.caption} icon={icon} />
          );
        })}
      </section>
      <nav aria-label="Category" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex gap-1 border-b">
          {DOCUMENT_TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={href({ tab: t.id, page: 1 })}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1 border-b-2 px-3 text-sm whitespace-nowrap",
                  tab === t.id
                    ? "border-bb-forest font-semibold text-bb-forest"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                  {counts[t.id]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form
        method="get"
        className="flex flex-wrap items-end gap-2"
        role="search"
        aria-label="Filter documents"
      >
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Search titles</span>
          <Input name="q" defaultValue={q} placeholder="HOA approval, receipt…" />
        </label>
        <label className="flex w-48 flex-col gap-1 text-sm">
          <span className="font-medium">Type</span>
          <NativeSelect name="type" defaultValue={type ?? ""}>
            <option value="">All types</option>
            {Object.entries(DOCUMENT_TYPE_FILTERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {filtered && (
          <Link href="/documents" className="px-2 py-2 text-sm text-bb-forest underline">
            Clear
          </Link>
        )}
      </form>
      <DocumentList
        items={items}
        canManage={viewer.can("documents:manage") && !viewer.impersonating}
        showLinked
        showTabs={false}
        emptyTitle={filtered ? "Nothing matches" : "No documents yet"}
        emptyText={
          filtered
            ? "No documents match these filters."
            : "Signed proposals and contracts land here when customers sign. Upload HOA approvals, lead-safe acknowledgments and receipts from a job's Documents section."
        }
      />
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {total} documents
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link className="rounded-md border px-3 py-2" href={href({ page: page - 1 })}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link className="rounded-md border px-3 py-2" href={href({ page: page + 1 })}>
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </PageContainer>
  );
}
