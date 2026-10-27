import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCheck, ClipboardCheck, Hourglass, Inbox, Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import {
  APPROVAL_DECIDED_WINDOW_DAYS,
  APPROVAL_METRICS,
  approvalMetricValue,
  parseApprovalCounts,
  type ApprovalMetricId,
} from "@/lib/metrics/registry";
import { StageBadge } from "@/components/layout/stage-badge";
import { ApprovalStatusBadge } from "@/components/jobs/approval-status-badge";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import { ApprovalActions } from "./approval-actions";
import { approvalTypeLabel, parseOverridePayload } from "./payload";

export const metadata: Metadata = { title: "Approvals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 50;
const DAY = 86_400_000;
const STATUS_TABS = [
  { id: "pending", label: "Pending" },
  { id: "decided", label: "Decided (30 days)" },
  { id: "all", label: "All" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["id"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Approvals (SPEC §8.5, reference "Unapproved Jobs"): stage overrides waiting
 * for an owner. Owners see everyone's requests; everyone else sees their own
 * (row security enforces it). Counts are aggregated on the server.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  const canDecide = viewer.can("job_admin:override");
  if (!canDecide && !viewer.can("jobs:advance_stage")) notFound();

  const sp = await searchParams;
  const view: "mine" | "all" = canDecide && one(sp.view) !== "mine" ? "all" : "mine";
  const rawStatus = one(sp.status);
  const status: StatusTab = STATUS_TABS.some((t) => t.id === rawStatus)
    ? (rawStatus as StatusTab)
    : "pending";
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const since = new Date(Date.now() - APPROVAL_DECIDED_WINDOW_DAYS * DAY).toISOString();

  const supabase = await createSupabaseServerClient();
  const scoped = () => {
    const q = supabase.from("approval_requests").select("id", { count: "exact", head: true });
    return view === "mine" ? q.eq("requested_by", viewer.id) : q;
  };
  const count = async (build: (q: ReturnType<typeof scoped>) => ReturnType<typeof scoped>) =>
    (await build(scoped())).count ?? 0;

  let list = supabase
    .from("approval_requests")
    .select(
      "id, type, job_id, requested_by, requested_at, reason, payload, status, decided_at, decision_note, job:jobs(id, job_number, name, stage), requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)",
      { count: "exact" },
    );
  if (view === "mine") list = list.eq("requested_by", viewer.id);
  if (status === "pending") list = list.eq("status", "pending");
  if (status === "decided") list = list.neq("status", "pending").gte("decided_at", since);

  const [total, pendingCount, approved30, rejected30, overridesPending, rows] = await Promise.all([
    count((q) => q),
    count((q) => q.eq("status", "pending")),
    count((q) => q.eq("status", "approved").gte("decided_at", since)),
    count((q) => q.eq("status", "rejected").gte("decided_at", since)),
    count((q) => q.eq("status", "pending").eq("type", "stage_override")),
    list
      .order("requested_at", { ascending: false })
      .order("id")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  if (rows.error) throw rows.error;
  const counts = parseApprovalCounts({
    total,
    pending: pendingCount,
    approved_30d: approved30,
    rejected_30d: rejected30,
    overrides_pending: overridesPending,
  });
  const kpi = (id: ApprovalMetricId) => APPROVAL_METRICS[id];
  const val = (id: ApprovalMetricId) => approvalMetricValue(id, counts).toLocaleString("en-US");
  const matching = rows.count ?? 0;
  const pages = Math.max(1, Math.ceil(matching / PAGE_SIZE));

  // Group by requester, keeping the newest-first order inside each group.
  type Row = NonNullable<typeof rows.data>[number];
  const groups = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows.data ?? []) {
    const g = groups.get(r.requested_by) ?? {
      name: r.requested_by === viewer.id ? "You" : (r.requester?.full_name ?? "Former teammate"),
      rows: [],
    };
    g.rows.push(r);
    groups.set(r.requested_by, g);
  }

  const href = (patch: Partial<{ view: string; status: string; page: number }>) => {
    const p = new URLSearchParams();
    const v = patch.view ?? view;
    const s = patch.status ?? status;
    if (canDecide && v === "mine") p.set("view", "mine");
    if (s !== "pending") p.set("status", s);
    const pg = patch.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const qs = p.toString();
    return `/jobs/approvals${qs ? `?${qs}` : ""}`;
  };
  const scopeCaption = view === "mine" ? "requests you made" : "every requester";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description={
          canDecide
            ? "Stage overrides waiting for an owner. Approving moves the job; rejecting needs a note."
            : "Your requests for an owner to override a stage gate."
        }
        actions={
          canDecide ? (
            <nav
              aria-label="Whose requests"
              className="inline-flex rounded-lg border bg-card p-0.5"
            >
              {(["mine", "all"] as const).map((v) => (
                <Link
                  key={v}
                  href={href({ view: v, status })}
                  aria-current={view === v ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    view === v
                      ? "bg-bb-forest text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "mine" ? "My requests" : "All requests"}
                </Link>
              ))}
            </nav>
          ) : undefined
        }
      />

      <section aria-label="Approval counts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={kpi("approvals.total").label}
          value={val("approvals.total")}
          caption={`${kpi("approvals.total").caption} · ${scopeCaption}`}
          icon={Inbox}
          href={href({ status: "all" })}
        />
        <KpiCard
          label={kpi("approvals.pending").label}
          value={val("approvals.pending")}
          caption={kpi("approvals.pending").caption}
          icon={Hourglass}
          tone="warning"
          href={href({ status: "pending" })}
        />
        <KpiCard
          label={`${kpi("approvals.approved_30d").label} / ${kpi("approvals.rejected_30d").label}`}
          value={`${val("approvals.approved_30d")} / ${val("approvals.rejected_30d")}`}
          caption={`Decided in the last ${APPROVAL_DECIDED_WINDOW_DAYS} days`}
          icon={CheckCheck}
          tone="success"
          href={href({ status: "decided" })}
        />
        <KpiCard
          label="By type"
          value={val("approvals.overrides_pending")}
          caption={kpi("approvals.overrides_pending").caption}
          icon={Layers}
          tone="info"
        />
      </section>

      <nav aria-label="Request status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ status: t.id })}
            aria-current={status === t.id ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
              status === t.id
                ? "border-bb-forest bg-bb-forest text-white"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {groups.size === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No approvals waiting.">
          {status === "pending"
            ? canDecide
              ? "When someone asks you to override a stage gate, it shows up here."
              : "Ask for an owner override from a job's Advance stage button when a gate can't pass yet."
            : "Nothing matches this filter."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([requesterId, g]) => (
            <section
              key={requesterId}
              aria-labelledby={`req-${requesterId}`}
              className="rounded-2xl border bg-card"
            >
              <h2
                id={`req-${requesterId}`}
                className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold"
              >
                {g.name}
                <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground tabular-nums">
                  {g.rows.length} {g.rows.length === 1 ? "request" : "requests"}
                </span>
              </h2>
              <ul className="divide-y">
                {g.rows.map((r) => {
                  const p = parseOverridePayload(r.payload);
                  const jobLabel = r.job ? `${r.job.job_number} · ${r.job.name}` : "A job";
                  const moveLabel = [p.fromStage, p.toStage]
                    .map((s) => (s ? getStage(s).label : "?"))
                    .join(" → ");
                  return (
                    <li
                      key={r.id}
                      className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
                      data-testid="approval-row"
                      data-request-id={r.id}
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {r.job ? (
                            <Link
                              href={`/jobs/${r.job.id}`}
                              className="font-semibold break-words text-bb-forest hover:underline"
                            >
                              {jobLabel}
                            </Link>
                          ) : (
                            <span className="font-semibold">{jobLabel}</span>
                          )}
                          <ApprovalStatusBadge status={r.status} />
                          <span className="text-xs text-muted-foreground">
                            {approvalTypeLabel(r.type)}
                          </span>
                        </div>
                        <div
                          className="flex flex-wrap items-center gap-1.5 text-sm"
                          aria-label={`Move: ${moveLabel}`}
                        >
                          {p.fromStage ? (
                            <StageBadge stage={p.fromStage} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Current stage</span>
                          )}
                          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                          {p.toStage ? (
                            <StageBadge stage={p.toStage} />
                          ) : (
                            <span className="text-xs text-danger">Stage missing</span>
                          )}
                          {r.status === "pending" &&
                            r.job &&
                            p.fromStage &&
                            isJobStageId(r.job.stage) &&
                            r.job.stage !== p.fromStage && (
                              <span className="rounded-md bg-warning-bg px-2 py-0.5 text-xs font-medium text-bb-ink">
                                Job already moved from {getStage(p.fromStage).label} (now{" "}
                                {getStage(r.job.stage).label})
                              </span>
                            )}
                        </div>
                        <p className="text-sm break-words">
                          <span className="text-muted-foreground">Reason: </span>
                          {r.reason}
                        </p>
                        {p.gateReasons.length > 0 && (
                          <div className="text-sm">
                            <p className="text-xs font-medium text-muted-foreground">
                              Why the gate didn&apos;t pass
                            </p>
                            <ul className="list-disc pl-5 text-muted-foreground">
                              {p.gateReasons.map((g, i) => (
                                <li key={i} className="break-words">
                                  {g}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Requested{" "}
                          <time dateTime={r.requested_at} title={formatDateTime(r.requested_at)}>
                            {formatRelative(r.requested_at)}
                          </time>
                          {r.status !== "pending" && r.decided_at && (
                            <>
                              {" · "}
                              {r.status === "canceled"
                                ? "Canceled"
                                : `${r.decider?.full_name ?? "An owner"} ${r.status}`}{" "}
                              <time dateTime={r.decided_at} title={formatDateTime(r.decided_at)}>
                                {formatRelative(r.decided_at)}
                              </time>
                            </>
                          )}
                        </p>
                        {r.decision_note && (
                          <p className="rounded-lg bg-muted px-3 py-2 text-sm break-words">
                            <span className="text-muted-foreground">Note: </span>
                            {r.decision_note}
                          </p>
                        )}
                      </div>
                      {r.status === "pending" && !viewer.impersonating && (
                        <div className="lg:shrink-0">
                          <ApprovalActions
                            id={r.id}
                            jobLabel={jobLabel}
                            moveLabel={moveLabel}
                            canDecide={canDecide}
                            canCancel={r.requested_by === viewer.id}
                            staleReason={
                              r.job &&
                              p.fromStage &&
                              isJobStageId(r.job.stage) &&
                              r.job.stage !== p.fromStage
                                ? `The job already moved from ${getStage(p.fromStage).label} to ${getStage(r.job.stage).label}. Reject or cancel this request.`
                                : null
                            }
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {matching.toLocaleString("en-US")} requests
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border bg-card px-3 py-1.5"
                href={href({ page: page - 1 })}
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                className="rounded-md border bg-card px-3 py-1.5"
                href={href({ page: page + 1 })}
              >
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
