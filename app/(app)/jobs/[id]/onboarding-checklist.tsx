import { CheckCircle2, Circle, CircleAlert, CircleDashed, MinusCircle } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  ONBOARDING_GROUPS,
  ONBOARDING_GROUP_LABELS,
  ONBOARDING_STATUS_LABELS,
  onboardingProgress,
  type OnboardingGroup,
  type OnboardingStatus,
} from "@/lib/estimating/engine";
import { formatDate } from "@/lib/format/dates";
import { OnboardingSection } from "./onboarding-section";

type Props = Omit<React.ComponentProps<typeof OnboardingSection>, "checklist" | "progress">;

const ICONS: Record<OnboardingStatus, React.ComponentType<{ className?: string }>> = {
  verified: CheckCircle2,
  pending: Circle,
  missing: CircleAlert,
  needs_review: CircleDashed,
  not_required: MinusCircle,
};
const TONE: Record<OnboardingStatus, string> = {
  verified: "text-success",
  pending: "text-muted-foreground",
  missing: "text-danger",
  needs_review: "text-warning",
  not_required: "text-muted-foreground",
};

/**
 * Onboarding with its requirement checklist (SPEC §6.4). The rows are seeded
 * when the customer accepts the estimate; verifying them (and the auto-checks)
 * arrives in Phase 5, so the list is read-only here.
 */
export async function OnboardingWithChecklist(props: Props) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("onboarding_requirements")
    .select("id, key, group_key, label, required, status, verified_at, note, sort_order")
    .eq("job_id", props.jobId)
    .order("sort_order");
  const rows = data ?? [];
  const progress = rows.length ? onboardingProgress(rows) : null;
  const groups = ONBOARDING_GROUPS.map((g) => ({
    key: g,
    items: rows.filter((r) => r.group_key === g),
  })).filter((g) => g.items.length > 0);

  const checklist = rows.length ? (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.key} aria-label={ONBOARDING_GROUP_LABELS[g.key as OnboardingGroup]}>
          <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
            {ONBOARDING_GROUP_LABELS[g.key as OnboardingGroup]}
          </h3>
          <ul className="divide-y rounded-2xl border bg-card">
            {g.items.map((r) => {
              const status = (r.status in ICONS ? r.status : "pending") as OnboardingStatus;
              const Icon = ICONS[status];
              return (
                <li key={r.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                  <Icon className={`size-5 shrink-0 ${TONE[status]}`} aria-hidden />
                  <span className="min-w-0 flex-1 text-sm">
                    {r.label}
                    {!r.required && <span className="text-muted-foreground"> (optional)</span>}
                    {r.note && (
                      <span className="block text-xs text-muted-foreground">{r.note}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ONBOARDING_STATUS_LABELS[status]}
                    {r.verified_at ? ` · ${formatDate(r.verified_at)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        Items clear themselves as the work happens (signed contract, deposit, colors…). Verifying
        the rest by hand arrives in Phase 5.
      </p>
    </div>
  ) : null;

  return <OnboardingSection {...props} checklist={checklist} progress={progress} />;
}
