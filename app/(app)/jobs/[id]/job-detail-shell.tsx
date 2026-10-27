import Link from "next/link";
import { ChevronLeft, Mail, MessageSquareText, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/layout/stage-badge";
import { HealthBadge, HoldPill, PriorityBadge } from "@/components/jobs/job-badges";
import { ReasonButton } from "@/components/leads/reason-button";
import { JOB_SECTIONS } from "@/lib/domain/jobs/constants";
import type { JobDetailData } from "./types";
import { holdShortLabel, sectionHref } from "./utils";
import { JobKebab } from "./job-kebab";
import { SectionNav, type NavItem } from "./section-nav";

/**
 * Job Detail frame (SPEC §8.5): sticky header with the job number, customer,
 * stage, holds, priority and health, then the left section nav and the
 * selected section.
 */
export function JobDetailShell({
  data,
  children,
}: {
  data: JobDetailData;
  children: React.ReactNode;
}) {
  const { job, can } = data;
  const activeHolds = data.holds.filter((h) => !h.releasedAt);
  const openAppointments = data.appointments.filter((a) =>
    ["tentative", "scheduled", "confirmed", "in_progress"].includes(a.status),
  ).length;

  const counts: Partial<Record<NavItem["id"], number | null>> = {
    onboarding: activeHolds.length || null,
    schedule: data.can.readAppointments ? openAppointments || null : null,
    tasks: data.counts.openTasks || null,
    notes: data.counts.notes || null,
  };
  const items: NavItem[] = JOB_SECTIONS.filter((s) => s.id !== "admin" || can.override).map(
    (s) => ({
      id: s.id,
      label: s.label,
      href: sectionHref(job.id, s.id),
      count: counts[s.id] ?? null,
    }),
  );
  const contactReason = !can.readMessages ? "You don't have access to customer messages." : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="z-30 -mx-4 -mt-6 border-b bg-background/95 px-4 pt-4 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6 lg:sticky lg:top-14 print:static">
        <Link
          href="/jobs/list"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline print:hidden"
        >
          <ChevronLeft className="size-3" aria-hidden />
          Back to jobs
        </Link>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-bb-ink tabular-nums">Job #{job.number}</span>
              {" · "}Customer:{" "}
              {job.accountName ? (
                <Link
                  href={`/accounts/${job.accountId}`}
                  className="font-medium text-bb-forest hover:underline"
                >
                  {job.accountName}
                </Link>
              ) : (
                <span>Not visible to you</span>
              )}
              {" · "}
              {job.accountJobCount} {job.accountJobCount === 1 ? "job" : "jobs"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-2xl font-bold tracking-tight break-words text-bb-ink">
                {job.name}
              </h1>
              <StageBadge stage={job.stage} />
              {activeHolds.map((h) => (
                <HoldPill key={h.id} label={holdShortLabel(h.label)} blocks={h.blocksScheduling} />
              ))}
              <PriorityBadge priority={job.priority} />
              <HealthBadge score={job.healthScore} />
            </div>
          </div>

          <div
            className="flex flex-wrap gap-2 xl:shrink-0 xl:flex-nowrap print:hidden"
            role="group"
            aria-label="Job actions"
          >
            {contactReason ? (
              <>
                <ReasonButton size="sm" variant="outline" disabledReason={contactReason}>
                  <Phone aria-hidden />
                  Call
                </ReasonButton>
                <ReasonButton size="sm" variant="outline" disabledReason={contactReason}>
                  <MessageSquareText aria-hidden />
                  Text
                </ReasonButton>
                <ReasonButton size="sm" variant="outline" disabledReason={contactReason}>
                  <Mail aria-hidden />
                  Email
                </ReasonButton>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={sectionHref(job.id, "messages", "compose=call")}>
                    <Phone aria-hidden />
                    Call
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={sectionHref(job.id, "messages", "compose=sms")}>
                    <MessageSquareText aria-hidden />
                    Text
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={sectionHref(job.id, "messages", "compose=email")}>
                    <Mail aria-hidden />
                    Email
                  </Link>
                </Button>
              </>
            )}
            <JobKebab
              jobId={job.id}
              jobLabel={`${job.number} · ${job.name}`}
              canDelete={can.delete}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <SectionNav
          items={items}
          current={data.section}
          shortcuts={{
            resultHref: sectionHref(job.id, "overview", "result=walkthrough"),
            resultReason: resultWalkthroughReason(data),
            estimateHref: sectionHref(job.id, "estimate"),
            estimateReason: data.can.readEstimates ? null : "Your role doesn't include estimates.",
          }}
        />
        <section className="min-w-0 flex-1" aria-labelledby="job-section-title">
          {children}
        </section>
      </div>
    </div>
  );
}

/** Why "Result Walkthrough" can't be used right now (null when it can). */
function resultWalkthroughReason(data: JobDetailData): string | null {
  if (data.readOnly) return "You're viewing as another user. Exit View as user to make changes.";
  if (!data.can.manageAppointments) return "You don't have permission to update appointments.";
  const open = data.appointments.some(
    (a) =>
      a.type === "walkthrough" &&
      ["tentative", "scheduled", "confirmed", "in_progress"].includes(a.status),
  );
  return open ? null : "There's no open walkthrough on this job. Book one first.";
}
