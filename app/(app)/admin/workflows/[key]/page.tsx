import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge } from "@/components/workflows/run-status";
import { WorkflowSwitch } from "@/components/workflows/workflow-switch";
import { WorkflowTestPanel } from "@/components/workflows/test-panel";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { describeCondition } from "@/lib/domain/workflows/conditions";
import { getWorkflow, templatesUsed } from "@/lib/domain/workflows/catalog";
import { describeDuration } from "@/lib/domain/workflows/plan";
import { AUDIENCE_LABELS, type WorkflowAction } from "@/lib/domain/workflows/types";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import {
  loadRecentRuns,
  loadTestCandidates,
  loadWorkflowList,
  SUBJECT_WORDS,
  subjectHref,
} from "@/lib/workflows/admin";

type Params = Promise<{ key: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key } = await params;
  return { title: getWorkflow(key)?.name ?? "Workflow" };
}

const CHANNEL_WORDS = {
  sms: "text",
  email: "email",
  sms_or_email: "text (email if texting isn't possible)",
  email_or_sms: "email (text if there's no email)",
  sms_and_email: "text and email",
} as const;

function actionDetail(a: WorkflowAction): string {
  switch (a.kind) {
    case "send":
      return `Sends the “${a.template}” template by ${CHANNEL_WORDS[a.channel]} to the ${a.to === "customer" ? "customer" : a.to === "crew_lead" ? "crew lead" : "subcontractor"}.`;
    case "notify":
      return `In-app notice to ${a.audience.map((x) => AUDIENCE_LABELS[x]).join(", ")} (“${a.template}”).`;
    case "task":
      return `Task “${a.title}” for ${a.assignee.map((x) => AUDIENCE_LABELS[x]).join(", else ")}, due in ${describeDuration(a.dueIn)}.`;
    case "wait":
      return a.until
        ? `Waits until ${a.until.before ? "before" : "after"} ${a.until.field}${a.until.offset ? ` (${describeDuration(a.until.offset)})` : ""}${a.until.atPacificTime ? ` at ${a.until.atPacificTime}` : ""}${a.setting ? `; the days come from ${a.setting.replace(/_/g, " ")}` : ""}.`
        : `Waits ${describeDuration(a.for ?? {})}${a.setting ? ` (or the ${a.setting.replace(/_/g, " ")} setting)` : ""}.`;
    case "enroll_drip":
      return `Enrolls the ${a.subject} in the “${a.drip}” drip.`;
    case "assign_owner":
      return "Assigns the next estimator for the territory, round robin.";
    case "calendar":
      return "Records the calendar event (calendar adapter, not connected).";
    case "hold":
      return `${a.mode === "add" ? "Places" : "Releases"} the ${a.holdType} hold.`;
    case "set_field":
      return `Sets ${a.field}.`;
    case "attention":
      return `Opens an Attention item: ${a.title}`;
    case "webhook":
      return "Webhook (turned off in this build).";
  }
}

/** One workflow: trigger, built-in steps, its steps, templates, Test and run history. */
export default async function WorkflowPage({ params }: { params: Params }) {
  const viewer = await requirePermission("workflows:manage");
  const { key } = await params;
  const def = getWorkflow(key);
  if (!def) notFound();
  const supabase = await createSupabaseServerClient();
  const [list, runs, candidates, templates] = await Promise.all([
    loadWorkflowList(supabase),
    loadRecentRuns(supabase, { key, limit: 30 }),
    loadTestCandidates(supabase, def.subject),
    supabase
      .from("message_templates")
      .select("id, key, channel, status")
      .in("key", templatesUsed(def)),
  ]);
  const row = list.find((r) => r.def.key === key);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/workflows"
        className="flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Workflows
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Workflow {def.number}</p>
          <h1 className="text-2xl font-bold tracking-tight">{def.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{def.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{def.triggerLabel}</code>
            <span className="text-muted-foreground">
              {row?.runs ?? 0} run{row?.runs === 1 ? "" : "s"}
              {row?.lastRunAt ? ` · last ${formatRelative(row.lastRunAt)}` : ""}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3">
          <span className="text-sm font-medium">{row?.enabled ? "On" : "Off"}</span>
          <WorkflowSwitch
            workflowKey={def.key}
            name={def.name}
            enabled={row?.enabled ?? false}
            readOnly={viewer.impersonating}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4" aria-labelledby="when-heading">
          <h2 id="when-heading" className="font-semibold">
            When it starts
          </h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {def.triggers.map((t, i) => (
              <li key={i}>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.event}</code>
                {t.when?.length ? ` when ${t.when.map(describeCondition).join(" and ")}` : ""}
              </li>
            ))}
          </ul>
          {def.exitLabel && <p className="mt-3 text-sm text-muted-foreground">{def.exitLabel}</p>}
          <p className="mt-3 text-xs text-muted-foreground">
            Once per event. Texts during quiet hours wait until they end (unless the customer texted
            us recently). Do Not Contact, STOP replies and unsubscribes always apply.
          </p>
        </section>
        <section className="rounded-2xl border bg-card p-4" aria-labelledby="builtin-heading">
          <h2 id="builtin-heading" className="flex items-center gap-2 font-semibold">
            <Lock className="size-4 text-muted-foreground" aria-hidden /> Built in (always on)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These happen whether or not this workflow is on: they&apos;re the job&apos;s rules, not
            messages.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {def.builtIn.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-4" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="font-semibold">
          Steps
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {def.actions.map((a, i) => (
            <li key={a.id} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-bb-forest">
                {i + 1}
              </span>
              <div className="text-sm">
                <p className="font-medium">{a.label}</p>
                <p className="text-muted-foreground">{actionDetail(a)}</p>
                {a.when?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Only when {a.when.map(describeCondition).join(" and ")}.
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {templatesUsed(def).length > 0 && (
          <div className="mt-4 border-t pt-3 text-sm">
            <p className="font-medium">Templates used</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {(templates.data ?? []).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/admin/templates/${t.id}`}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                  >
                    {t.key} · {t.channel === "sms" ? "Text" : "Email"}
                    {t.status === "draft" && <Badge variant="sample">Draft</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <WorkflowTestPanel
        workflowKey={def.key}
        subjectWords={SUBJECT_WORDS[def.subject]}
        candidates={candidates}
        readOnly={viewer.impersonating}
      />

      <section className="rounded-2xl border bg-card" aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="p-4 pb-2 font-semibold">
          Runs
        </h2>
        {runs.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No runs yet. It runs on its own the next time {def.triggerLabel} happens; use Test to
            see what it would do.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recent runs</caption>
              <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Started
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Record
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const href = subjectHref(r.subjectType, r.subjectId);
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link
                          href={`/admin/workflows/runs/${r.id}`}
                          className="text-bb-forest underline"
                        >
                          {formatDateTime(r.createdAt)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <RunStatusBadge status={r.status} />
                        {r.status === "waiting" && r.resumeAt && (
                          <span className="block text-xs text-muted-foreground">
                            until {formatDateTime(r.resumeAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {href ? (
                          <Link href={href} className="underline">
                            Open {r.subjectType?.replace(/_/g, " ")}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {r.subjectType?.replace(/_/g, " ") ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.error ?? r.result ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
