"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Play, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AdvancedFilter } from "@/components/lists/advanced-filter";
import { toBase64Url, type FieldDef } from "@/lib/lists/filters";
import {
  BUCKET_LABELS,
  CHART_LABELS,
  CHART_TYPES,
  GROUP_BUCKETS,
  SUMMARY_FNS,
  SUMMARY_LABELS,
  type ReportConfig,
} from "@/lib/domain/reports/config";
import type { ReportModuleId } from "@/lib/domain/reports/modules";
import { saveReport } from "../../actions";

/**
 * Report builder (SPEC §8.14): module, columns, filters, grouping, summary,
 * chart type, sort. "Run" previews on the server with the draft in the URL;
 * "Save" stores it as your report (a template or someone else's report is
 * saved as a copy).
 */

type Col = { id: string; label: string; groupable: boolean; numeric: boolean; date: boolean };

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

export function ReportBuilder({
  reportId,
  moduleId,
  modules,
  columns,
  fields,
  config,
  name,
  description,
  shared,
  mine,
  canSave,
}: {
  reportId: string | null;
  moduleId: ReportModuleId;
  modules: { id: ReportModuleId; label: string }[];
  columns: Col[];
  fields: FieldDef[];
  config: ReportConfig;
  name: string;
  description: string;
  shared: boolean;
  mine: boolean;
  canSave: boolean;
}) {
  const router = useRouter();
  const [c, setC] = React.useState<ReportConfig>(config);
  const [title, setTitle] = React.useState(
    reportId && mine ? name : reportId ? `${name} (copy)` : "",
  );
  const [desc, setDesc] = React.useState(description);
  const [isShared, setShared] = React.useState(shared);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setC(config), [config]);

  const col = (id: string) => columns.find((x) => x.id === id);
  const groupCol = c.groupBy ? col(c.groupBy.field) : undefined;
  const path =
    reportId && mine
      ? `/analytics/reports/${reportId}`
      : reportId
        ? `/analytics/reports/${reportId}`
        : "/analytics/reports/new";

  function run(next: ReportConfig = c) {
    const qs = new URLSearchParams();
    if (!reportId) qs.set("module", moduleId);
    qs.set("c", toBase64Url(JSON.stringify(next)));
    startTransition(() => router.push(`${path}?${qs.toString()}`, { scroll: false }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveReport({
        id: reportId && mine ? reportId : undefined,
        name: title,
        description: desc,
        module: moduleId,
        config: c,
        shared: isShared,
      });
      if (!res.ok) {
        setError(
          res.error.fieldErrors
            ? (Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message)
            : res.error.message,
        );
        return;
      }
      toast.success("Report saved.");
      router.push(`/analytics/reports/${res.data.id}`);
    });
  }

  const move = (i: number, d: -1 | 1) =>
    setC((x) => {
      const cols = [...x.columns];
      const j = i + d;
      if (j < 0 || j >= cols.length) return x;
      [cols[i], cols[j]] = [cols[j]!, cols[i]!];
      return { ...x, columns: cols };
    });

  return (
    <details className="group rounded-2xl border bg-card" open={!reportId}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
        Customize this report
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">
          Columns, filters, grouping, summary, chart
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">
        <div className="flex flex-wrap items-end gap-3">
          {!reportId && (
            <div className="flex flex-col gap-1">
              <label htmlFor="rb-module" className="text-xs font-medium text-muted-foreground">
                Module
              </label>
              <select
                id="rb-module"
                className={selectClass}
                value={moduleId}
                onChange={(e) => router.push(`/analytics/reports/new?module=${e.target.value}`)}
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Filters</span>
            <div className="flex items-center gap-2">
              <AdvancedFilter
                fields={fields}
                filter={c.filter}
                onApply={(f) => setC((x) => ({ ...x, filter: f }))}
              />
              {c.filter.rules.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setC((x) => ({ ...x, filter: { match: "all", rules: [] } }))}
                >
                  <X aria-hidden />
                  Clear
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rb-group" className="text-xs font-medium text-muted-foreground">
              Group by
            </label>
            <select
              id="rb-group"
              className={selectClass}
              value={c.groupBy?.field ?? ""}
              onChange={(e) => {
                const f = e.target.value;
                const date = col(f)?.date;
                setC((x) => ({
                  ...x,
                  groupBy: f ? { field: f, ...(date ? { bucket: "month" as const } : {}) } : null,
                  chart: f ? (x.chart === "table" ? "bar" : x.chart) : "table",
                }));
              }}
            >
              <option value="">No grouping</option>
              {columns
                .filter((x) => x.groupable)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
            </select>
          </div>
          {groupCol?.date && c.groupBy && (
            <div className="flex flex-col gap-1">
              <label htmlFor="rb-bucket" className="text-xs font-medium text-muted-foreground">
                By
              </label>
              <select
                id="rb-bucket"
                className={selectClass}
                value={c.groupBy.bucket ?? "month"}
                onChange={(e) =>
                  setC((x) => ({
                    ...x,
                    groupBy: x.groupBy && {
                      ...x.groupBy,
                      bucket: e.target.value as (typeof GROUP_BUCKETS)[number],
                    },
                  }))
                }
              >
                {GROUP_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {BUCKET_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="rb-chart" className="text-xs font-medium text-muted-foreground">
              Chart
            </label>
            <select
              id="rb-chart"
              className={selectClass}
              value={c.chart}
              disabled={!c.groupBy}
              onChange={(e) =>
                setC((x) => ({ ...x, chart: e.target.value as ReportConfig["chart"] }))
              }
            >
              {CHART_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CHART_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rb-sort" className="text-xs font-medium text-muted-foreground">
              Sort rows by
            </label>
            <div className="flex gap-1">
              <select
                id="rb-sort"
                className={selectClass}
                value={c.sort?.column ?? ""}
                onChange={(e) =>
                  setC((x) => ({
                    ...x,
                    sort: e.target.value
                      ? { column: e.target.value, dir: x.sort?.dir ?? "desc" }
                      : null,
                  }))
                }
              >
                <option value="">Default</option>
                {columns.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
              {c.sort && (
                <select
                  aria-label="Sort direction"
                  className={selectClass}
                  value={c.sort.dir}
                  onChange={(e) =>
                    setC((x) => ({
                      ...x,
                      sort: x.sort && { ...x.sort, dir: e.target.value === "asc" ? "asc" : "desc" },
                    }))
                  }
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              )}
            </div>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted-foreground">Summaries</legend>
          {c.summaries.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Summary ${i + 1}`}
                className={selectClass}
                value={s.fn}
                onChange={(e) =>
                  setC((x) => ({
                    ...x,
                    summaries: x.summaries.map((y, j) =>
                      j === i
                        ? {
                            fn: e.target.value as (typeof SUMMARY_FNS)[number],
                            field: e.target.value === "count" ? undefined : y.field,
                          }
                        : y,
                    ),
                  }))
                }
              >
                {SUMMARY_FNS.map((f) => (
                  <option key={f} value={f}>
                    {SUMMARY_LABELS[f]}
                  </option>
                ))}
              </select>
              {s.fn !== "count" && (
                <select
                  aria-label={`Summary ${i + 1} column`}
                  className={selectClass}
                  value={s.field ?? ""}
                  onChange={(e) =>
                    setC((x) => ({
                      ...x,
                      summaries: x.summaries.map((y, j) =>
                        j === i ? { ...y, field: e.target.value } : y,
                      ),
                    }))
                  }
                >
                  <option value="">Pick a column</option>
                  {columns
                    .filter((x) => (s.fn === "count_of" ? true : x.numeric))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                </select>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove summary ${i + 1}`}
                disabled={c.summaries.length <= 1}
                onClick={() =>
                  setC((x) => ({ ...x, summaries: x.summaries.filter((_, j) => j !== i) }))
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          {c.summaries.length < 6 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setC((x) => ({ ...x, summaries: [...x.summaries, { fn: "count" }] }))}
            >
              <Plus aria-hidden />
              Add summary
            </Button>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted-foreground">
            Columns ({c.columns.length})
          </legend>
          <ol className="flex flex-wrap gap-2">
            {c.columns.map((id, i) => (
              <li
                key={id}
                className="flex items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-3 text-xs"
              >
                {col(id)?.label ?? id}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${col(id)?.label ?? id} left`}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                >
                  <ArrowUp className="-rotate-90" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${col(id)?.label ?? id} right`}
                  onClick={() => move(i, 1)}
                  disabled={i === c.columns.length - 1}
                >
                  <ArrowDown className="-rotate-90" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${col(id)?.label ?? id}`}
                  disabled={c.columns.length <= 1}
                  onClick={() =>
                    setC((x) => ({ ...x, columns: x.columns.filter((y) => y !== id) }))
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          <select
            aria-label="Add a column"
            className={`${selectClass} w-fit`}
            value=""
            onChange={(e) =>
              e.target.value && setC((x) => ({ ...x, columns: [...x.columns, e.target.value] }))
            }
          >
            <option value="">Add a column…</option>
            {columns
              .filter((x) => !c.columns.includes(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
          </select>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => run()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            Run
          </Button>
        </div>

        {canSave && (
          <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="rb-name" className="text-xs font-medium text-muted-foreground">
                  Report name
                </label>
                <Input
                  id="rb-name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Exterior jobs sold in Bellevue"
                />
              </div>
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-bb-forest"
                  checked={isShared}
                  onChange={(e) => setShared(e.target.checked)}
                />
                Share with everyone who reads reports
              </label>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="rb-desc" className="text-xs font-medium text-muted-foreground">
                  Description (optional)
                </label>
                <Textarea
                  id="rb-desc"
                  rows={2}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  maxLength={500}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="cta"
              className="self-end"
              onClick={save}
              disabled={pending || !title.trim()}
            >
              <Save aria-hidden />
              {reportId && mine ? "Save changes" : "Save as my report"}
            </Button>
            {error && (
              <p className="text-sm text-danger sm:col-span-2" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
