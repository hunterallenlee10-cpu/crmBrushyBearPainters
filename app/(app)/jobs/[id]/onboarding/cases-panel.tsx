import Link from "next/link";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptySection } from "@/components/jobs/empty-section";
import {
  CasePriorityBadge,
  CaseSlaBadge,
  CaseStatusBadge,
  CaseTypeLabel,
} from "@/components/cases/case-badges";
import type { CaseListItem } from "@/lib/cases/load";
import { formatDateTime } from "@/lib/format/dates";

/** The job's warranty and service cases (Onboarding → Cases, SPEC §8.5 #2). */
export function JobCasesPanel({
  jobId,
  cases,
  canManage,
  now,
}: {
  jobId: string;
  cases: CaseListItem[] | null;
  canManage: boolean;
  now: Date;
}) {
  if (cases === null) {
    return (
      <EmptySection icon={FolderOpen} title="Cases">
        <p>Cases are hidden for your role.</p>
      </EmptySection>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <Button asChild size="sm" variant="outline" className="self-start">
          <Link href={`/cases/new?job=${jobId}`}>
            <Plus className="size-4" aria-hidden /> New case
          </Link>
        </Button>
      )}
      {cases.length === 0 ? (
        <EmptySection icon={FolderOpen} title="No cases">
          <p>
            When the customer reports an issue or asks for a touch-up, open a case so it gets a
            visit and an answer within the SLA.
          </p>
        </EmptySection>
      ) : (
        <ul className="flex flex-col gap-2">
          {cases.map((c) => (
            <li key={c.id} className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/cases/${c.id}`}
                  className="font-medium text-bb-forest hover:underline"
                >
                  {c.title}
                </Link>
                <span className="text-xs text-muted-foreground tabular-nums">{c.number}</span>
                <CaseStatusBadge status={c.status} />
                <CasePriorityBadge priority={c.priority} />
                <CaseSlaBadge status={c.status} slaDueAt={c.slaDueAt} now={now} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <CaseTypeLabel type={c.type} /> · SLA{" "}
                <time dateTime={c.slaDueAt}>{formatDateTime(c.slaDueAt)}</time>
                {c.ownerName ? ` · ${c.ownerName}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
