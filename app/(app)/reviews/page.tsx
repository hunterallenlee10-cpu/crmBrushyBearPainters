import type { Metadata } from "next";
import Link from "next/link";
import { MousePointerClick, Send, Star, ThumbsUp } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { loadMessagingSettings } from "@/lib/messaging/core";
import { loadCommunicationStats } from "@/lib/messaging/stats";
import { communicationMetricValue, type CommunicationMetricId } from "@/lib/metrics/registry";
import { ReviewMark } from "./review-mark";

export const metadata: Metadata = { title: "Reviews" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE = 50;

const KPIS: { id: CommunicationMetricId; icon: typeof Send }[] = [
  { id: "reviews.requested", icon: Send },
  { id: "reviews.click_rate", icon: MousePointerClick },
  { id: "reviews.review_rate", icon: ThumbsUp },
  { id: "reviews.avg_rating", icon: Star },
];

const STATUS: Record<
  string,
  { label: string; variant: "info" | "success" | "neutral" | "warning" }
> = {
  sent: { label: "Sent", variant: "info" },
  clicked: { label: "Clicked", variant: "warning" },
  reviewed: { label: "Reviewed", variant: "success" },
  skipped: { label: "Not sent", variant: "neutral" },
};

/**
 * Reviews (SPEC §8.16): every review request the Paid-in-Full workflow sent,
 * whether the customer clicked the link, and whether they left a review. The
 * delay and wording live in Messaging settings and the review templates.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("reviews:manage");
  const sp = await searchParams;
  const pageRaw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const page = Math.max(1, Math.min(200, Number.parseInt(pageRaw ?? "1", 10) || 1));
  const supabase = await createSupabaseServerClient();
  const [stats, list, company] = await Promise.all([
    loadCommunicationStats(supabase, { days: 365 }),
    supabase
      .from("review_requests")
      .select(
        "id, status, channel, sent_at, clicked_at, click_count, review_left, rating, skipped_reason, created_at, job:jobs(id, name, job_number), contact:contacts(first_name, last_name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("company_settings").select("review_link").maybeSingle(),
  ]);
  const settings = await loadMessagingSettings(supabase, viewer.orgId);
  const rows = list.data ?? [];
  const pages = Math.max(1, Math.ceil((list.count ?? rows.length) / PAGE));

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description={`Review requests go out ${settings.engine.reviewDelayDays} days after Paid in Full (workflow 15) with a tracked link. Mark a request when the review shows up.`}
      />
      {!company.data?.review_link && (
        <p role="status" className="rounded-2xl border border-bb-honey bg-bb-honey/10 p-3 text-sm">
          The review link isn&apos;t set yet, so customers who click land on a thank-you page. Add
          it in{" "}
          <Link href="/admin/company" className="underline">
            Company Settings
          </Link>
          .
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => {
          const v = communicationMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={k.icon}
            />
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Change the delay in{" "}
        <Link href="/admin/templates/settings" className="text-bb-forest underline">
          Messaging settings
        </Link>{" "}
        and the wording in the{" "}
        <Link href="/admin/templates?q=review" className="text-bb-forest underline">
          review templates
        </Link>
        .
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={Star} title="No review requests yet">
          They start two days after a job is paid in full.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Review requests</caption>
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Job
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Sent
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Clicked
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Review
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, variant: "neutral" as const };
                const who = r.contact
                  ? [r.contact.first_name, r.contact.last_name].filter(Boolean).join(" ")
                  : null;
                const label = r.job?.name ?? "Job";
                return (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      {r.job ? (
                        <Link
                          href={`/jobs/${r.job.id}`}
                          className="font-medium text-bb-forest hover:underline"
                        >
                          {r.job.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[who, r.job?.job_number].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={s.variant}>{s.label}</Badge>
                      {r.skipped_reason && (
                        <div className="mt-1 max-w-64 text-xs text-muted-foreground">
                          {r.skipped_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.sent_at ? formatDateTime(r.sent_at) : "—"}
                      {r.channel ? ` · ${r.channel === "sms" ? "text" : "email"}` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.clicked_at
                        ? `${formatDateTime(r.clicked_at)} · ${r.click_count}×`
                        : "Not yet"}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "skipped" ? (
                        "—"
                      ) : (
                        <ReviewMark
                          id={r.id}
                          reviewLeft={r.review_left}
                          rating={r.rating}
                          label={label}
                          readOnly={viewer.impersonating}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={`/reviews?page=${page - 1}`}>Previous</Link> : <span />}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={`/reviews?page=${page + 1}`}>Next</Link> : <span />}
        </nav>
      )}
    </PageContainer>
  );
}
