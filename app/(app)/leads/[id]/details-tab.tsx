import Link from "next/link";
import { ExternalLink, FileText, ImageOff, MapPin, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScoreFactors } from "@/components/leads/score-factors";
import { ScoreSummary } from "@/components/leads/score-summary";
import { LeadStatusBadge } from "@/components/leads/lead-badges";
import { formatAppointment, formatDate, formatDateTime } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";
import { HOME_BUILT_LABELS, SERVICE_LABELS, TIMELINE_LABELS } from "@/lib/domain/leads/constants";
import { cn } from "@/lib/utils";
import type { Labeler } from "./labels";
import type { LeadDetailData } from "./types";
import { mapsUrl } from "./utils";

const INTAKE_LABELS: Record<string, string> = {
  manual: "Entered by hand",
  website: "Website form",
  import: "Import",
  referral: "Referral link",
};

function Section({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted-foreground sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {empty ? <span className="text-muted-foreground">—</span> : children}
      </dd>
    </div>
  );
}

const List = ({ children }: { children: React.ReactNode }) => (
  <dl className="flex flex-col gap-2.5">{children}</dl>
);

export function DetailsTab({ data, label }: { data: LeadDetailData; label: Labeler }) {
  const { lead } = data;
  const hoa = lead.hasHoa === null ? null : lead.hasHoa ? "Yes" : "No";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <details open className="group rounded-2xl border bg-card p-5 lg:col-span-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Lead score</h2>
            <ScoreSummary grade={lead.grade} score={lead.score} temperature={lead.temperature} />
          </span>
          <span className="text-xs text-muted-foreground">
            <span className="group-open:hidden">Show factors</span>
            <span className="hidden group-open:inline">Hide factors</span>
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <ScoreFactors factors={lead.factors} />
          <p className="text-xs text-muted-foreground">
            {lead.scoredAt ? `Scored on ${formatDateTime(lead.scoredAt)}` : "Not scored yet"}. The
            score is rule-based: it starts at 50 and adds the points above.
            {data.can.manageScoring && (
              <>
                {" "}
                <Link href="/admin/lead-scoring" className="font-medium text-bb-forest underline">
                  Change the weights in Admin → Lead Scoring
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </details>

      <Section title="Contact information">
        <List>
          <Item label="Name">{lead.name}</Item>
          <Item label="Company">{lead.company}</Item>
          <Item label="Mobile">
            {lead.mobile && (
              <a href={`tel:${lead.mobile}`} className="tabular-nums hover:underline">
                {formatPhone(lead.mobile)}
              </a>
            )}
          </Item>
          <Item label="Phone">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="tabular-nums hover:underline">
                {formatPhone(lead.phone)}
              </a>
            )}
          </Item>
          <Item label="Email">{lead.email}</Item>
          {lead.disposition === "do_not_contact" && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <TriangleAlert className="size-4" aria-hidden />
              Do not contact. Texts, emails and calls are blocked.
            </p>
          )}
        </List>
      </Section>

      <Section
        title="Address"
        action={
          lead.address ? (
            <a
              href={mapsUrl(lead.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-bb-forest hover:underline"
            >
              <MapPin className="size-4" aria-hidden />
              Open in Maps
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : undefined
        }
      >
        <List>
          <Item label="Street">
            {lead.street && [lead.street, lead.unit].filter(Boolean).join(", ")}
          </Item>
          <Item label="City">{lead.city}</Item>
          <Item label="State / ZIP">{[lead.state, lead.zip].filter(Boolean).join(" ")}</Item>
          <Item label="Territory">
            {lead.outOfArea ? (
              <Badge variant="warning">Outside service area</Badge>
            ) : (
              lead.territoryName
            )}
          </Item>
        </List>
      </Section>

      <Section title="Lead details">
        <List>
          <Item label="Status">
            <span className="inline-flex flex-wrap items-center gap-2">
              <LeadStatusBadge status={lead.status} />
              {lead.status === "lost" && lead.lostReason && (
                <span className="text-muted-foreground">
                  · {label("lost_reason", lead.lostReason)}
                </span>
              )}
            </span>
          </Item>
          <Item label="Disposition">{label("lead_disposition", lead.disposition)}</Item>
          <Item label="Source">{label("lead_source", lead.leadSource)}</Item>
          <Item label="Sub-source">{label("lead_sub_source", lead.leadSubSource)}</Item>
          <Item label="Services">
            {lead.services.length ? lead.services.map((s) => SERVICE_LABELS[s]).join(", ") : null}
          </Item>
          <Item label="Timeline">{lead.timeline ? TIMELINE_LABELS[lead.timeline] : null}</Item>
          <Item label="Property type">{label("property_type", lead.propertyType)}</Item>
          <Item label="Stories">{lead.stories}</Item>
          <Item label="Siding">{label("siding_type", lead.sidingType)}</Item>
          <Item label="HOA">{hoa}</Item>
          <Item label="Home built">
            {lead.yearBuilt || lead.homeBuilt ? (
              <span className="flex flex-col gap-1">
                <span>
                  {[lead.yearBuilt, lead.homeBuilt ? HOME_BUILT_LABELS[lead.homeBuilt] : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {lead.leadSafe && (
                  <span className="inline-flex items-start gap-1.5 text-xs text-warning">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Built before 1978 or not sure: plan for lead-safe work practices. Confirm at the
                    walkthrough.
                  </span>
                )}
              </span>
            ) : null}
          </Item>
          <Item label="Lead set by">{lead.leadSetByName}</Item>
          <Item label="Owner">{lead.ownerName ?? "Unassigned"}</Item>
          <Item label="Customer notes">
            {lead.customerNotes && (
              <span className="whitespace-pre-wrap">{lead.customerNotes}</span>
            )}
          </Item>
        </List>
      </Section>

      <div className="flex flex-col gap-4">
        <Section title="Assignment & scheduling">
          <List>
            <Item label="Owner">{lead.ownerName ?? "Unassigned"}</Item>
            <Item label="Tentative walkthrough">
              {lead.walkthroughAt ? formatAppointment(lead.walkthroughAt) : null}
            </Item>
            <Item label="Check back on">
              {lead.nurtureUntil ? formatDate(`${lead.nurtureUntil}T12:00:00Z`) : null}
            </Item>
          </List>
          <p className="mt-3 text-xs text-muted-foreground">
            Times are Pacific. Calendar sync needs the calendar integration (not connected).
          </p>
        </Section>

        <Section title="Speed to lead">
          {lead.firstContactedAt ? (
            <List>
              <Item label="First contact">{formatDateTime(lead.firstContactedAt)}</Item>
              <Item label="Speed to lead">
                <span className="font-semibold tabular-nums">
                  {formatDuration(lead.speedToLeadSeconds)}
                </span>{" "}
                <span className="text-muted-foreground">(business hours)</span>
              </Item>
            </List>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not contacted yet. The clock started {formatDateTime(lead.createdAt)}; the first call,
              text or email you log stops it.
            </p>
          )}
        </Section>

        <Section title="Record">
          <List>
            <Item label="Came in from">
              {INTAKE_LABELS[lead.intakeChannel] ?? lead.intakeChannel}
            </Item>
            <Item label="Created">{formatDateTime(lead.createdAt)}</Item>
            <Item label="Last updated">{formatDateTime(lead.updatedAt)}</Item>
            <Item label="Last activity">{formatDateTime(lead.lastActivityAt)}</Item>
          </List>
        </Section>
      </div>

      <Section
        title={`Photos${data.photos.length ? ` (${data.photos.length})` : ""}`}
        className="lg:col-span-2"
      >
        {data.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No photos yet. Photos sent with the website form show up here.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-lg border bg-muted">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="block">
                    {p.isImage ? (
                      // Short-lived signed URL from private storage; next/image can't cache it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.url}
                        alt={`Photo: ${p.fileName}`}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex aspect-square flex-col items-center justify-center gap-1 p-2 text-center text-xs">
                        <FileText className="size-6" aria-hidden />
                        {p.fileName}
                      </span>
                    )}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="flex aspect-square flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
                    <ImageOff className="size-6" aria-hidden />
                    Couldn&apos;t load {p.fileName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
