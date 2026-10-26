import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { GradeBadge, HotIcon, LeadStatusBadge } from "@/components/leads/lead-badges";
import { formatDate, formatRelative } from "@/lib/format/dates";
import type { Grade, LeadStatus, Temperature } from "@/lib/domain/leads/constants";

export type MiniLead = {
  id: string;
  name: string;
  status: LeadStatus;
  city: string | null;
  sourceLabel: string | null;
  grade: Grade | null;
  score: number | null;
  temperature: Temperature | null;
  createdAt: string;
};

/** My Leads / Recent Leads: the five newest rows with a link to the full list. */
export function LeadMiniList({
  id,
  title,
  caption,
  leads,
  viewAllHref,
  viewAllLabel,
  empty,
  now,
}: {
  id: string;
  title: string;
  caption: string;
  leads: readonly MiniLead[];
  viewAllHref: string;
  viewAllLabel: string;
  empty: string;
  now: Date;
}) {
  return (
    <ChartCard
      id={id}
      title={title}
      caption={caption}
      action={
        <Link
          href={viewAllHref}
          className="inline-flex items-center text-xs font-medium text-bb-forest hover:underline"
        >
          {viewAllLabel}
          <ChevronRight className="size-3" aria-hidden />
        </Link>
      }
    >
      {leads.length === 0 ? (
        <ChartEmpty>{empty}</ChartEmpty>
      ) : (
        <ul className="-mx-1 flex flex-col divide-y">
          {leads.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-1 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/leads/${l.id}`}
                    className="truncate text-sm font-medium text-bb-forest hover:underline"
                  >
                    {l.name}
                  </Link>
                  <HotIcon temperature={l.temperature} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[l.city, l.sourceLabel].filter(Boolean).join(" · ") || "No city yet"} ·{" "}
                  <span title={formatDate(l.createdAt)}>{formatRelative(l.createdAt, now)}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <LeadStatusBadge status={l.status} />
                <GradeBadge grade={l.grade} score={l.score} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
