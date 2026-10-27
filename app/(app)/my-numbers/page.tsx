import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { ViewDataDialog, type DataRow } from "@/components/kpi/view-data-dialog";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import {
  MY_NUMBERS_LABELS,
  MY_NUMBERS_PRESETS,
  parsePeriodParams,
  periodQuery,
} from "@/lib/domain/analytics/periods";
import { cn } from "@/lib/utils";
import {
  MY_NUMBERS_METRICS,
  formatMoney,
  myNumbersValue,
  parseMyNumbers,
  type MyNumbersMetricId,
} from "@/lib/metrics/registry";
import { RepPicker } from "./rep-picker";

export const metadata: Metadata = { title: "My Numbers" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CARDS: { id: MyNumbersMetricId; extra?: MyNumbersMetricId }[] = [
  { id: "mine.leads_issued" },
  { id: "mine.walkthroughs_set" },
  { id: "mine.walkthroughs_ran" },
  { id: "mine.estimates_sent" },
  { id: "mine.sold_value", extra: "mine.sold_count" },
  { id: "mine.completed" },
  { id: "mine.invoiced", extra: "mine.paid" },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * My Numbers (SPEC §8.15): a personal scoreboard. Each card counts on its own
 * date field (the page says which); clicking a card lists its records. Owners
 * can view any rep. Commissions arrive with the commissions engine (Phase 10).
 */
export default async function MyNumbersPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  if (!viewer.can("leads:read") && !viewer.can("jobs:read")) notFound();
  const sp = await searchParams;
  const range = parsePeriodParams(sp, MY_NUMBERS_PRESETS, "this_month");
  const repRaw = typeof sp.rep === "string" ? sp.rep : null;
  const rep = viewer.isOwner && repRaw && UUID.test(repRaw) ? repRaw : viewer.id;
  const cardRaw = typeof sp.card === "string" ? sp.card : null;
  const card = CARDS.find((c) => c.id === cardRaw)?.id ?? null;
  const db = await createSupabaseServerClient();
  const [numbersRes, peopleRes] = await Promise.all([
    db.rpc("my_numbers", { p_user: rep, p_from: range.from, p_to: range.to }),
    viewer.isOwner
      ? db.from("profiles").select("id, full_name").eq("is_active", true).order("full_name")
      : Promise.resolve(null),
  ]);
  if (numbersRes.error) logError("my_numbers", numbersRes.error);
  const n = parseMyNumbers(numbersRes.data);
  const repName =
    rep === viewer.id
      ? "You"
      : ((peopleRes?.data ?? []).find((p) => p.id === rep)?.full_name ?? "Rep");

  const base = new URLSearchParams({
    ...periodQuery(range),
    ...(rep !== viewer.id ? { rep } : {}),
  });
  const cardHref = (id: MyNumbersMetricId) => {
    const q = new URLSearchParams(base);
    if (card !== id) q.set("card", id);
    return `/my-numbers?${q.toString()}#records`;
  };

  // Records behind the selected card (same date field as its count).
  let records: { columns: { key: string; label: string }[]; rows: DataRow[] } | null = null;
  if (card) {
    const lim = 50;
    switch (card) {
      case "mine.leads_issued": {
        const { data } = await db
          .from("leads")
          .select("id, first_name, last_name, status, lead_source, created_at")
          .eq("owner_id", rep)
          .gte("created_at", range.from)
          .lt("created_at", range.to)
          .order("created_at", { ascending: false })
          .limit(lim);
        records = {
          columns: [
            { key: "name", label: "Lead" },
            { key: "status", label: "Status" },
            { key: "source", label: "Source" },
            { key: "when", label: "Created" },
          ],
          rows: (data ?? []).map((l) => ({
            name: {
              text: [l.first_name, l.last_name].filter(Boolean).join(" "),
              href: `/leads/${l.id}`,
            },
            status: l.status.replaceAll("_", " "),
            source: l.lead_source.replaceAll("_", " "),
            when: formatDateTime(l.created_at),
          })),
        };
        break;
      }
      case "mine.walkthroughs_set":
      case "mine.walkthroughs_ran": {
        let q = db
          .from("appointments")
          .select("id, title, starts_at, status, completed_at, created_at, job_id, lead_id")
          .eq("type", "walkthrough");
        q =
          card === "mine.walkthroughs_set"
            ? q.eq("created_by", rep).gte("created_at", range.from).lt("created_at", range.to)
            : q
                .eq("status", "completed")
                .contains("assigned_user_ids", [rep])
                .gte("completed_at", range.from)
                .lt("completed_at", range.to);
        const { data } = await q.order("starts_at", { ascending: false }).limit(lim);
        records = {
          columns: [
            { key: "what", label: "Walkthrough" },
            { key: "when", label: "Time" },
            { key: "status", label: "Status" },
          ],
          rows: (data ?? []).map((a) => ({
            what: {
              text: a.title ?? "Walkthrough",
              href: a.job_id
                ? `/jobs/${a.job_id}?section=schedule`
                : a.lead_id
                  ? `/leads/${a.lead_id}`
                  : "#",
            },
            when: formatDateTime(a.starts_at),
            status: a.status.replaceAll("_", " "),
          })),
        };
        break;
      }
      case "mine.estimates_sent":
      case "mine.sold_value":
      case "mine.sold_count": {
        let q = db
          .from("report_estimates")
          .select(
            "id, estimate_number, job_id, job_name, status, first_sent_at, accepted_at, total_cents",
          )
          .eq("owner_id", rep);
        q =
          card === "mine.estimates_sent"
            ? q.gte("first_sent_at", range.from).lt("first_sent_at", range.to)
            : q.eq("status", "accepted").gte("accepted_at", range.from).lt("accepted_at", range.to);
        const { data } = await q
          .order(card === "mine.estimates_sent" ? "first_sent_at" : "accepted_at", {
            ascending: false,
          })
          .limit(lim);
        records = {
          columns: [
            { key: "est", label: "Estimate" },
            { key: "job", label: "Job" },
            { key: "when", label: card === "mine.estimates_sent" ? "First sent" : "Accepted" },
            { key: "total", label: "Total" },
          ],
          rows: (data ?? []).map((e) => ({
            est: {
              text: e.estimate_number ?? "Estimate",
              href: `/jobs/${e.job_id}?section=estimate`,
            },
            job: e.job_name,
            when: formatDateTime(card === "mine.estimates_sent" ? e.first_sent_at : e.accepted_at),
            total: formatMoney(e.total_cents),
          })),
        };
        break;
      }
      default: {
        const col =
          card === "mine.completed"
            ? "completed_at"
            : card === "mine.paid"
              ? "paid_in_full_at"
              : "final_invoiced_at";
        const { data } = await db
          .from("jobs")
          .select("id, job_number, name, stage, completed_at, final_invoiced_at, paid_in_full_at")
          .eq("owner_id", rep)
          .gte(col, range.from)
          .lt(col, range.to)
          .order(col, { ascending: false })
          .limit(lim);
        records = {
          columns: [
            { key: "job", label: "Job" },
            { key: "stage", label: "Stage" },
            { key: "when", label: MY_NUMBERS_METRICS[card].label },
          ],
          rows: (data ?? []).map((j) => ({
            job: { text: `${j.job_number} · ${j.name}`, href: `/jobs/${j.id}` },
            stage: j.stage.replaceAll("_", " "),
            when: formatDate(j[col]),
          })),
        };
      }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="My Numbers"
        description={`${repName === "You" ? "Your" : `${repName}'s`} scoreboard · ${range.label}. Each card counts on its own date field (shown under the number), so the cards don't have to add up.`}
        actions={
          viewer.isOwner ? (
            <RepPicker
              people={(peopleRes?.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))}
              value={rep}
              self={viewer.id}
            />
          ) : undefined
        }
      />
      <AnalyticsFilterBar
        presets={MY_NUMBERS_PRESETS}
        preset={range.preset}
        custom={range.custom}
        labels={MY_NUMBERS_LABELS}
        idPrefix="mn"
      />
      <section
        aria-label="Scoreboard"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {CARDS.map((c) => {
          const v = myNumbersValue(c.id, n);
          const extra = c.extra ? myNumbersValue(c.extra, n) : null;
          const m = MY_NUMBERS_METRICS[c.id];
          return (
            <Link
              key={c.id}
              href={cardHref(c.id)}
              aria-current={card === c.id ? "true" : undefined}
              data-metric={c.id}
              className={cn(
                "flex flex-col gap-1 rounded-2xl border bg-card p-4 hover:border-bb-forest/40",
                card === c.id && "border-bb-forest ring-2 ring-bb-forest/20",
              )}
            >
              <span className="text-sm font-medium text-muted-foreground">
                {c.id === "mine.sold_value"
                  ? "Sold"
                  : c.id === "mine.invoiced"
                    ? "Invoiced / Paid"
                    : v.label}
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {v.display}
                {extra && (
                  <span className="ml-2 text-base font-semibold text-muted-foreground">
                    {c.id === "mine.sold_value" ? `${extra.display} jobs` : `${extra.display} paid`}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{m.caption}</span>
              <span className="text-[11px] text-muted-foreground">Date field: {m.dateField}</span>
            </Link>
          );
        })}
      </section>
      <section id="records" aria-labelledby="records-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="records-title" className="text-base font-semibold">
            {card ? MY_NUMBERS_METRICS[card].label : "Records"}
          </h2>
          {records && (
            <ViewDataDialog
              title={`My Numbers – ${MY_NUMBERS_METRICS[card!].label}`}
              description={`${range.label} · ${MY_NUMBERS_METRICS[card!].description} (first 50).`}
              dataset={card!}
              kind="kpi_table"
              filters={{ ...periodQuery(range), rep }}
              columns={records.columns}
              rows={records.rows}
            />
          )}
        </div>
        {!records ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Click a card to see the records behind it.
          </p>
        ) : records.rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing here for {range.label.toLowerCase()} yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">{MY_NUMBERS_METRICS[card!].label}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {records.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {records!.columns.map((c, j) => {
                      const v = r[c.key];
                      const content =
                        v && typeof v === "object" ? (
                          <Link
                            href={v.href}
                            className="font-medium text-bb-forest hover:underline"
                          >
                            {v.text}
                          </Link>
                        ) : (
                          (v ?? "—")
                        );
                      return j === 0 ? (
                        <th key={c.key} scope="row" className="px-3 py-1.5 text-left font-normal">
                          {content}
                        </th>
                      ) : (
                        <td key={c.key} className="px-3 py-1.5">
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
