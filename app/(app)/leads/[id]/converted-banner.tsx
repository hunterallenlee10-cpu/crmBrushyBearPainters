import Link from "next/link";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import type { ThreadItem } from "./types";

/** "Converted to job BB-2026-0001" from the lead's timeline (written by the conversion). */
export function jobNumberFromThread(thread: readonly ThreadItem[]): string | null {
  for (const item of thread) {
    if (item.kind !== "event" || item.type !== "converted") continue;
    const m = /\b([A-Z]{2,}-\d{4}-\d{3,})\b/.exec(item.summary ?? "");
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Shown on a converted lead: the lead is read-only and the work continues on the job. */
export function ConvertedBanner({
  jobId,
  jobNumber,
  loading,
}: {
  jobId: string | null;
  jobNumber: string | null;
  loading: boolean;
}) {
  return (
    <section
      aria-label="Converted to a job"
      className="flex flex-col gap-2 rounded-2xl border border-bb-border bg-bb-cream-light px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="converted-banner"
    >
      <p className="flex items-start gap-2 text-sm text-bb-ink">
        <BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-bb-forest" aria-hidden />
        <span>
          <strong className="font-semibold">
            This lead is now job {jobNumber ?? "(number unavailable)"}
          </strong>
          {" · "}
          The lead is read-only; keep working on the job.
        </span>
      </p>
      {jobId ? (
        <Link
          href={`/jobs/${jobId}`}
          className="inline-flex w-fit shrink-0 items-center gap-1 rounded-md bg-bb-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-bb-forest-dark"
        >
          Open job
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : (
        !loading && (
          <span className="text-xs text-muted-foreground">
            You don&apos;t have access to this job. Ask its owner.
          </span>
        )
      )}
    </section>
  );
}
