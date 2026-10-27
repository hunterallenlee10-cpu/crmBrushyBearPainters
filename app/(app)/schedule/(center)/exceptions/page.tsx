import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { ATTENTION_RULES, isAttentionRuleKey, PRIORITY_LABELS } from "@/lib/domain/attention/rules";
import { formatDateTime } from "@/lib/format/dates";
import { ResolveButton } from "./resolve-button";

export const metadata: Metadata = { title: "Exceptions" };

const RULES = [
  "start_date_missed",
  "missing_crew",
  "paint_not_ordered",
  "missed_daily_update",
  "punch_list_open",
  "weather_risk",
  "sub_compliance_expiring",
  "ready_not_scheduled",
  "onboarding_stalled",
];

const ACTION: Record<string, string> = {
  start_date_missed: "Start the job, or reschedule with the customer. Review the on-time credit.",
  missing_crew: "Assign a crew in the Crew Queue or on the job.",
  paint_not_ordered: "Place the order in Paint Orders.",
  missed_daily_update: "Ask the crew lead to post the daily log with photos.",
  punch_list_open: "Fix the touch-ups or capture the customer's sign-off.",
  weather_risk: "Mark a rain delay or move the day.",
  sub_compliance_expiring: "Upload the renewed paperwork in Subcontractors.",
  ready_not_scheduled: "Put it on the Master Schedule.",
  onboarding_stalled: "Work the open onboarding items.",
};

const VARIANT = { critical: "danger", high: "warning", medium: "info", low: "neutral" } as const;

/** Exceptions (SPEC §8.6): rule-generated production issues with severity, owner and the next step. */
export default async function ExceptionsPage() {
  await requirePermission("attention:read");
  const supabase = await createSupabaseServerClient();
  const { data: items } = await supabase
    .from("attention_items")
    .select(
      "id, rule_key, priority, title, detail, subject_type, subject_id, owner_id, opened_at, status",
    )
    .neq("status", "resolved")
    .in("rule_key", RULES)
    .order("opened_at", { ascending: true })
    .limit(500);
  const ownerIds = [
    ...new Set((items ?? []).map((i) => i.owner_id).filter((x): x is string => !!x)),
  ];
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
    : { data: [] as { id: string; full_name: string }[] };
  const name = new Map((owners ?? []).map((o) => [o.id, o.full_name]));
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const rows = [...(items ?? [])].sort(
    (a, b) =>
      (rank[a.priority as keyof typeof rank] ?? 9) - (rank[b.priority as keyof typeof rank] ?? 9),
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exceptions"
        description="Production problems the rules found: late starts, missing crews, paint, daily updates, punch lists and subcontractor paperwork. They close on their own once fixed."
      />
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="All caught up!">
          <p>No production exceptions right now.</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((i) => {
            const p =
              (["critical", "high", "medium", "low"] as const).find((x) => x === i.priority) ??
              "medium";
            return (
              <li
                key={i.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={VARIANT[p]}>{PRIORITY_LABELS[p]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {isAttentionRuleKey(i.rule_key)
                        ? ATTENTION_RULES[i.rule_key].label
                        : i.rule_key}{" "}
                      · since {formatDateTime(i.opened_at)}
                    </span>
                  </div>
                  <Link
                    href={
                      i.subject_type === "job"
                        ? `/jobs/${i.subject_id}?section=schedule`
                        : `/admin/subcontractors?id=${i.subject_id}`
                    }
                    className="mt-1 block font-medium hover:underline"
                  >
                    {i.title}
                  </Link>
                  {i.detail && <p className="text-sm text-muted-foreground">{i.detail}</p>}
                  <p className="mt-1 text-sm">
                    <span className="font-medium">Next: </span>
                    {ACTION[i.rule_key] ?? "Open the record."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Owner: {i.owner_id ? (name.get(i.owner_id) ?? "Teammate") : "Unassigned"}
                  </p>
                </div>
                <ResolveButton id={i.id} title={i.title} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
