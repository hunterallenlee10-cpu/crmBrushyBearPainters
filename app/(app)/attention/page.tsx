import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClockOff,
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  MessageSquare,
  PartyPopper,
  PlayCircle,
  SearchX,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttentionFilters, type FilterSelect } from "@/components/attention/attention-filters";
import { AttentionItem } from "@/components/attention/attention-item";
import { AttentionToolbar } from "@/components/attention/attention-toolbar";
import type { AttentionActions } from "@/components/attention/types";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  ATTENTION_CATEGORIES,
  ATTENTION_RULES,
  CATEGORY_LABELS,
  type AttentionRuleKey,
} from "@/lib/domain/attention/rules";
import { logError } from "@/lib/log";
import {
  DEFAULT_QUERY,
  PAGE_SIZE,
  PRIORITY_FILTER_LABELS,
  STATUS_VIEWS,
  STATUS_VIEW_LABELS,
  URGENCY_CAP,
  attentionHref,
  hasNarrowingFilters,
  parseAttentionQuery,
  type PriorityFilter,
} from "./_lib/query";
import { loadAttentionPage } from "./_lib/load";
import {
  assignAttentionItem,
  reopenAttentionItem,
  resolveAttentionItem,
  snoozeAttentionItem,
  startAttentionItem,
} from "./actions";

export const metadata: Metadata = { title: "Attention" };

/**
 * Attention Center (SPEC §8.9, §9). Items open on their own when something
 * stalls (the worker's rules) and close on their own when it's fixed. People
 * assign, start, snooze and resolve them here.
 *
 * KPI cards read `attention_summary()` directly (aggregated in Postgres, scoped
 * by row security); they move to lib/metrics/registry.ts with the registry's
 * Phase 3 additions.
 */

type Summary = {
  open: number;
  now: number;
  overdue: number;
  awaiting_response: number;
  in_progress: number;
  snoozed: number;
  mine: number;
};

