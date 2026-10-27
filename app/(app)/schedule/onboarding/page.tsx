import type { Metadata } from "next";
import Link from "next/link";
import {
  Briefcase,
  CircleDollarSign,
  CirclePause,
  ClipboardList,
  HandCoins,
  HardHat,
  LifeBuoy,
  PartyPopper,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/kpi/kpi-card";
import { NativeSelect } from "@/components/forms/native-select";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  HOLD_FILTERS,
  LANE_LABELS,
  expediteList,
  filterCards,
  placeCards,
  summarizeBoard,
  type HoldFilter,
} from "@/lib/domain/onboarding/board";
import { getStage } from "@/lib/domain/stages";
import { formatDateTime } from "@/lib/format/dates";
import { loadJobOptions } from "@/lib/jobs/options";
import {
  boardMetricValue,
  formatMoney,
  parseBoardStats,
  type BoardMetricId,
} from "@/lib/metrics/registry";
import { loadBoard } from "@/lib/onboarding/board";
import { cn } from "@/lib/utils";
import { BoardClient } from "./board-client";

export const metadata: Metadata = { title: "Onboarding Board" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isoDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

const TABS = [
  { id: "board", label: "Board" },
  { id: "expedite", label: "Expedite" },
  { id: "service", label: "Service/Warranty" },
  { id: "calls", label: "Call Log" },
  { id: "audit", label: "Data Audit" },
  { id: "reporting", label: "Reporting" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const HOLD_LABELS: Record<HoldFilter, string> = {
  any: "Has a hold",
  none: "No holds",
  deposit: "Deposit Hold",
  hoa: "HOA Hold",
  lead_safe: "Lead-Safe Hold",
  weather: "Weather Hold",
};

/**
 * Onboarding Board (SPEC §8.7): sold jobs from deposit to paid in full, in
 * lanes that come from each job's stage and holds. KPIs come from the metrics
 * registry over every job on the board (filters apply).
 */
export default async function OnboardingBoardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const viewer = await requirePermission("jobs:read");
  const sp = await searchParams;
  const rawTab = one(sp.tab);
  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : "board";
  const rawHold = one(sp.hold);
  const filters = {
    workType: one(sp.work_type) || null,
    hold: (HOLD_FILTERS as readonly string[]).includes(rawHold ?? "")
      ? (rawHold as HoldFilter)
      : null,
    city: one(sp.city) || null,
    soldFrom: isoDay(one(sp.sold_from)),
    soldTo: isoDay(one(sp.sold_to)),
    underCollected: one(sp.collected) === "under30",
  };
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const [board, options] = await Promise.all([
    loadBoard(supabase, viewer, now),
    loadJobOptions(supabase),
  ]);
  const cities = [...new Set(board.jobs.map((j) => j.city).filter((c): c is string => !!c))].sort();
  const filtered = filterCards(board.jobs, filters);
  const placed = placeCards(filtered, now, board.thresholds);
  const stats = parseBoardStats(summarizeBoard(placed, board.canSeeMoney));
  const m = (id: BoardMetricId) => boardMetricValue(id, stats);
  const money = board.canSeeMoney;
  const anyFilter = Object.values(filters).some(Boolean);
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const all = {
      tab,
      work_type: filters.workType,
      hold: filters.hold,
      city: filters.city,
      sold_from: filters.soldFrom,
      sold_to: filters.soldTo,
      collected: filters.underCollected ? "under30" : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(all)) if (v && !(k === "tab" && v === "board")) p.set(k, v);
    const s = p.toString();
    return `/schedule/onboarding${s ? `?${s}` : ""}`;
  };

  const kpis: {
    label: string;
    value: string;
    caption: string;
    icon: typeof Briefcase;
    tone?: "warning";
  }[] = [
    {
      label: m("board.active_jobs").label,
      value: m("board.active_jobs").display,
      caption: money
        ? `${m("board.active_value").display} pipeline`
        : m("board.active_jobs").caption,
      icon: Briefcase,
    },
    {
      label: m("board.deposit_hold").label,
      value: m("board.deposit_hold").display,
      caption: money ? `${m("board.deposit_held").display} held` : m("board.deposit_hold").caption,
      icon: HandCoins,
      tone: stats.lanes.find((l) => l.lane === "deposit_hold")?.overdue ? "warning" : undefined,
    },
    {
      label: m("board.needs_onboarding").label,
      value: m("board.needs_onboarding").display,
      caption: `Avg ${m("board.needs_onboarding_age").display} in the lane`,
      icon: ClipboardList,
    },
    {
      label: m("board.on_hold").label,
      value: m("board.on_hold").display,
      caption: `Avg ${m("board.on_hold_age").display} on hold`,
      icon: CirclePause,
    },
    {
      label: m("board.ready").label,
      value: m("board.ready").display,
      caption: money
        ? `${m("board.ready_value").display} ready for dates`
        : m("board.ready").caption,
      icon: CircleDollarSign,
    },
    {
      label: m("board.in_production").label,
      value: m("board.in_production").display,
      caption: m("board.in_production").caption,
      icon: HardHat,
    },
    {
      label: m("board.invoicing").label,
      value: m("board.invoicing").display,
      caption: money
        ? `${m("board.outstanding").display} outstanding · contract − collected`
        : m("board.invoicing").caption,
      icon: Receipt,
    },
    {
      label: m("board.paid_month").label,
      value: m("board.paid_month").display,
      caption: m("board.paid_month").caption,
      icon: PartyPopper,
    },
    {
      label: "Open Warranty/Service",
      value: "—",
      caption: "Warranty cases arrive in Phase 8",
      icon: LifeBuoy,
    },
  ];

  let calls: {
    id: string;
    jobId: string;
    job: string;
    outcome: string | null;
    at: string;
    notes: string | null;
  }[] = [];
  if (tab === "calls" && viewer.can("messages:read") && board.jobs.length) {
    const ids = board.jobs.slice(0, 500).map((j) => j.id);
    const { data } = await supabase
      .from("messages")
      .select("id, subject_id, call_outcome, created_at, body")
      .eq("channel", "call")
      .eq("subject_type", "job")
      .in("subject_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);
    const byId = new Map(board.jobs.map((j) => [j.id, `${j.jobNumber} · ${j.name}`]));
    calls = (data ?? []).map((c) => ({
      id: c.id,
      jobId: c.subject_id,
      job: byId.get(c.subject_id) ?? "Job",
      outcome: c.call_outcome,
      at: c.created_at,
      notes: c.body,
    }));
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Onboarding Board"
        description="Sold jobs from deposit to paid in full. Lanes follow each job's stage and holds; drag a card only where its gate allows."
      />
      <section
        aria-label="Board KPIs"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9"
      >
        {kpis.map((k) => (
          <KpiCard
            key={k.label}
            label={k.label}
            value={k.value}
            caption={k.caption}
            icon={k.icon}
            tone={k.tone}
          />
        ))}
      </section>

      <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter the board">
        {tab !== "board" && <input type="hidden" name="tab" value={tab} />}
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">Work type</span>
          <NativeSelect name="work_type" defaultValue={filters.workType ?? ""}>
            <option value="">All</option>
            {options.picklists.work_type.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">Holds</span>
          <NativeSelect name="hold" defaultValue={filters.hold ?? ""}>
            <option value="">All</option>
            {HOLD_FILTERS.map((h) => (
              <option key={h} value={h}>
                {HOLD_LABELS[h]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">City</span>
          <NativeSelect name="city" defaultValue={filters.city ?? ""}>
            <option value="">All</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">Sold from</span>
          <Input type="date" name="sold_from" defaultValue={filters.soldFrom ?? ""} />
        </label>
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">Sold to</span>
          <Input type="date" name="sold_to" defaultValue={filters.soldTo ?? ""} />
        </label>
        {money && (
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input
              type="checkbox"
              name="collected"
              value="under30"
              defaultChecked={filters.underCollected}
              className="size-4"
            />
            Under 30% collected
          </label>
        )}
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {anyFilter && (
          <Link
            href={qs({
              work_type: null,
              hold: null,
              city: null,
              sold_from: null,
              sold_to: null,
              collected: null,
            })}
            className="px-2 py-2 text-sm text-bb-forest underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      <nav aria-label="Board views" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex gap-1 border-b">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={qs({ tab: t.id })}
                aria-current={tab === t.id ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap",
                  tab === t.id
                    ? "border-bb-forest font-semibold text-bb-forest"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {board.truncated && (
        <p className="rounded-xl border border-warning/40 bg-warning-bg/40 p-3 text-sm">
          Showing the first {board.jobs.length} jobs. Use the filters to narrow the board.
        </p>
      )}

      {tab === "board" && (
        <BoardClient
          cards={placed}
          lanes={stats.lanes}
          canSeeMoney={money}
          canAdvance={viewer.can("jobs:advance_stage") && !viewer.impersonating}
          empty={board.jobs.length === 0}
        />
      )}

      {tab === "expedite" && (
        <JobTable
          caption="Held up or past the lane's usual time, longest wait first."
          rows={expediteList(placed).map((c) => ({
            id: c.id,
            cells: [
              `${c.jobNumber} · ${c.name}`,
              LANE_LABELS[c.lane],
              `${c.daysInLane} day${c.daysInLane === 1 ? "" : "s"}${c.overdue ? " (overdue)" : ""}`,
              c.holds.map((h) => h.label).join(", ") || "—",
            ],
          }))}
          headers={["Job", "Lane", "Time in lane", "Holds"]}
          empty="Nothing is held up or overdue."
        />
      )}

      {tab === "audit" && (
        <JobTable
          caption="Jobs on the board missing data the team needs."
          rows={filtered
            .filter((j) => j.auditIssues.length > 0)
            .map((j) => ({
              id: j.id,
              cells: [
                `${j.jobNumber} · ${j.name}`,
                getStage(j.stage).label,
                j.auditIssues.join(", "),
              ],
            }))}
          headers={["Job", "Stage", "Missing"]}
          empty="Every job on the board has its key data."
        />
      )}

      {tab === "reporting" && (
        <JobTable
          caption="Lane totals for the jobs on the board (filters apply)."
          rows={stats.lanes.map((l) => ({
            id: l.lane,
            cells: [
              LANE_LABELS[l.lane],
              String(l.count),
              money ? formatMoney(l.valueCents) : "—",
              l.avgDays === null ? "—" : `${l.avgDays} days`,
              String(l.overdue),
            ],
          }))}
          headers={["Lane", "Jobs", "Value", "Avg time in lane", "Overdue"]}
          empty="No jobs on the board."
          linkRows={false}
        />
      )}

      {tab === "service" && (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Warranty and service cases arrive with Communication &amp; growth (Phase 8). Until then,
          log customer issues as a task or note on the job.
        </p>
      )}

      {tab === "calls" &&
        (viewer.can("messages:read") ? (
          <JobTable
            caption="Recent calls logged on jobs that are on the board."
            rows={calls.map((c) => ({
              id: c.id,
              href: `/jobs/${c.jobId}?section=messages`,
              cells: [
                formatDateTime(c.at),
                c.job,
                c.outcome ? c.outcome.replace(/_/g, " ") : "—",
                c.notes ?? "",
              ],
            }))}
            headers={["When", "Job", "Outcome", "Notes"]}
            empty="No calls logged on these jobs yet."
          />
        ) : (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Your role doesn&apos;t include customer messages.
          </p>
        ))}
    </PageContainer>
  );
}

function JobTable({
  caption,
  headers,
  rows,
  empty,
  linkRows = true,
}: {
  caption: string;
  headers: string[];
  rows: { id: string; cells: string[]; href?: string }[];
  empty: string;
  linkRows?: boolean;
}) {
  if (!rows.length) {
    return <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="px-4 py-2 text-left text-xs text-muted-foreground">{caption}</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id}>
              {r.cells.map((c, i) => (
                <td key={i} className="px-4 py-2">
                  {i === 0 && linkRows ? (
                    <Link
                      href={r.href ?? `/jobs/${r.id}?section=onboarding`}
                      className="font-medium text-bb-forest hover:underline"
                    >
                      {c}
                    </Link>
                  ) : (
                    c
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
