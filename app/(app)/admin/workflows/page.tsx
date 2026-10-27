import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Clock, PlayCircle, Workflow } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { RunStatusBadge } from "@/components/workflows/run-status";
import { WorkflowSwitch } from "@/components/workflows/workflow-switch";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatRelative } from "@/lib/format/dates";
import {
  communicationMetricValue,
  parseCommunicationStats,
  type CommunicationMetricId,
} from "@/lib/metrics/registry";
import { loadRecentRuns, loadWorkflowList } from "@/lib/workflows/admin";

export const metadata: Metadata = { title: "Workflows" };

const KPIS: { id: CommunicationMetricId; icon: typeof Workflow; tone: "brand" | "info" | "danger" }[] = [
  { id: "workflows.runs", icon: PlayCircle, tone: "brand" },
  { id: "workflows.waiting", icon: Clock, tone: "info" },
  { id: "workflows.failed", icon: AlertTriangle, tone: "danger" },
];

/**
 * Admin → Workflows (SPEC §11.1, §11.2): the 17 system workflows with their
 * trigger, run count, last run and on/off switch. Each opens its steps, a Test
 * (dry run against a record) and its run history.
 */
export default async function WorkflowsPage() {
  const viewer = await requirePermission("workflows:manage");
  const supabase = await createSupabaseServerClient();
  const from = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString();
  const [rows, statsRes, failed] = await Promise.all([
    loadWorkflowList(supabase),
    supabase.rpc("communication_stats", { p_from: from }),
    loadRecentRuns(supabase, { status: "failed", limit: 5 }),
  ]);
  const stats = parseCommunicationStats(statsRes.data);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workflows"
        description="System workflows that run on their own when something happens. Each runs once per event; texts wait for 8:00 am during quiet hours; consent and Do Not Contact always apply. While texting and email aren't connected, every message goes to the outbox as “Simulated – not sent”."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {KPIS.map((k) => {
          const v = communicationMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={k.icon}
              tone={k.tone}
            />
          );
        })}
      </div>

      {failed.length > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-danger-bg p-4 text-sm" role="status">
          <p className="font-semibold text-danger">Runs that stopped on an error</p>
          <ul className="mt-2 flex flex-col gap-1">
            {failed.map((r) => (
              <li key={r.id}>
                <Link className="underline" href={`/admin/workflows/runs/${r.id}`}>
                  {r.eventType} · {formatRelative(r.createdAt)}
                </Link>
                {r.error ? ` — ${r.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">System workflows</caption>
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">Workflow</th>
              <th scope="col" className="px-3 py-2">Trigger</th>
              <th scope="col" className="px-3 py-2 text-right">Runs</th>
              <th scope="col" className="px-3 py-2">Last run</th>
              <th scope="col" className="px-3 py-2">On</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.def.key} className="border-b last:border-0 align-top">
                <td className="px-3 py-3 text-muted-foreground tabular-nums">{r.def.number}</td>
                <td className="px-3 py-3">
                  <Link href={`/admin/workflows/${r.def.key}`} className="font-medium text-bb-forest hover:underline">
                    {r.def.name}
                  </Link>
                  <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{r.def.description}</p>
                  {!r.enabled && r.disabledReason && (
                    <p className="mt-1 text-xs text-warning">Off: {r.disabledReason}</p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.def.triggerLabel}</code>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {r.runs}
                  {r.waiting > 0 && <span className="block text-xs text-muted-foreground">{r.waiting} waiting</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {r.lastRunAt ? (
                    <span className="flex flex-col gap-1">
                      <span>{formatRelative(r.lastRunAt)}</span>
                      {r.lastStatus && <RunStatusBadge status={r.lastStatus} />}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not yet</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-2">
                    <WorkflowSwitch
                      workflowKey={r.def.key}
                      name={r.def.name}
                      enabled={r.enabled}
                      readOnly={viewer.impersonating}
                    />
                    <Link href={`/admin/workflows/${r.def.key}#test`} className="text-xs text-bb-forest underline">
                      Test
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Wording lives in{" "}
        <Link href="/admin/templates" className="underline">
          Messaging &amp; Templates
        </Link>{" "}
        (all “Draft – owner to approve” until an owner approves them). Quiet hours and the
        review and referral delays are in Messaging settings.
      </p>
    </div>
  );
}
