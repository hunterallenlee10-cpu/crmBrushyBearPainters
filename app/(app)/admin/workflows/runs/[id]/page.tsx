import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RetryRunButton } from "@/components/workflows/retry-button";
import { RunStatusBadge, StepOutcomeBadge } from "@/components/workflows/run-status";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { loadRun } from "@/lib/workflows/admin";

export const metadata: Metadata = { title: "Workflow run" };

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f-]{36}$/i;

function pretty(detail: string): string {
  return detail.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g, (iso) => formatDateTime(iso));
}

/** One run (SPEC §11.1 `workflow_runs`): input, every step, result and error. */
export default async function WorkflowRunPage({ params }: { params: Params }) {
  const viewer = await requirePermission("workflows:manage");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const run = await loadRun(supabase, id);
  if (!run) notFound();
  const input = run.input as { event?: { type?: string; payload?: Record<string, unknown> } } | null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={run.def ? `/admin/workflows/${run.def.key}` : "/admin/workflows"}
        className="flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> {run.def?.name ?? "Workflows"}
      </Link>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {run.dryRun ? "Test run" : "Run"} · {formatDateTime(run.createdAt)}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <RunStatusBadge status={run.status} />
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{run.eventType}</code>
            {run.subjectHref && (
              <Link href={run.subjectHref} className="underline">
                Open the {run.subjectType?.replace(/_/g, " ")}
              </Link>
            )}
          </p>
        </div>
        {run.status === "failed" && <RetryRunButton runId={run.id} disabled={viewer.impersonating} />}
      </div>

      {(run.result || run.error || run.waitReason) && (
        <div className={`rounded-2xl border p-4 text-sm ${run.error ? "border-danger/30 bg-danger-bg" : "bg-card"}`}>
          {run.status === "waiting" && run.resumeAt && (
            <p>
              Waiting until <strong>{formatDateTime(run.resumeAt)}</strong>
              {run.waitReason ? ` (${run.waitReason})` : ""}.
            </p>
          )}
          {run.result && <p>{run.result}</p>}
          {run.error && <p className="text-danger">Error: {run.error}</p>}
        </div>
      )}

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="font-semibold">Steps</h2>
        {run.steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No steps ran.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {run.steps
              .slice()
              .sort((a, b) => a.index - b.index)
              .map((s) => (
                <li key={`${s.index}-${s.id}`} className="rounded-xl border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{s.index + 1}.</span>
                    <span className="font-medium">{s.label}</span>
                    <StepOutcomeBadge outcome={s.outcome} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(s.at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{pretty(s.detail)}</p>
                </li>
              ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="input-heading">
        <h2 id="input-heading" className="font-semibold">Input</h2>
        <p className="mt-1 text-xs text-muted-foreground">The event that started it (ids only).</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs">
          {JSON.stringify(input?.event ?? run.input, null, 2)}
        </pre>
      </section>
    </div>
  );
}
