import Link from "next/link";
import { ChartCard } from "@/components/kpi/chart-card";
import { ViewDataDialog } from "@/components/kpi/view-data-dialog";
import {
  LEAD_BREAKDOWN_CAPTIONS,
  formatPercent,
  type FunnelStep,
  type MetricValue,
} from "@/lib/metrics/registry";
import { funnelHref } from "./links";

/**
 * Conversion Funnel (SPEC §8.4): Lead → Contacted → Walkthrough → Converted.
 * Plain HTML bars, so every number is real text; widths are each step's share
 * of all leads from the metrics registry.
 */
export function ConversionFunnel({
  steps,
  rates,
  footer,
}: {
  steps: readonly FunnelStep[];
  /** Registry metrics for the three rates (Lead→Contact, Walkthrough, Conversion). */
  rates: readonly MetricValue[];
  footer: readonly MetricValue[];
}) {
  return (
    <ChartCard
      id="lead-funnel"
      title="Conversion Funnel"
      caption={LEAD_BREAKDOWN_CAPTIONS.funnel}
      action={
        <ViewDataDialog
          title="Conversion Funnel"
          description={`${LEAD_BREAKDOWN_CAPTIONS.funnel}. "From previous step" divides by the step before.`}
          columns={[
            { key: "step", label: "Step" },
            { key: "leads", label: "Leads", align: "right" },
            { key: "ofTotal", label: "% of all leads", align: "right" },
            { key: "fromPrevious", label: "From previous step", align: "right" },
          ]}
          rows={steps.map((s) => ({
            step: { text: s.label, href: funnelHref(s.key) },
            leads: s.leads,
            ofTotal: formatPercent(s.ofTotal),
            fromPrevious: s.fromPrevious === null ? null : formatPercent(s.fromPrevious),
          }))}
        />
      }
    >
      <ol className="flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={funnelHref(s.key)}
              className="group block rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-bb-ink group-hover:underline">{s.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-bb-ink">
                    {s.leads.toLocaleString("en-US")}
                  </span>
                  {i > 0 && <> · {formatPercent(s.ofTotal)}</>}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-bb-forest"
                  style={{ width: `${Math.round((s.ofTotal ?? 0) * 100)}%` }}
                />
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
        {rates.map((r) => (
          <div key={r.id} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">{r.label}</dt>
            <dd className="text-base font-semibold text-bb-ink tabular-nums">{r.display}</dd>
            <dd className="text-[11px] leading-snug text-muted-foreground">{r.caption}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
        {footer.map((m) => (
          <div key={m.id} className="flex flex-wrap gap-x-1">
            <dt>{m.label}:</dt>
            <dd>
              <span className="font-semibold text-bb-ink tabular-nums">{m.display}</span> ·{" "}
              {m.caption}
            </dd>
          </div>
        ))}
      </dl>
    </ChartCard>
  );
}
