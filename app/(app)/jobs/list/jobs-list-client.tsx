"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LayoutGrid, Loader2, Rows3, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StageBadge } from "@/components/layout/stage-badge";
import { HealthBadge, HoldPill, JobStatusBadge, PriorityBadge } from "@/components/jobs/job-badges";
import { formatJobAmount, formatJobDay, holdPillLabel } from "@/components/jobs/job-card";
import { ListShell, type ListShellProps } from "@/components/lists/list-shell";
import { useListNavigation } from "@/components/lists/use-list-navigation";
import type { FieldOption, FilterSpec, Operator } from "@/lib/lists/filters";
import { listStateToQuery } from "@/lib/lists/params";
import { formatRelative } from "@/lib/format/dates";
import { cn } from "@/lib/utils";
import { bulkAssignJobs, getJobPreview, type JobPreview } from "./actions";

type Layout = "table" | "cards";

type Props = Omit<
  ListShellProps,
  "moduleId" | "noun" | "bulkActions" | "renderPreview" | "quickFilters" | "persistParams"
> & {
  layout: Layout;
  stageOptions: readonly FieldOption[];
  workTypeOptions: readonly FieldOption[];
  userOptions: readonly FieldOption[];
  canAssign: boolean;
};

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Quick selects edit one rule (field + operator) in the advanced filter. */
function ruleValue(filter: FilterSpec, field: string, op: Operator): string {
  const r = filter.rules.find((x) => x.field === field && x.op === op);
  return typeof r?.value === "string" ? r.value : "";
}

function withRule(filter: FilterSpec, field: string, op: Operator, value: string): FilterSpec {
  const rules = filter.rules.filter((x) => !(x.field === field && x.op === op));
  return { match: "all", rules: value ? [...rules, { field, op, value }] : rules };
}

function persistFor(layout: Layout): Record<string, string> | undefined {
  return layout === "cards" ? { layout: "cards" } : undefined;
}

function QuickFilters({ props }: { props: Props }) {
  const { go } = useListNavigation(props.state, props.defaults, persistFor(props.layout));
  const router = useRouter();
  const switchLayout = (next: Layout) => {
    if (next === props.layout) return;
    const q = listStateToQuery(props.state, props.defaults);
    const extra = next === "cards" ? "layout=cards" : "";
    const query = extra ? (q ? `${q}&${extra}` : `?${extra}`) : q;
    router.push(`/jobs/list${query}`, { scroll: false });
  };
  return (
    <>
      <select
        aria-label="Stage"
        className={selectClass}
        value={ruleValue(props.state.filter, "stage", "equals")}
        onChange={(e) =>
          go({ filter: withRule(props.state.filter, "stage", "equals", e.target.value) })
        }
      >
        <option value="">All stages</option>
        {props.stageOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Work type"
        className={selectClass}
        value={ruleValue(props.state.filter, "work_type", "contains")}
        onChange={(e) =>
          go({ filter: withRule(props.state.filter, "work_type", "contains", e.target.value) })
        }
      >
        <option value="">All work types</option>
        {props.workTypeOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div role="group" aria-label="Layout" className="inline-flex rounded-md border bg-card p-0.5">
        {(
          [
            { id: "table", label: "List", icon: Rows3 },
            { id: "cards", label: "Cards", icon: LayoutGrid },
          ] as const
        ).map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={props.layout === l.id}
            onClick={() => switchLayout(l.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium",
              props.layout === l.id
                ? "bg-bb-forest text-white"
                : "text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
          >
            <l.icon className="size-4" aria-hidden />
            {l.label}
          </button>
        ))}
      </div>
    </>
  );
}

function BulkActions({ ids, clear, props }: { ids: string[]; clear: () => void; props: Props }) {
  const router = useRouter();
  const [owner, setOwner] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function assign() {
    setBusy(true);
    const result = await bulkAssignJobs({ ids, owner_id: owner || null });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const { updated, skipped } = result.data;
    toast.success(
      `Assigned ${updated} job${updated === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped (no access).` : ""}`,
    );
    setOpen(false);
    clear();
    router.refresh();
  }

  return (
    <>
      {props.canAssign && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              <UserPlus aria-hidden />
              Assign owner
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="bulk-job-owner">
              Make this person the owner of {ids.length} job{ids.length === 1 ? "" : "s"}
            </label>
            <select
              id="bulk-job-owner"
              className={selectClass}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">Unassigned</option>
              {props.userOptions.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={busy} onClick={() => void assign()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Assign
            </Button>
          </PopoverContent>
        </Popover>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-md">
            <Button variant="outline" size="sm" disabled aria-disabled>
              <Download aria-hidden />
              Export
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Arrives with Export Controls (Phase 10)</TooltipContent>
      </Tooltip>
    </>
  );
}

function Preview({ id }: { id: string }) {
  const [job, setJob] = React.useState<JobPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setJob(null);
    setError(null);
    void getJobPreview({ id }).then((r) => {
      if (!alive) return;
      if (r.ok) setJob(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!job)
    return (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading job" />
    );

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">{job.jobNumber}</span>
        <StageBadge stage={job.stage} />
        {job.status !== "open" && job.status !== "on_hold" && (
          <JobStatusBadge status={job.status} />
        )}
        <PriorityBadge priority={job.priority} />
        <HealthBadge score={job.healthScore} />
      </div>
      {job.holds.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Active holds">
          {job.holds.map((h, i) => (
            <li key={`${h.label}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <HoldPill label={holdPillLabel(h.label)} blocks={h.blocks} />
              <span className="text-foreground/80">{h.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="divide-y">
        {row("Customer", job.accountName)}
        {row("Contact", job.contactName)}
        {row("Address", job.address)}
        {row("Work types", job.workTypes.join(", "))}
        {job.amountCents !== undefined && row("Amount", formatJobAmount(job.amountCents))}
        {row("Target/start", formatJobDay(job.startDate))}
        {row("Owner", job.ownerName ?? "Unassigned")}
        {row("Point of contact", job.pointOfContactName ?? "None yet")}
        {row("Project manager", job.projectManagerName ?? "None yet")}
        {row("Lead source", job.leadSource)}
        {row("In stage since", formatRelative(job.stageEnteredAt))}
        {row("Created", formatRelative(job.createdAt))}
      </dl>
      <Button asChild>
        <Link href={`/jobs/${job.id}`}>Open job</Link>
      </Button>
    </div>
  );
}

export function JobsListClient(props: Props) {
  return (
    <ListShell
      {...props}
      moduleId="jobs"
      noun="job"
      persistParams={persistFor(props.layout)}
      quickFilters={<QuickFilters props={props} />}
      bulkActions={
        props.canAssign
          ? (ids, clear) => <BulkActions ids={ids} clear={clear} props={props} />
          : undefined
      }
      renderPreview={(id) => <Preview id={id} />}
    />
  );
}
