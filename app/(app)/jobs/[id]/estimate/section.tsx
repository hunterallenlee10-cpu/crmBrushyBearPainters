import Link from "next/link";
import { FileCheck2, FileDown, Palette, Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  CHANGE_ORDER_STATUS_LABELS,
  ESTIMATE_STATUS_LABELS,
  VERSION_STATUS_LABELS,
  type ChangeOrderStatus,
  type EstimateStatus,
  type VersionStatus,
} from "@/lib/estimating/engine";
import { formatDate } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import {
  ColorsTable,
  FieldChangeOrderButton,
  NewChangeOrderButton,
  NewEstimateButton,
} from "./section-client";

const tone = (s: string) =>
  s === "accepted" || s === "signed"
    ? "success"
    : s === "draft"
      ? "neutral"
      : s === "declined" || s === "expired"
        ? "danger"
        : s === "superseded"
          ? "outline"
          : "info";

/**
 * Job → Estimate & Scope (SPEC §8.5 #4): estimates and their versions, the
 * color schedule, change orders and the signed documents. Self-loading with
 * the person's own client, so row security decides what shows.
 */
export async function EstimateSection({
  jobId,
  can,
}: {
  jobId: string;
  can: {
    readEstimates: boolean;
    editEstimates: boolean;
    sendEstimates: boolean;
    draftChangeOrders: boolean;
    readDocuments: boolean;
  };
}) {
  const supabase = await createSupabaseServerClient();
  const none = Promise.resolve({ data: null, error: null });
  const [estimates, colors, cos, docs, products, sheens, brands] = await Promise.all([
    can.readEstimates
      ? supabase
          .from("estimates")
          .select(
            "id, estimate_number, title, status, total_cents, sent_at, viewed_at, accepted_at, expires_at, current_version_id, accepted_version_id, created_at, estimate_versions!estimate_versions_estimate_id_fkey(id, version_no, status, sent_at)",
          )
          .eq("job_id", jobId)
          .is("deleted_at", null)
          .order("created_at")
      : none,
    supabase
      .from("color_selections")
      .select(
        "id, area, surface, brand, color_name, color_code, sheen, paint_product_id, finish_notes, status, sort_order",
      )
      .eq("job_id", jobId)
      .order("sort_order")
      .limit(200),
    can.readEstimates
      ? supabase
          .from("change_orders")
          .select(
            "id, change_order_number, title, status, total_cents, created_from_field, sent_at, signed_at, created_at",
          )
          .eq("job_id", jobId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      : none,
    can.readDocuments
      ? supabase
          .from("documents")
          .select("id, title, category, status, created_at")
          .eq("job_id", jobId)
          .in("category", ["proposal", "contract", "change_order"])
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50)
      : none,
    supabase
      .from("paint_products")
      .select("id, product, sheens, is_primer")
      .is("deleted_at", null)
      .eq("active", true),
    supabase
      .from("picklist_values")
      .select("value, label, sort_order, picklists!inner(key)")
      .eq("picklists.key", "sheen")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("picklist_values")
      .select("value, label, sort_order, picklists!inner(key)")
      .eq("picklists.key", "paint_brand")
      .eq("active", true)
      .order("sort_order"),
  ]);

  const estList = estimates.data ?? [];
  const coList = cos.data ?? [];
  const docList = docs.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {can.readEstimates && (
        <section aria-labelledby="est-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="est-h" className="text-lg font-semibold">
              Estimates
            </h2>
            {can.editEstimates && estList.length > 0 && (
              <NewEstimateButton jobId={jobId} label="Another estimate" variant="outline" />
            )}
          </div>
          {estList.length === 0 ? (
            <EmptyState
              icon={Ruler}
              title="No estimate yet"
              action={can.editEstimates ? <NewEstimateButton jobId={jobId} /> : undefined}
            >
              <p>
                Build the estimate room by room after the walkthrough: options, add-ons, colors and
                a live total. Then send it for signature from the builder.
              </p>
            </EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {estList.map((e) => {
                const versions = [...(e.estimate_versions ?? [])].sort(
                  (a, b) => b.version_no - a.version_no,
                );
                const current = versions.find((v) => v.id === e.current_version_id) ?? versions[0];
                return (
                  <li key={e.id} className="rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {e.estimate_number}
                          {e.title ? ` · ${e.title}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {e.sent_at
                            ? `Sent ${formatDate(e.sent_at)}`
                            : `Started ${formatDate(e.created_at)}`}
                          {e.viewed_at ? ` · viewed ${formatDate(e.viewed_at)}` : ""}
                          {e.accepted_at ? ` · accepted ${formatDate(e.accepted_at)}` : ""}
                          {!e.accepted_at && e.expires_at
                            ? ` · expires ${formatDate(e.expires_at)}`
                            : ""}
                        </p>
                      </div>
                      <Badge variant={tone(e.status)}>
                        {ESTIMATE_STATUS_LABELS[e.status as EstimateStatus] ?? e.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-2xl font-bold tabular-nums">
                      {e.total_cents === null ? "—" : formatCents(e.total_cents)}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {versions.map((v) => (
                        <li key={v.id}>
                          <Link
                            href={`/jobs/${jobId}/estimate/${v.id}`}
                            className="inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs hover:bg-bb-cream-light"
                          >
                            v{v.version_no} ·{" "}
                            {VERSION_STATUS_LABELS[v.status as VersionStatus] ?? v.status}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {current && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild className="h-11 sm:h-9">
                          <Link href={`/jobs/${jobId}/estimate/${current.id}`}>
                            {current.status === "draft" && can.editEstimates
                              ? "Open builder"
                              : "View estimate"}
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="h-11 sm:h-9">
                          <a
                            href={`/jobs/${jobId}/estimate/${current.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileDown aria-hidden />
                            PDF
                          </a>
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="colors-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="colors-h" className="flex items-center gap-2 text-lg font-semibold">
            <Palette className="size-5 text-bb-forest" aria-hidden />
            Colors
          </h2>
          {(colors.data ?? []).length > 0 && (
            <Button asChild variant="outline" className="h-11 sm:h-9">
              <a href={`/jobs/${jobId}/color-sheet`} target="_blank" rel="noreferrer">
                <FileDown aria-hidden />
                Color sheet PDF
              </a>
            </Button>
          )}
        </div>
        <ColorsTable
          jobId={jobId}
          canEdit={can.editEstimates}
          rows={(colors.data ?? []).map((c) => ({
            id: c.id,
            area: c.area,
            surface: c.surface,
            brand: c.brand,
            colorName: c.color_name,
            colorCode: c.color_code,
            sheen: c.sheen,
            productId: c.paint_product_id,
            notes: c.finish_notes,
            confirmed: c.status === "confirmed",
          }))}
          products={(products.data ?? [])
            .filter((p) => !p.is_primer)
            .map((p) => ({ id: p.id, label: p.product, sheens: p.sheens }))}
          sheens={(sheens.data ?? []).map((s) => ({ value: s.value, label: s.label }))}
          brands={(brands.data ?? []).map((b) => ({ value: b.value, label: b.label }))}
        />
      </section>

      {(can.readEstimates || can.draftChangeOrders) && (
        <section aria-labelledby="co-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="co-h" className="text-lg font-semibold">
              Change orders
            </h2>
            <div className="flex flex-wrap gap-2">
              {can.draftChangeOrders && <FieldChangeOrderButton jobId={jobId} />}
              {can.editEstimates && <NewChangeOrderButton jobId={jobId} />}
            </div>
          </div>
          {!can.readEstimates ? (
            <p className="text-sm text-muted-foreground">
              Found something that changes the scope? Report it and an owner prices it.
            </p>
          ) : coList.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No change orders. Extra work found on the job (or work removed) goes here, and the
              customer signs it like the estimate.
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {coList.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/jobs/${jobId}/change-orders/${c.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-bb-cream-light"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {c.change_order_number} · {c.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.created_from_field ? "From the field · " : ""}
                        {c.signed_at
                          ? `Signed ${formatDate(c.signed_at)}`
                          : c.sent_at
                            ? `Sent ${formatDate(c.sent_at)}`
                            : `Started ${formatDate(c.created_at)}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-sm tabular-nums">{formatCents(c.total_cents)}</span>
                      <Badge variant={tone(c.status)}>
                        {CHANGE_ORDER_STATUS_LABELS[c.status as ChangeOrderStatus] ?? c.status}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {can.readDocuments && docList.length > 0 && (
        <section aria-labelledby="docs-h" className="flex flex-col gap-3">
          <h2 id="docs-h" className="flex items-center gap-2 text-lg font-semibold">
            <FileCheck2 className="size-5 text-bb-forest" aria-hidden />
            Signed documents
          </h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {docList.map((d) => (
              <li key={d.id}>
                <a
                  href={`/jobs/${jobId}/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 hover:bg-bb-cream-light"
                >
                  <span className="text-sm font-medium">{d.title}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(d.created_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
