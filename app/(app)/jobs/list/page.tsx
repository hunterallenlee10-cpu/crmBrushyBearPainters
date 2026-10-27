import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness, LayoutDashboard, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { StageBadge } from "@/components/layout/stage-badge";
import { Button } from "@/components/ui/button";
import { HealthBadge, HoldPill, JobStatusBadge, PriorityBadge } from "@/components/jobs/job-badges";
import {
  JobCard,
  formatJobAmount,
  formatJobDay,
  holdPillLabel,
  type JobCardData,
} from "@/components/jobs/job-card";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadJobOptions, labelFor } from "@/lib/jobs/options";
import { logError } from "@/lib/log";
import { isJobStageId, TERMINAL_STAGES } from "@/lib/domain/stages";
import { JOB_STATUS_LABELS, type JobPriority, type JobStatus } from "@/lib/domain/jobs/constants";
import {
  JOBS_LIST,
  ON_HOLD_CHIP,
  chipsForTab,
  jobsListFor,
  myJobsOp,
  OPEN_JOBS_OP,
} from "@/lib/lists/modules/jobs";
import { filterToOps } from "@/lib/lists/filters";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import { applyOps, loadColumnPrefs, loadSavedViews, withOptions } from "@/lib/lists/server";
import { formatDate, formatRelative } from "@/lib/format/dates";
import { jobCountValue, parseJobStatusCounts } from "@/lib/metrics/registry";
import { JobsListClient } from "./jobs-list-client";

