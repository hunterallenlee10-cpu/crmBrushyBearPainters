"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GradeBadge, LeadStatusBadge } from "@/components/leads/lead-badges";
import { ListShell, type ListShellProps } from "@/components/lists/list-shell";
import { useListNavigation } from "@/components/lists/use-list-navigation";
import type { FilterSpec, FieldOption } from "@/lib/lists/filters";
import { formatAppointment, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  HOME_BUILT_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
  type HomeBuilt,
  type Service,
  type Timeline,
} from "@/lib/domain/leads/constants";
import { bulkAssignLeads, bulkSetLeadStatus, getLeadPreview, type LeadPreview } from "./actions";

type Props = Omit<
  ListShellProps,
  "moduleId" | "noun" | "bulkActions" | "renderPreview" | "quickFilters"
> & {
  sourceOptions: FieldOption[];
  territoryOptions: FieldOption[];
  userOptions: FieldOption[];
  canAssign: boolean;
  canUpdate: boolean;
};

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Quick selects edit one "equals" rule in the advanced filter. */
function ruleValue(filter: FilterSpec, field: string): string {
  const r = filter.rules.find((x) => x.field === field && x.op === "equals");
  return typeof r?.value === "string" ? r.value : "";
}

function withRule(filter: FilterSpec, field: string, value: string): FilterSpec {
  const rules = filter.rules.filter((x) => !(x.field === field && x.op === "equals"));
  return { match: "all", rules: value ? [...rules, { field, op: "equals", value }] : rules };
}

function QuickFilters({ props }: { props: Props }) {
  const { go } = useListNavigation(props.state, props.defaults);
  const health = props.state.chips.includes("hot")
    ? "hot"
    : props.state.chips.includes("stale")
      ? "stale"
      : "";
  return (
    <>
      <select
        aria-label="Source"
        className={selectClass}
        value={ruleValue(props.state.filter, "source")}
        onChange={(e) => go({ filter: withRule(props.state.filter, "source", e.target.value) })}
      >
        <option value="">All sources</option>
        {props.sourceOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="City"
        className={selectClass}
        value={ruleValue(props.state.filter, "territory")}
        onChange={(e) => go({ filter: withRule(props.state.filter, "territory", e.target.value) })}
      >
        <option value="">All cities</option>
        {props.territoryOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Health"
        className={selectClass}
        value={health}
        onChange={(e) => {
          const rest = props.state.chips.filter((c) => c !== "hot" && c !== "stale");
          go({ chips: e.target.value ? [...rest, e.target.value] : rest });
        }}
      >
        <option value="">Any health</option>
        <option value="hot">Hot</option>
        <option value="stale">Stale (14+ days)</option>
      </select>
    </>
  );
}

function BulkActions({ ids, clear, props }: { ids: string[]; clear: () => void; props: Props }) {
  const router = useRouter();
  const [owner, setOwner] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);

  async function run<T extends { updated: number; skipped: number }>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>,
    verb: string,
  ) {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    const { updated, skipped } = result.data;
    toast.success(
      `${verb} ${updated} lead${updated === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped (no access or wrong status).` : ""}`,
    );
    clear();
    router.refresh();
  }

  return (
    <>
      {props.canAssign && (
        <Popover open={assignOpen} onOpenChange={setAssignOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              <UserPlus aria-hidden />
              Assign
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="bulk-owner">
              Assign {ids.length} to
            </label>
            <select
              id="bulk-owner"
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
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                await run(() => bulkAssignLeads({ ids, owner_id: owner || null }), "Assigned");
                setAssignOpen(false);
              }}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Assign
            </Button>
          </PopoverContent>
        </Popover>
      )}
      {props.canUpdate && (
        <select
          aria-label="Change status"
          className={selectClass}
          value=""
          disabled={busy}
          onChange={(e) => {
            const status = e.target.value as "new" | "contacted" | "unqualified";
            if (status) void run(() => bulkSetLeadStatus({ ids, status }), "Updated");
          }}
        >
          <option value="">Change status…</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="unqualified">Unqualified</option>
        </select>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" size="sm" disabled>
              <Download aria-hidden />
              Export
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Export arrives with Export Controls (Phase 10).</TooltipContent>
      </Tooltip>
    </>
  );
}

function Preview({ id }: { id: string }) {
  const [lead, setLead] = React.useState<LeadPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setLead(null);
    setError(null);
    void getLeadPreview({ id }).then((r) => {
      if (!alive) return;
      if (r.ok) setLead(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!lead)
    return (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading lead" />
    );

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <LeadStatusBadge status={lead.status} />
        <GradeBadge grade={lead.grade} score={lead.score} />
        {lead.outOfArea && <span className="text-xs font-medium text-warning">Out of area</span>}
      </div>
      <dl className="divide-y">
        {row("Mobile", lead.mobile && formatPhone(lead.mobile))}
        {row("Phone", lead.phone && formatPhone(lead.phone))}
        {row("Email", lead.email)}
        {row("Address", lead.address)}
        {row("Services", lead.services.map((s) => SERVICE_LABELS[s as Service] ?? s).join(", "))}
        {row("Timeline", lead.timeline && TIMELINE_LABELS[lead.timeline as Timeline])}
        {row("Home built", lead.homeBuilt && HOME_BUILT_LABELS[lead.homeBuilt as HomeBuilt])}
        {row("Owner", lead.ownerName ?? "Unassigned")}
        {row("Walkthrough", lead.walkthroughAt && formatAppointment(lead.walkthroughAt))}
        {row("Created", formatRelative(lead.createdAt))}
        {row("Last activity", formatRelative(lead.lastActivityAt))}
      </dl>
      {lead.notes && (
        <div>
          <h3 className="text-sm font-semibold">From the customer</h3>
          <p className="mt-1 text-sm whitespace-pre-line text-foreground/90">{lead.notes}</p>
        </div>
      )}
      {lead.factors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Why this score</h3>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {lead.factors.map((f) => (
              <li key={f.label} className="flex justify-between gap-2">
                <span>{f.label}</span>
                <span
                  className={
                    f.points >= 0 ? "text-success tabular-nums" : "text-danger tabular-nums"
                  }
                >
                  {f.points > 0 ? "+" : ""}
                  {f.points}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button asChild>
        <Link href={`/leads/${lead.id}`}>Open lead</Link>
      </Button>
    </div>
  );
}

export function LeadsListClient(props: Props) {
  const showBulk = props.canAssign || props.canUpdate;
  return (
    <ListShell
      {...props}
      moduleId="leads"
      noun="lead"
      quickFilters={<QuickFilters props={props} />}
      bulkActions={
        showBulk ? (ids, clear) => <BulkActions ids={ids} clear={clear} props={props} /> : undefined
      }
      renderPreview={(id) => <Preview id={id} />}
    />
  );
}
