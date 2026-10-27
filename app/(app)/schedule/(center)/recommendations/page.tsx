import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format/dates";
import { RecActions, RefreshButton } from "./rec-actions";

export const metadata: Metadata = { title: "Recommendations" };

const STATUS_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
  undone: "neutral",
  expired: "neutral",
} as const;

/** Recommendations (SPEC §8.6): rule-based, Require approval ON, Auto-execute OFF, undo window. */
export default async function RecommendationsPage() {
  const viewer = await requirePermission("schedule:manage");
  const supabase = await createSupabaseServerClient();
  const [recs, settings] = await Promise.all([
    supabase
      .from("schedule_recommendations")
      .select(
        "id, kind, job_id, title, detail, score, reasons, status, decided_at, undo_until, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("schedule_settings")
      .select("recommendations_require_approval, recommendations_auto_execute, undo_window_minutes")
      .eq("org_id", viewer.orgId)
      .maybeSingle(),
  ]);
  const s = settings.data;
  const ro = viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Recommendations"
        description="Suggested crews and dates for jobs that are ready, ranked by skills, availability, workload and territory."
        actions={!ro ? <RefreshButton /> : undefined}
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="success">
          Require approval: {s?.recommendations_require_approval === false ? "OFF" : "ON"}
        </Badge>
        <Badge variant="neutral">
          Auto-execute: {s?.recommendations_auto_execute ? "ON" : "OFF"}
        </Badge>
        <Badge variant="info">Undo window: {s?.undo_window_minutes ?? 15} minutes</Badge>
        <Link className="text-bb-forest underline" href="/admin/schedule#policies">
          Change in Schedule Admin
        </Link>
      </div>
      {(recs.data ?? []).length === 0 ? (
        <EmptyState icon={Lightbulb} title="No recommendations yet">
          <p>
            They appear for Ready to Schedule jobs with nothing on the schedule, every 15 minutes or
            when you refresh.
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {(recs.data ?? []).map((r) => {
            const reasons = Array.isArray(r.reasons)
              ? r.reasons.flatMap((x) =>
                  x && typeof x === "object" && !Array.isArray(x) && typeof x.label === "string"
                    ? [`${x.label} (+${typeof x.points === "number" ? x.points : 0})`]
                    : [],
                )
              : [];
            const status =
              (["pending", "approved", "rejected", "undone", "expired"] as const).find(
                (x) => x === r.status,
              ) ?? "expired";
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
                    {r.score !== null && (
                      <span className="text-xs text-muted-foreground">Score {r.score}/100</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.created_at)}
                    </span>
                  </div>
                  <Link
                    href={`/jobs/${r.job_id}?section=schedule`}
                    className="mt-1 block font-medium hover:underline"
                  >
                    {r.title}
                  </Link>
                  {r.detail && <p className="text-sm text-muted-foreground">{r.detail}</p>}
                  {reasons.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{reasons.join(" · ")}</p>
                  )}
                </div>
                {!ro && <RecActions id={r.id} status={r.status} undoUntil={r.undo_until} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