export const metadata: Metadata = { title: "Job List" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SELECT =
  "id, job_number, name, stage, status, priority, work_types, promised_start_date, health_score, lead_source, stage_entered_at, created_at, account:accounts!jobs_account_id_fkey(display_name), owner:profiles!jobs_owner_id_fkey(full_name), poc:profiles!jobs_point_of_contact_id_fkey(full_name), pm:profiles!jobs_project_manager_id_fkey(full_name), job_holds(hold_type, blocks_scheduling, released_at)";

export default async function JobListPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("jobs:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const params = await searchParams;
  const canSeeMoney = viewer.can("financials:read");
  const mod = jobsListFor(canSeeMoney);
  const state = parseListState(params, mod);
  const layout =
    (Array.isArray(params.layout) ? params.layout[0] : params.layout) === "cards"
      ? "cards"
      : "table";

  const [options, savedViews, columnPrefs, countsRes] = await Promise.all([
    loadJobOptions(supabase),
    loadSavedViews(supabase, "jobs", viewer.real.id),
    loadColumnPrefs(supabase, viewer.real.id, "jobs"),
    supabase.rpc("job_status_counts"),
  ]);
  if (countsRes.error) logError("jobs.list.counts", countsRes.error);
  const counts = parseJobStatusCounts(countsRes.data);

  const fields = withOptions(JOBS_LIST.fields, options);
  const view = savedViews.find((v) => v.id === state.view);
  const visibleColumns = resolveColumns(mod, view?.config.columns ?? columnPrefs);
  const ctx = { userId: viewer.id, now };
  const ops = listOps(state, mod, ctx, filterToOps(state.filter, fields, now));

  const fromRow = (state.page - 1) * state.size;
  const query = applyOps(supabase.from("jobs").select(SELECT, { count: "exact" }), ops)
    .is("job_holds.released_at", null)
    .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(fromRow, fromRow + state.size - 1);
  const { data: jobs, count, error } = await query;
  if (error) throw error;

  // Money only for people with financials:read (row security hides it from everyone else too).
  const ids = (jobs ?? []).map((j) => j.id);
  const amounts = new Map<string, number | null>();
  if (canSeeMoney && ids.length) {
    const { data: fin, error: finError } = await supabase
      .from("job_financials")
      .select("job_id, contract_baseline_cents")
      .in("job_id", ids);
    if (finError) logError("jobs.list.financials", finError);
    for (const f of fin ?? []) amounts.set(f.job_id, f.contract_baseline_cents);
  }

  // Chip counts follow the tab: closed stages only count on All; My Jobs counts my open jobs.
  const chips = chipsForTab(state.tab, state.chips);
  const chipCounts: Record<string, number> = {};
  if (state.tab === "mine") {
    const results = await Promise.all(
      chips.map((c) => {
        const q = applyOps(supabase.from("jobs").select("id", { count: "exact", head: true }), [
          OPEN_JOBS_OP,
          myJobsOp(viewer.id),
        ]);
        return c.id === ON_HOLD_CHIP ? q.eq("status", "on_hold") : q.eq("stage", c.id);
      }),
    );
    chips.forEach((c, i) => {
      chipCounts[c.id] = results[i]?.count ?? 0;
    });
  } else {
    for (const c of chips) {
      chipCounts[c.id] =
        c.id === ON_HOLD_CHIP
          ? counts.on_hold
          : state.tab === "active" && isJobStageId(c.id) && TERMINAL_STAGES.includes(c.id)
            ? 0
            : (counts.by_stage[c.id] ?? 0);
    }
  }

  const workTypeLabel = (w: string) => labelFor(options.picklists.work_type, w);
  const holdLabel = (h: string) => labelFor(options.picklists.hold_type, h);

  const rows = (jobs ?? []).flatMap((j) => {
    if (!isJobStageId(j.stage)) return [];
    const status = j.status as JobStatus;
    const holds = j.job_holds.map((h) => ({
      label: holdLabel(h.hold_type),
      blocks: h.blocks_scheduling,
    }));
    const workTypes = j.work_types.map(workTypeLabel);
    const amount = amounts.get(j.id) ?? null;
    const card: JobCardData = {
      id: j.id,
      jobNumber: j.job_number,
      name: j.name,
      accountName: j.account?.display_name ?? null,
      workTypes,
      stage: j.stage,
      status,
      priority: j.priority as JobPriority,
      holds,
      startDate: j.promised_start_date,
      ...(canSeeMoney ? { amountCents: amount } : {}),
      healthScore: j.health_score,
    };
    const person = (name: string | null | undefined, empty: string) =>
      name ? (
        <span className="text-xs whitespace-nowrap">{name}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{empty}</span>
      );
    return [
      {
        id: j.id,
        label: `${j.job_number} ${j.name}`,
        card: <JobCard job={card} />,
        cells: {
          job_number: (
            <Link
              href={`/jobs/${j.id}`}
              className="text-xs whitespace-nowrap text-bb-forest tabular-nums hover:underline"
            >
              {j.job_number}
            </Link>
          ),
          priority: <PriorityBadge priority={j.priority as JobPriority} />,
          name: (
            <div className="flex min-w-48 flex-col gap-1">
              <Link href={`/jobs/${j.id}`} className="font-medium text-bb-forest hover:underline">
                {j.name}
              </Link>
              {(holds.length > 0 || status === "won" || status === "lost") && (
                <div className="flex flex-wrap gap-1">
                  {status !== "open" && status !== "on_hold" && <JobStatusBadge status={status} />}
                  {holds.map((h, i) => (
                    <HoldPill
                      key={`${h.label}-${i}`}
                      label={holdPillLabel(h.label)}
                      blocks={h.blocks}
                    />
                  ))}
                </div>
              )}
            </div>
          ),
          account: j.account?.display_name ? (
            <span className="text-xs">{j.account.display_name}</span>
          ) : null,
          amount: canSeeMoney ? (
            <span className="text-xs whitespace-nowrap tabular-nums">
              {formatJobAmount(amount)}
            </span>
          ) : null,
          stage: <StageBadge stage={j.stage} />,
          work_types: workTypes.length ? (
            <span className="text-xs">{workTypes.join(", ")}</span>
          ) : null,
          start: j.promised_start_date ? (
            <span className="text-xs whitespace-nowrap">{formatJobDay(j.promised_start_date)}</span>
          ) : null,
          point_of_contact: person(j.poc?.full_name, "None yet"),
          owner: person(j.owner?.full_name, "Unassigned"),
          health: <HealthBadge score={j.health_score} />,
          status: <span className="text-xs">{JOB_STATUS_LABELS[status]}</span>,
          project_manager: person(j.pm?.full_name, "None yet"),
          source: j.lead_source ? (
            <span className="text-xs">
              {labelFor(options.picklists.lead_source, j.lead_source)}
            </span>
          ) : null,
          stage_entered: (
            <span className="text-xs whitespace-nowrap" title={formatDate(j.stage_entered_at)}>
              {formatRelative(j.stage_entered_at, now)}
            </span>
          ),
          created: (
            <span className="text-xs whitespace-nowrap" title={formatDate(j.created_at)}>
              {formatRelative(j.created_at, now)}
            </span>
          ),
        },
      },
    ];
  });

  const tabCounts: Record<string, number> = {
    active: jobCountValue("jobs.list_active", counts),
    mine: jobCountValue("jobs.list_mine", counts),
    total: jobCountValue("jobs.list_total", counts),
  };
  const tabs = mod.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: tabCounts[t.countKey] ?? null,
  }));
  const canCreate = viewer.can("jobs:create") && !viewer.impersonating;
  const noJobsAtAll = counts.total === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Job List"
        description={
          <>
            Jobs · {tabCounts.active!.toLocaleString("en-US")} active /{" "}
            {tabCounts.total!.toLocaleString("en-US")} total
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/jobs">
                <LayoutDashboard aria-hidden />
                Jobs Dashboard
              </Link>
            </Button>
            {canCreate && (
              <Button asChild variant="cta">
                <Link href="/jobs/new">
                  <Plus aria-hidden />
                  New Job
                </Link>
              </Button>
            )}
          </>
        }
      />
      <JobsListClient
        state={state}
        defaults={{ defaultTab: mod.defaultTab, defaultSort: mod.defaultSort }}
        tabs={tabs}
        chips={chips}
        chipCounts={chipCounts}
        fields={fields}
        allColumns={mod.columns}
        visibleColumns={visibleColumns}
        rows={rows}
        total={count}
        savedViews={savedViews}
        searchPlaceholder={mod.searchPlaceholder}
        layout={layout}
        stageOptions={fields.find((f) => f.key === "stage")?.options ?? []}
        workTypeOptions={options.picklists.work_type
          .filter((o) => o.active !== false)
          .map((o) => ({ value: o.value, label: o.label }))}
        userOptions={options.users}
        canAssign={viewer.can("jobs:assign") && !viewer.impersonating}
        emptyState={
          <EmptyState
            icon={BriefcaseBusiness}
            title={noJobsAtAll ? "No jobs yet" : "No jobs match these filters"}
            action={
              canCreate && noJobsAtAll ? (
                <Button asChild variant="cta">
                  <Link href="/jobs/new">
                    <Plus aria-hidden />
                    New Job
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {noJobsAtAll
              ? "Jobs appear here when a lead is converted or someone adds a job."
              : "Try removing a chip or a rule, or switch tabs."}
          </EmptyState>
        }
      />
    </div>
  );
}
