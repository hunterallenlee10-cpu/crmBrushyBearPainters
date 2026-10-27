import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { BULK_FIELDS, BULK_MODULES } from "@/lib/domain/bulk";
import { formatCustomValue, type CustomValue } from "@/lib/domain/custom-fields";
import { formatDateTime } from "@/lib/format/dates";
import { BULK_STATUS } from "../statuses";
import { BulkControls } from "./bulk-controls";

export const metadata: Metadata = { title: "Bulk update" };

type Params = Promise<{ id: string }>;

const ROW_STATUS: Record<
  string,
  { label: string; variant: "info" | "success" | "warning" | "neutral" | "danger" }
> = {
  pending: { label: "Will change", variant: "info" },
  unchanged: { label: "Already set", variant: "neutral" },
  error: { label: "Can't change", variant: "danger" },
  applied: { label: "Changed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  reverted: { label: "Reverted", variant: "warning" },
  conflict: { label: "Left as is", variant: "warning" },
};

const PATH: Record<string, string> = {
  leads: "/leads",
  jobs: "/jobs",
  accounts: "/accounts",
  contacts: "/contacts",
};

export default async function BulkUpdateDetailPage({ params }: { params: Params }) {
  const viewer = await requirePermission("bulk:update");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data: bu } = await db
    .from("bulk_updates")
    .select(
      "id, module, source, title, status, total_rows, changed_rows, applied_rows, failed_rows, reverted_rows, conflict_rows, applied_at, reverted_at, revert_reason, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!bu) notFound();
  const mod = BULK_MODULES.find((m) => m === bu.module) ?? "leads";
  const [{ data: rows }, options, custom] = await Promise.all([
    db
      .from("bulk_update_rows")
      .select("id, row_number, record_id, label, before, after, status, error")
      .eq("bulk_update_id", id)
      .order("row_number")
      .limit(2000),
    loadLeadOptions(db),
    loadCustomFields(db, mod),
  ]);
  const labels = new Map<string, string>([
    ...options.users.map((u) => [u.value, u.label] as [string, string]),
    ...options.territories.map((t) => [t.value, t.label] as [string, string]),
    ...Object.values(options.picklists)
      .flat()
      .map((o) => [o.value, o.label] as [string, string]),
    ...BULK_FIELDS[mod].flatMap((f) =>
      (f.options ?? []).map((o) => [o.value, o.label] as [string, string]),
    ),
  ]);
  const show = (key: string, v: unknown): string => {
    if (key.startsWith("cf:")) {
      const def = custom.find((d) => d.apiName === key.slice(3));
      return def ? formatCustomValue(def, v as CustomValue, labels) : String(v ?? "—");
    }
    if (v === null || v === undefined || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ") || "—";
    return labels.get(String(v)) ?? String(v);
  };
  const fieldLabel = (key: string) =>
    key.startsWith("cf:")
      ? (custom.find((d) => d.apiName === key.slice(3))?.label ?? key)
      : (BULK_FIELDS[mod].find((f) => f.key === key)?.label ?? key);
  const diffs = (before: unknown, after: unknown) => {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = (after ?? {}) as Record<string, unknown>;
    const out: { field: string; from: string; to: string }[] = [];
    for (const [k, v] of Object.entries(a)) {
      if (k === "custom_field_values") {
        const bc = (b.custom_field_values ?? {}) as Record<string, unknown>;
        for (const [ck, cv] of Object.entries((v ?? {}) as Record<string, unknown>)) {
          out.push({
            field: fieldLabel(`cf:${ck}`),
            from: show(`cf:${ck}`, bc[ck]),
            to: show(`cf:${ck}`, cv),
          });
        }
      } else out.push({ field: fieldLabel(k), from: show(k, b[k]), to: show(k, v) });
    }
    return out;
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/bulk-update"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Bulk Update
      </Link>
      <PageHeader
        title={bu.title}
        description={
          bu.status === "preview"
            ? `Preview: ${bu.changed_rows} of ${bu.total_rows} records will change. Nothing has changed yet.`
            : bu.status === "applied"
              ? `Applied ${formatDateTime(bu.applied_at)}: ${bu.applied_rows} changed${bu.failed_rows ? `, ${bu.failed_rows} failed` : ""}.`
              : bu.status === "reverted"
                ? `Reverted ${formatDateTime(bu.reverted_at)}: ${bu.reverted_rows} back as they were${bu.conflict_rows ? `, ${bu.conflict_rows} left as is (changed since)` : ""}. Reason: ${bu.revert_reason ?? "—"}`
                : "Canceled. Nothing was changed."
        }
        actions={
          <Badge variant={BULK_STATUS[bu.status]?.variant ?? "neutral"}>
            {BULK_STATUS[bu.status]?.label ?? bu.status}
          </Badge>
        }
      />
      {!viewer.impersonating && (
        <BulkControls
          id={bu.id}
          status={bu.status}
          changed={bu.changed_rows}
          applied={bu.applied_rows}
        />
      )}
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="bulk-rows">
        <h2 id="bulk-rows" className="mb-3 text-base font-semibold">
          Records
        </h2>
        <ul className="divide-y rounded-xl border">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`${PATH[mod]}/${r.record_id}`}
                  className="text-sm font-medium text-bb-forest hover:underline"
                >
                  {r.label || r.record_id}
                </Link>
                <ul className="mt-1 text-xs">
                  {diffs(r.before, r.after).map((d) => (
                    <li key={d.field}>
                      <span className="text-muted-foreground">{d.field}:</span> {d.from} →{" "}
                      <strong>{d.to}</strong>
                    </li>
                  ))}
                </ul>
                {r.error && <p className="mt-1 text-xs text-danger">{r.error}</p>}
              </div>
              <Badge variant={ROW_STATUS[r.status]?.variant ?? "neutral"}>
                {ROW_STATUS[r.status]?.label ?? r.status}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
