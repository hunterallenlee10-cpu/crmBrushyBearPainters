import Link from "next/link";
import { StageBadge } from "@/components/layout/stage-badge";
import { formatMoney, formatPercent, type PipelineSnapshot } from "@/lib/metrics/registry";
import { stageHref } from "./links";

/** Pipeline Snapshot: every stage with jobs, value, a share bar and a total row. */
export function PipelineSnapshotTable({ snapshot }: { snapshot: PipelineSnapshot }) {
  const money = snapshot.totalValueCents !== null;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Jobs and value by stage</caption>
        <thead className="text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th scope="col" className="px-1 py-1.5">
              Stage
            </th>
            <th scope="col" className="px-1 py-1.5 text-right">
              Jobs
            </th>
            {money && (
              <th scope="col" className="px-1 py-1.5 text-right">
                Value
              </th>
            )}
            <th scope="col" className="w-1/3 px-1 py-1.5">
              <span className="sr-only">Share of jobs</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshot.rows.map((r) => (
            <tr key={r.stage} className="border-t">
              <th scope="row" className="px-1 py-1.5 text-left font-normal">
                <Link
                  href={stageHref(r.stage)}
                  className="rounded-full outline-none hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label={`${r.label}: ${r.jobs} job${r.jobs === 1 ? "" : "s"}. Open the list`}
                >
                  <StageBadge stage={r.stage} />
                </Link>
              </th>
              <td className="px-1 py-1.5 text-right tabular-nums">{r.jobs}</td>
              {money && (
                <td className="px-1 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {formatMoney(r.valueCents)}
                </td>
              )}
              <td className="px-1 py-1.5">
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  title={`${formatPercent(r.share)} of jobs`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((r.share ?? 0) * 100)}%`,
                      backgroundColor: r.color,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <th scope="row" className="px-1 py-2 text-left">
              Total
            </th>
            <td className="px-1 py-2 text-right tabular-nums">{snapshot.totalJobs}</td>
            {money && (
              <td className="px-1 py-2 text-right whitespace-nowrap tabular-nums">
                {formatMoney(snapshot.totalValueCents)}
              </td>
            )}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
