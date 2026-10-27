"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Copy, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import type { ImportModule } from "@/lib/domain/imports";
import { cn } from "@/lib/utils";
import { applyImportAction, cancelImport, mapImport, setImportRowDecision } from "../actions";

type Row = {
  id: string;
  rowNumber: number;
  label: string;
  status: string;
  errors: string[];
  duplicateOf: string | null;
  duplicateReason: string | null;
  decision: string | null;
  recordId: string | null;
};

const RECORD_PATH: Record<ImportModule, string> = {
  leads: "/leads",
  accounts: "/accounts",
  contacts: "/contacts",
};

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "danger" | "warning" | "info" | "neutral" }
> = {
  pending: { label: "Not checked", variant: "neutral" },
  valid: { label: "Ready", variant: "success" },
  error: { label: "Needs a fix", variant: "danger" },
  duplicate: { label: "Duplicate?", variant: "warning" },
  applied: { label: "Added", variant: "success" },
  skipped: { label: "Skipped", variant: "neutral" },
  failed: { label: "Failed", variant: "danger" },
};

export function ImportReview(props: {
  importId: string;
  module: ImportModule;
  status: string;
  headers: string[];
  mapping: Record<string, string>;
  duplicates: "skip" | "create";
  sample: Record<string, string>;
  fieldChoices: { value: string; label: string }[];
  counts: Record<
    "total" | "valid" | "error" | "duplicate" | "applied" | "skipped" | "failed",
    number
  >;
  rows: Row[];
  filter: string;
  page: number;
  pages: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [mapping, setMapping] = React.useState(props.mapping);
  const [dupes, setDupes] = React.useState(props.duplicates);
  const editable = !props.readOnly && (props.status === "mapping" || props.status === "review");
  const reviewed = props.status !== "mapping";
  const toApply = props.counts.valid;

  const used = new Set(Object.values(mapping).filter(Boolean));
  const href = (show: string, page = 1) =>
    `/admin/import/${props.importId}?show=${show}${page > 1 ? `&page=${page}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      {editable && (
        <section className="rounded-2xl border bg-card p-5" aria-labelledby="map-heading">
          <h2 id="map-heading" className="text-base font-semibold">
            1. Match the columns
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            We guessed from the column names. Pick “Don’t import” for anything you don’t need.
            Consent to texts or marketing email is never imported; record it on the contact when the
            customer gives it.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Column in your file
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    First row
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    CRM field
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.headers.map((h, i) => (
                  <tr key={`${h}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{h || <em>(no name)</em>}</td>
                    <td className="max-w-48 truncate py-2 pr-3 text-muted-foreground">
                      {props.sample[h] ?? ""}
                    </td>
                    <td className="py-2">
                      <NativeSelect
                        aria-label={`CRM field for ${h || `column ${i + 1}`}`}
                        value={mapping[h] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                        className="sm:w-64"
                      >
                        <option value="">Don’t import</option>
                        {props.fieldChoices.map((f) => (
                          <option
                            key={f.value}
                            value={f.value}
                            disabled={used.has(f.value) && mapping[h] !== f.value}
                          >
                            {f.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset className="mt-4 flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">
              Rows that look like a record you already have
            </legend>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
              <input
                type="radio"
                name="dupes"
                checked={dupes === "skip"}
                onChange={() => setDupes("skip")}
              />
              Skip them (you can still add one by one below)
            </label>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
              <input
                type="radio"
                name="dupes"
                checked={dupes === "create"}
                onChange={() => setDupes("create")}
              />
              Add them anyway
            </label>
          </fieldset>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => cancelImport({ id: props.importId }), {
                  success: "Import canceled.",
                  onOk: () => router.push("/admin/import"),
                })
              }
            >
              Cancel import
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    mapImport({
                      id: props.importId,
                      mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
                      duplicates: dupes,
                    }),
                  {
                    success: (d) =>
                      `${d.valid} ready, ${d.errors} need a fix, ${d.duplicates} possible duplicates.`,
                    onOk: () => router.refresh(),
                  },
                )
              }
            >
              {reviewed ? "Check the rows again" : "Check the rows"}
            </Button>
          </div>
        </section>
      )}

      {reviewed && (
        <section className="rounded-2xl border bg-card p-5" aria-labelledby="review-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="review-heading" className="text-base font-semibold">
                {props.status === "applied" ? "Result" : "2. Review the rows"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {props.status === "applied"
                  ? `${props.counts.applied} added, ${props.counts.skipped} skipped, ${props.counts.failed} failed.`
                  : "Fix rows that need it in your file and upload again, or apply the rows that are ready."}
              </p>
            </div>
            {props.status === "review" && !props.readOnly && (
              <Button
                variant="cta"
                disabled={pending || toApply + props.counts.duplicate === 0}
                onClick={() =>
                  run(() => applyImportAction({ id: props.importId }), {
                    success: (d) => `${d.applied} added, ${d.skipped} skipped, ${d.failed} failed.`,
                    onOk: () => router.refresh(),
                  })
                }
              >
                <Play aria-hidden /> Apply import
              </Button>
            )}
          </div>
          <nav aria-label="Filter rows" className="mb-3 flex flex-wrap gap-2 text-sm">
            {(
              [
                ["all", `All ${props.counts.total}`],
                ["valid", `Ready ${props.counts.valid}`],
                ["error", `Need a fix ${props.counts.error}`],
                ["duplicate", `Duplicates ${props.counts.duplicate}`],
                ...(props.status === "applied"
                  ? ([
                      ["applied", `Added ${props.counts.applied}`],
                      ["skipped", `Skipped ${props.counts.skipped}`],
                      ["failed", `Failed ${props.counts.failed}`],
                    ] as const)
                  : []),
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={href(key)}
                aria-current={props.filter === key ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-3 sm:min-h-8",
                  props.filter === key
                    ? "border-bb-forest bg-bb-forest text-white"
                    : "hover:bg-muted",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          {props.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No rows here.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {props.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                    #{r.rowNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{r.label}</p>
                    {r.errors.length > 0 && (
                      <ul className="mt-1 text-xs text-danger">
                        {r.errors.map((e) => (
                          <li key={e} className="flex items-center gap-1">
                            <CircleAlert className="size-3" aria-hidden /> {e}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.duplicateReason && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Copy className="size-3" aria-hidden /> {r.duplicateReason}
                        {r.duplicateOf && (
                          <Link
                            href={`${RECORD_PATH[props.module]}/${r.duplicateOf}`}
                            className="text-bb-forest underline"
                          >
                            Open it
                          </Link>
                        )}
                      </p>
                    )}
                    {r.recordId && (
                      <Link
                        href={`${RECORD_PATH[props.module]}/${r.recordId}`}
                        className="text-xs text-bb-forest underline"
                      >
                        Open the new record
                      </Link>
                    )}
                  </div>
                  <Badge variant={STATUS_BADGE[r.status]?.variant ?? "neutral"}>
                    {r.status === "applied" ? (
                      <CheckCircle2 aria-hidden />
                    ) : r.status === "failed" ? (
                      <XCircle aria-hidden />
                    ) : null}
                    {STATUS_BADGE[r.status]?.label ?? r.status}
                  </Badge>
                  {r.status === "duplicate" && props.status === "review" && !props.readOnly && (
                    <NativeSelect
                      aria-label={`What to do with row ${r.rowNumber}`}
                      value={r.decision ?? "skip"}
                      className="w-36"
                      onChange={(e) =>
                        run(
                          () =>
                            setImportRowDecision({
                              id: r.id,
                              decision: e.target.value as "create" | "skip",
                            }),
                          {
                            onOk: () => router.refresh(),
                          },
                        )
                      }
                    >
                      <option value="skip">Skip</option>
                      <option value="create">Add anyway</option>
                    </NativeSelect>
                  )}
                </li>
              ))}
            </ul>
          )}
          {props.pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              {props.page > 1 && (
                <Link className="underline" href={href(props.filter, props.page - 1)}>
                  Previous
                </Link>
              )}
              <span>
                Page {props.page} of {props.pages}
              </span>
              {props.page < props.pages && (
                <Link className="underline" href={href(props.filter, props.page + 1)}>
                  Next
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
