import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  AUDIT_PAGE_SIZE,
  actorLabel,
  auditLogHref,
  diffAuditEntry,
  hasAuditFilters,
  paginateAudit,
  parseAuditSearchParams,
  planAuditPage,
  summarizeAuditEntry,
  tableLabel,
  type SearchParams,
} from "@/lib/admin/audit-format";
import { formatPacific, pacificDateRangeToUtc } from "@/lib/admin/pacific";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AuditFiltersForm } from "./audit-filters";
import { ExportListButton } from "@/components/lists/export-list-button";
import { AuditRows, type AuditRowView } from "./audit-rows-client";

export const metadata: Metadata = { title: "Audit Log" };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requirePermission("audit:read");
  const { filters, cursor } = parseAuditSearchParams(await searchParams);
  const supabase = await createSupabaseServerClient();
  const plan = planAuditPage(cursor);

  let query = supabase
    .from("audit_log")
    .select(
      "id, at, table_name, record_id, action, actor_id, impersonated_by, before, after, changed_fields, ip",
    )
    .eq("org_id", viewer.orgId);
  if (filters.table) query = query.eq("table_name", filters.table);
  if (filters.action) query = query.eq("action", filters.action);
  // Validated as a UUID by parseAuditSearchParams, so it is safe inside the or() filter.
  if (filters.actor)
    query = query.or(`actor_id.eq.${filters.actor},impersonated_by.eq.${filters.actor}`);
  if (filters.record) query = query.eq("record_id", filters.record);
  const range = pacificDateRangeToUtc(filters.from, filters.to);
  if (range.gte) query = query.gte("at", range.gte);
  if (range.lt) query = query.lt("at", range.lt);
  if (plan.ltId !== undefined) query = query.lt("id", plan.ltId);
  if (plan.gtId !== undefined) query = query.gt("id", plan.gtId);

  const [{ data: fetched, error }, { data: profiles }] = await Promise.all([
    query.order("id", { ascending: plan.ascending }).limit(plan.limit),
    supabase
      .from("profiles")
      .select("id, full_name, is_active")
      .eq("org_id", viewer.orgId)
      .order("full_name")
      .limit(500),
  ]);

  const page = paginateAudit(fetched ?? [], cursor);
  // Paging "Newer" all the way to the top lands on the normal first page.
  if (cursor.after !== undefined && !page.newer && !error) redirect(auditLogHref(filters));

  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    label: p.is_active ? p.full_name : `${p.full_name} (inactive)`,
  }));

  const rows: AuditRowView[] = page.rows.map((r) => ({
    id: r.id,
    when: formatPacific(r.at),
    who: actorLabel(r.actor_id, r.impersonated_by, names),
    what: summarizeAuditEntry(r, names),
    ip: typeof r.ip === "string" && r.ip ? r.ip : "—",
    table: tableLabel(r.table_name),
    recordId: r.record_id,
    changes: diffAuditEntry(r),
  }));

  const filtered = hasAuditFilters(filters);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit Log"
        description="Every change to setup and business records: who, what, when (Pacific time) and from where. Entries can't be edited or deleted."
        actions={
          viewer.can("data:export") && !viewer.impersonating ? (
            <ExportListButton list="audit_log" total={rows.length} />
          ) : (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Button variant="outline" size="sm" disabled aria-describedby="audit-export-note">
                <Download aria-hidden /> Export CSV
              </Button>
              <p id="audit-export-note" className="text-xs text-muted-foreground">
                {viewer.impersonating
                  ? "Exports are off while viewing as another user."
                  : "Your role can't export data. Ask an owner for export access."}
              </p>
            </div>
          )
        }
      />

      <AuditFiltersForm filters={filters} users={users} />

      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-danger/30 bg-danger-bg p-4 text-sm text-danger"
        >
          The audit log couldn&apos;t be loaded. Try again, and tell an owner if it keeps happening.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={filtered ? "No matching entries" : "No changes yet"}>
          {filtered
            ? "No audit entries match these filters. Widen the date range or clear a filter."
            : "Changes appear here as soon as anyone edits setup or records."}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Showing {rows.length} {rows.length === 1 ? "entry" : "entries"}, newest first
            {filtered ? " (filtered)" : ""}. {AUDIT_PAGE_SIZE} per page.
          </p>
          <AuditRows rows={rows} />
        </>
      )}

      {(page.newer || page.older) && (
        <nav aria-label="Audit log pages" className="flex items-center justify-between gap-2">
          {page.newer ? (
            <Button asChild variant="outline" size="sm">
              <Link href={auditLogHref(filters, page.newer)} rel="prev">
                <ChevronLeft aria-hidden /> Newer
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {page.older ? (
            <Button asChild variant="outline" size="sm">
              <Link href={auditLogHref(filters, page.older)} rel="next">
                Older <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
