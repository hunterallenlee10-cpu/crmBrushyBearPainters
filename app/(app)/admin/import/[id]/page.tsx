import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { IMPORT_FIELDS, IMPORT_MODULE_LABELS, IMPORT_MODULES } from "@/lib/domain/imports";
import { ImportReview } from "./import-review";

export const metadata: Metadata = { title: "Import" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE = 100;
const FILTERS = ["all", "valid", "error", "duplicate", "applied", "skipped", "failed"] as const;

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("bulk:update");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f === sp.show) ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await createSupabaseServerClient();
  const { data: imp } = await db
    .from("imports")
    .select(
      "id, module, file_name, status, headers, mapping, options, total_rows, valid_rows, error_rows, duplicate_rows, applied_rows, skipped_rows, failed_rows, applied_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!imp) notFound();
  const mod = IMPORT_MODULES.find((m) => m === imp.module) ?? "leads";
  let rowsQuery = db
    .from("import_rows")
    .select(
      "id, row_number, raw, data, status, errors, duplicate_of, duplicate_reason, decision, record_id",
      { count: "exact" },
    )
    .eq("import_id", id)
    .order("row_number")
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (filter !== "all") rowsQuery = rowsQuery.eq("status", filter);
  const [{ data: rows, count }, custom] = await Promise.all([rowsQuery, loadCustomFields(db, mod)]);

  const fieldChoices = [
    ...IMPORT_FIELDS[mod].map((f) => ({ value: f.key, label: f.label })),
    ...custom
      .filter((c) => c.active)
      .map((c) => ({ value: `cf:${c.apiName}`, label: `${c.label} (custom)` })),
  ];
  const sample = (rows ?? [])[0]?.raw as Record<string, string> | undefined;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/import"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> All imports
      </Link>
      <PageHeader
        title={imp.file_name}
        description={`${IMPORT_MODULE_LABELS[mod]} · ${imp.total_rows.toLocaleString("en-US")} rows. Nothing is saved until you apply.`}
      />
      <ImportReview
        importId={imp.id}
        module={mod}
        status={imp.status}
        headers={imp.headers}
        mapping={(imp.mapping ?? {}) as Record<string, string>}
        duplicates={
          ((imp.options ?? {}) as { duplicates?: "skip" | "create" }).duplicates ?? "skip"
        }
        sample={sample ?? {}}
        fieldChoices={fieldChoices}
        counts={{
          total: imp.total_rows,
          valid: imp.valid_rows,
          error: imp.error_rows,
          duplicate: imp.duplicate_rows,
          applied: imp.applied_rows,
          skipped: imp.skipped_rows,
          failed: imp.failed_rows,
        }}
        rows={(rows ?? []).map((r) => ({
          id: r.id,
          rowNumber: r.row_number,
          label: describe(r.data as Record<string, unknown>, r.raw as Record<string, string>),
          status: r.status,
          errors: r.errors,
          duplicateOf: r.duplicate_of,
          duplicateReason: r.duplicate_reason,
          decision: r.decision,
          recordId: r.record_id,
        }))}
        filter={filter}
        page={page}
        pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}

function describe(data: Record<string, unknown>, raw: Record<string, string>): string {
  const name =
    (typeof data.display_name === "string" && data.display_name) ||
    [data.first_name, data.last_name].filter((x) => typeof x === "string" && x).join(" ");
  const extra = [data.email, data.mobile ?? data.phone, data.city]
    .filter((x) => typeof x === "string" && x)
    .join(" · ");
  if (name) return extra ? `${name} — ${extra}` : name;
  return Object.values(raw).filter(Boolean).slice(0, 3).join(" · ") || "(empty row)";
}