function parseSummary(raw: unknown): Summary {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : 0);
  return {
    open: n("open"),
    now: n("now"),
    overdue: n("overdue"),
    awaiting_response: n("awaiting_response"),
    in_progress: n("in_progress"),
    snoozed: n("snoozed"),
    mine: n("mine"),
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

const ACTIONS: AttentionActions = {
  assign: assignAttentionItem,
  start: startAttentionItem,
  reopen: reopenAttentionItem,
  snooze: snoozeAttentionItem,
  resolve: resolveAttentionItem,
};

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("attention:read");
  const q = parseAttentionQuery(await searchParams);
  const supabase = await createSupabaseServerClient();
  const now = new Date();

  const [summaryRes, page] = await Promise.all([
    supabase.rpc("attention_summary"),
    loadAttentionPage(supabase, q, viewer.id, now),
  ]);
  if (summaryRes.error) logError("attention.summary", summaryRes.error);
  const s = parseSummary(summaryRes.data);
  const readOnly = viewer.impersonating;

  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const first = page.total === 0 ? 0 : (q.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page.total, q.page * PAGE_SIZE);
  const narrowed = hasNarrowingFilters(q);
  const resolvedView = q.status === "resolved";

  const selects: FilterSelect[] = [
    {
      param: "status",
      label: "Status",
      value: q.status === DEFAULT_QUERY.status ? "" : q.status,
      options: STATUS_VIEWS.map((v) => ({
        value: v === DEFAULT_QUERY.status ? "" : v,
        label: STATUS_VIEW_LABELS[v],
      })),
    },
    {
      param: "priority",
      label: "Priority",
      value: q.priority ?? "",
      options: [
        { value: "", label: "Any priority" },
        ...(Object.keys(PRIORITY_FILTER_LABELS) as PriorityFilter[]).map((p) => ({
          value: p,
          label: PRIORITY_FILTER_LABELS[p],
        })),
      ],
    },
    {
      param: "type",
      label: "Type",
      value: q.rule ?? "",
      options: [
        { value: "", label: "Any type" },
        ...(Object.keys(ATTENTION_RULES) as AttentionRuleKey[]).map((k) => ({
          value: k,
          label: ATTENTION_RULES[k].label,
        })),
      ],
    },
    {
      param: "category",
      label: "Category",
      value: q.category ?? "",
      options: [
        { value: "", label: "Any category" },
        ...ATTENTION_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      ],
    },
  ];

  const mineNote = q.mine ? " assigned to you" : "";
  const emptyAllClear = !narrowed && (q.status === "open" || q.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs don't stall past attention."
        description="Attention Center: items open on their own when a lead or job stalls and close on their own once it's handled."
        actions={<AttentionToolbar mine={q.mine} />}
      />

      {readOnly && (
        <Alert>
          <AlertDescription>
            You&apos;re viewing as another user, so this list is read-only. Exit View as user to
            assign, snooze or resolve items.
          </AlertDescription>
        </Alert>
      )}

      <section
        aria-label="Attention totals"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="Needs Attention Now"
          value={fmt(s.now)}
          caption="Critical and high items still pending"
          icon={Flame}
          tone="danger"
          href={attentionHref(DEFAULT_QUERY, { status: "pending", priority: "urgent" })}
        />
        <KpiCard
          label="Overdue / At-Risk"
          value={fmt(s.overdue)}
          caption="Open items past their due time"
          icon={Clock}
          tone="warning"
          href={attentionHref(DEFAULT_QUERY, { overdue: true })}
        />
        <KpiCard
          label="Awaiting Response"
          value={fmt(s.awaiting_response)}
          caption="Open communication items (customers waiting on us)"
          icon={MessageSquare}
          tone="info"
          href={attentionHref(DEFAULT_QUERY, { category: "communication" })}
        />
        <KpiCard
          label="In Progress"
          value={fmt(s.in_progress)}
          caption={`Someone has started · ${plural(s.snoozed, "snoozed item")}`}
          icon={PlayCircle}
          tone="success"
          href={attentionHref(DEFAULT_QUERY, { status: "in_progress" })}
        />
      </section>

      <AttentionFilters
        selects={selects}
        search={q.q}
        clearParams={["priority", "type", "category", "due", "q"]}
      />

      <section aria-labelledby="attention-list-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="attention-list-title" className="text-base font-semibold text-bb-ink">
              {STATUS_VIEW_LABELS[q.status]}
              {q.overdue ? " · past due" : ""}
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {page.total === 0
                ? `No items${mineNote}.`
                : `Showing ${fmt(first)}–${fmt(last)} of ${plural(page.total, "item")}${mineNote}.`}{" "}
              {resolvedView
                ? "Most recently resolved first."
                : q.sort === "urgency"
                  ? "Sorted by urgency: priority, then how overdue, then age."
                  : "Sorted by priority, then due time."}
            </p>
          </div>
          {!resolvedView && (
            <div className="flex flex-wrap gap-2">
              {q.sort === "urgency" ? (
                <Button asChild variant="outline" className="h-11 sm:h-9">
                  <Link href={attentionHref(q, { sort: "default" })} scroll={false}>
                    Default order
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="cta" className="h-11 sm:h-9">
                  <Link
                    href={attentionHref(q, { sort: "urgency" })}
                    scroll={false}
                    title="Re-sorts by a fixed urgency score (not AI): priority, then how overdue, then age."
                  >
                    <ArrowDownWideNarrow aria-hidden />
                    Prioritize
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>

        {page.error && (
          <Alert variant="destructive">
            <AlertDescription>
              The list didn&apos;t load. Refresh, and tell an owner if it keeps happening.
            </AlertDescription>
          </Alert>
        )}
        {page.capped && (
          <p className="text-xs text-muted-foreground">
            Urgency order covers the first {fmt(URGENCY_CAP)} matching items. Narrow the filters to
            rank the rest.
          </p>
        )}

        {page.items.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Attention items">
            {page.items.map((item) => (
              <AttentionItem
                key={item.id}
                item={item}
                people={page.people}
                actions={ACTIONS}
                readOnly={readOnly}
              />
            ))}
          </ul>
        ) : emptyAllClear && !page.error ? (
          <EmptyState icon={PartyPopper} title="All caught up!">
            Nothing{mineNote} needs attention right now. New items show up here on their own when a
            lead or job stalls.
          </EmptyState>
        ) : (
          !page.error && (
            <EmptyState
              icon={q.status === "snoozed" ? AlarmClockOff : SearchX}
              title={narrowed ? "Nothing matches these filters" : "Nothing here"}
              action={
                <Button asChild variant="outline" className="h-11 sm:h-9">
                  <Link href={attentionHref(DEFAULT_QUERY, { mine: q.mine })}>Show open items</Link>
                </Button>
              }
            >
              {q.status === "snoozed"
                ? "No snoozed items. Snoozed items come back on their own at the time you picked."
                : q.status === "resolved"
                  ? "Nothing was resolved in the last 7 days with these filters."
                  : "Try clearing a filter or the search."}
            </EmptyState>
          )
        )}

        {page.total > PAGE_SIZE && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Page {fmt(q.page)} of {fmt(pages)}
            </p>
            <div className="flex gap-2">
              {q.page > 1 ? (
                <Button asChild variant="outline" className="h-11 sm:h-9">
                  <Link href={attentionHref(q, { page: q.page - 1 })}>
                    <ChevronLeft aria-hidden />
                    Previous
                  </Link>
                </Button>
              ) : null}
              {q.page < pages ? (
                <Button asChild variant="outline" className="h-11 sm:h-9">
                  <Link href={attentionHref(q, { page: q.page + 1 })}>
                    Next
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
