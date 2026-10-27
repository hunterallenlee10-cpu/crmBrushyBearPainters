import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CircleAlert,
  ExternalLink,
  HeartPulse,
  Info,
  MapPin,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/layout/stage-badge";
import { HealthFactors } from "@/components/jobs/health-factors";
import { MilestonesStepper } from "@/components/jobs/milestones-stepper";
import { formatJobDate, formatMoney } from "@/components/jobs/format";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { labelFor } from "@/lib/jobs/options";
import { healthLabel } from "@/lib/domain/jobs/health";
import { JOB_PRIORITY_LABELS } from "@/lib/domain/jobs/constants";
import { getStage } from "@/lib/domain/stages";
import { OCCUPANCY_LABELS, STORIES_LABELS, isOccupancy } from "@/lib/validation/accounts";
import { cn } from "@/lib/utils";
import type { JobDetailData } from "./types";
import { actionRequired, milestoneSteps, nextHint, sectionHref } from "./utils";
import { StageControls } from "./stage-controls";
import { EditJobButton } from "./edit-job-dialog";
import { AppointmentsCard } from "./appointments-card";

export function Card({
  title,
  id,
  action,
  children,
  className,
}: {
  title: string;
  id: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5", className)} aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Item({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted-foreground sm:w-36 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {empty ? <span className="text-muted-foreground">—</span> : children}
      </dd>
    </div>
  );
}

const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Overview (SPEC §8.5 #1). */
export function Overview({ data }: { data: JobDetailData }) {
  const { job, can, options } = data;
  const workTypeLabels = job.workTypes.map((w) => labelFor(options.picklists.work_type, w));
  const startAtRisk = job.healthFactors.some(
    (f) => f.key === "start_on_track" && f.status === "fail",
  );
  const steps = milestoneSteps(job.stage, {
    leadCreatedAt: job.milestones.lead_created_at,
    createdAt: job.createdAt,
    estimateSentAt: job.milestones.estimate_sent_at,
    estimateAcceptedAt: job.milestones.estimate_accepted_at,
    contractSignedAt: job.milestones.contract_signed_at,
    actualStartDate: job.actualStartDate,
    completedAt: job.milestones.completed_at,
    closedAt: job.milestones.closed_at,
  });
  const hint = nextHint(job.stage);
  const blockingHolds = data.holds
    .filter((h) => !h.releasedAt && h.blocksScheduling)
    .map((h) => h.label);
  const actions = actionRequired({
    stage: job.stage,
    factors: job.healthFactors,
    appointments: data.appointments,
    pendingApproval: data.pendingApproval
      ? { toLabel: getStage(data.pendingApproval.toStage).label }
      : null,
    blockingHolds,
    now: new Date(),
  });
  const p = job.property;
  const failed = job.healthFactors.filter((f) => f.status === "fail");

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {/* Customer card */}
      <Card title="Customer" id="ov-customer" className="xl:col-span-2">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-lg font-semibold">
              {job.accountName ? (
                <Link href={`/accounts/${job.accountId}`} className="hover:underline">
                  {job.accountName}
                </Link>
              ) : (
                "Customer not visible to you"
              )}
            </p>
            {p?.address && (
              <a
                href={mapsUrl(p.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-bb-forest hover:underline"
              >
                <MapPin className="size-3.5" aria-hidden />
                {p.address}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">(opens Google Maps in a new tab)</span>
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {workTypeLabels.map((w) => (
              <Badge key={w} variant="outline">
                {w}
              </Badge>
            ))}
            <StageBadge stage={job.stage} />
            {startAtRisk && (
              <Badge variant="danger">
                <AlertTriangle aria-hidden />
                Start date at risk
              </Badge>
            )}
            {job.healthScore !== null && job.healthScore < 60 && !startAtRisk && (
              <Badge variant="danger">
                <AlertTriangle aria-hidden />
                Health: {healthLabel(job.healthScore)}
              </Badge>
            )}
            {p?.leadSafe && (
              <Badge variant="warning">
                <ShieldAlert aria-hidden />
                Lead-safe (pre-1978)
              </Badge>
            )}
          </div>
          <dl className="grid gap-2.5 sm:grid-cols-2">
            <Item label="Primary contact">
              {job.contact && (
                <span className="flex flex-col">
                  <span>{job.contact.name}</span>
                  {(job.contact.mobile ?? job.contact.phone) && (
                    <a
                      href={`tel:${job.contact.mobile ?? job.contact.phone}`}
                      className="text-muted-foreground tabular-nums hover:underline"
                    >
                      {formatPhone(job.contact.mobile ?? job.contact.phone)}
                    </a>
                  )}
                  {job.contact.email && (
                    <span className="text-muted-foreground">{job.contact.email}</span>
                  )}
                </span>
              )}
            </Item>
            <Item label="Lead source">
              {job.leadSource && (
                <>
                  {labelFor(options.picklists.lead_source, job.leadSource)}
                  {job.leadSubSource &&
                    ` · ${labelFor(options.picklists.lead_sub_source, job.leadSubSource)}`}
                </>
              )}
            </Item>
            <Item label="Point of contact">
              {job.pocName && (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="grid size-6 place-items-center rounded-full bg-bb-forest text-[10px] font-bold text-white"
                    aria-hidden
                  >
                    {job.pocName
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  {job.pocName}
                </span>
              )}
            </Item>
            <Item label="Job date">{formatJobDate(job.createdAt)}</Item>
            <Item label="Last updated">
              <span title={formatDateTime(job.updatedAt)}>{formatRelative(job.updatedAt)}</span>
            </Item>
            {job.leadId && (
              <Item label="From lead">
                <Link href={`/leads/${job.leadId}`} className="text-bb-forest hover:underline">
                  Open the original lead
                </Link>
              </Item>
            )}
          </dl>
        </div>
      </Card>

      {/* Money tiles (financials:read only; crew and estimators never see money) */}
      {can.readFinancials ? (
        <Card title="Money" id="ov-money">
          <div className="grid gap-2">
            <MoneyTile
              icon={BadgeDollarSign}
              label="Contract"
              value={data.contractCents !== null ? formatMoney(data.contractCents) : "Not set"}
              caption={
                data.contractFromEstimate
                  ? "Accepted estimate + signed change orders"
                  : data.contractCents !== null
                    ? "Contract baseline (no estimate accepted yet)"
                    : "Set when the customer accepts an estimate."
              }
            />
            <MoneyTile
              icon={Wallet}
              label="Paid"
              value="—"
              caption="Arrives with Money (Phase 7)"
            />
            <MoneyTile
              icon={Wallet}
              label="Balance"
              value="—"
              caption="Arrives with Money (Phase 7)"
            />
          </div>
        </Card>
      ) : (
        <div className="hidden xl:block" aria-hidden />
      )}

      {/* Milestones */}
      <Card title="Milestones" id="ov-milestones" className="xl:col-span-3">
        <div className="flex flex-col gap-4">
          <MilestonesStepper steps={steps} />
          <div className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="font-medium">Current stage:</span> {getStage(job.stage).label}
              <span className="text-muted-foreground">
                {" "}
                · since {formatJobDate(job.stageEnteredAt)}
              </span>
              {job.stage === "closed_lost" && job.lostReason && (
                <span className="text-muted-foreground">
                  {" "}
                  · {labelFor(options.picklists.lost_reason, job.lostReason)}
                </span>
              )}
            </p>
            {hint && (
              <p className="text-sm">
                <span className="font-medium">Next: {hint.label}.</span>{" "}
                <span className="text-muted-foreground">{hint.requirement}</span>
              </p>
            )}
          </div>
          <StageControls
            jobId={job.id}
            stage={job.stage}
            gate={data.gate}
            can={{ advance: can.advance, override: can.override }}
            readOnly={data.readOnly}
            pendingApproval={data.pendingApproval}
            lostReasons={options.picklists.lost_reason}
          />
          {data.history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Stage history ({data.history.length})
              </summary>
              <ol className="mt-2 flex flex-col gap-1.5" aria-label="Stage history">
                {data.history.map((h) => (
                  <li key={h.id} className="flex flex-col">
                    <span>
                      {h.from ? `${getStage(h.from).label} → ` : ""}
                      {getStage(h.to).label}
                      {h.override && (
                        <Badge variant="warning" className="ml-2">
                          Owner override
                        </Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(h.at)}
                      {h.byName && ` · ${h.byName}`}
                      {h.reason && ` · “${h.reason}”`}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-4 xl:col-span-2">
        {/* Job Details */}
        <Card
          title="Job details"
          id="ov-details"
          action={
            can.update ? <EditJobButton job={job} options={options} canAssign={can.assign} /> : null
          }
        >
          <dl className="grid gap-2.5 lg:grid-cols-2">
            <Item label="Work types">{workTypeLabels.join(", ")}</Item>
            <Item label="Account">
              {job.accountName && (
                <Link href={`/accounts/${job.accountId}`} className="hover:underline">
                  {job.accountName}
                </Link>
              )}
            </Item>
            <Item label="Property">{p?.address}</Item>
            <Item label="Projected start">
              {job.promisedStartDate && formatJobDate(job.promisedStartDate)}
            </Item>
            <Item label="Priority">
              {JOB_PRIORITY_LABELS[job.priority]}
              {job.priorityReason && ` · ${job.priorityReason}`}
            </Item>
            <Item label="Source">
              {job.leadSource && labelFor(options.picklists.lead_source, job.leadSource)}
            </Item>
            <Item label="Estimator / owner">{job.ownerName}</Item>
            <Item label="Point of contact">{job.pocName}</Item>
            <Item label="Project manager">{job.pmName}</Item>
            <Item label="Territory">{job.territoryName}</Item>
            <Item label="Target season">{job.targetSeason}</Item>
            <Item label="Estimated duration">
              {job.estimatedDurationDays &&
                `${job.estimatedDurationDays} day${job.estimatedDurationDays === 1 ? "" : "s"}`}
            </Item>
            <Item label="Estimated completion">
              {job.estimatedCompletionDate && formatJobDate(job.estimatedCompletionDate)}
            </Item>
            <Item label="Tags">
              {job.tags.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {job.tags.map((t) => (
                    <Badge key={t} variant="neutral">
                      {t}
                    </Badge>
                  ))}
                </span>
              )}
            </Item>
          </dl>
        </Card>

        {/* Property Quick Info */}
        <Card title="Property quick info" id="ov-property">
          {p ? (
            <dl className="grid gap-2.5 lg:grid-cols-2">
              <Item label="Year built">
                <span className="inline-flex flex-wrap items-center gap-2">
                  {p.yearBuilt ?? "Not known"}
                  {p.leadSafe && (
                    <Badge variant="warning">
                      <ShieldAlert aria-hidden />
                      Lead-safe practices apply
                    </Badge>
                  )}
                </span>
              </Item>
              <Item label="HOA">
                {p.hasHoa
                  ? `Yes${p.hoaName ? ` · ${p.hoaName}` : ""}${p.hoaColorApproval ? " · color approval required" : ""}`
                  : "No"}
              </Item>
              <Item label="Siding">
                {p.sidingType && (data.propertyLabels.siding[p.sidingType] ?? p.sidingType)}
              </Item>
              <Item label="Stories">{p.stories && STORIES_LABELS[p.stories as 1 | 2 | 3]}</Item>
              <Item label="Home type">
                {p.propertyType &&
                  (data.propertyLabels.propertyType[p.propertyType] ?? p.propertyType)}
              </Item>
              <Item label="Occupancy">
                {p.occupancy && isOccupancy(p.occupancy) ? OCCUPANCY_LABELS[p.occupancy] : null}
              </Item>
              <Item label="Access">{p.accessNotes}</Item>
              <Item label="Pets">{p.pets}</Item>
              <Item label="Parking">{p.parking}</Item>
              <Item label="Colors chosen">
                <span className="text-muted-foreground">Arrives with estimates (Phase 4)</span>
              </Item>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No property on this job yet. Add one from the customer&apos;s account.
            </p>
          )}
        </Card>

        {/* Notes preview and recent activity */}
        <Card
          title="Recent activity"
          id="ov-activity"
          action={
            <Link
              href={sectionHref(job.id, "activity")}
              className="text-sm font-medium text-bb-forest hover:underline"
            >
              Open activity log
            </Link>
          }
        >
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="text-sm">
                  <p>{a.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(a.at)}
                    {a.byName && ` · ${a.byName}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {can.readNotes && (
            <p className="mt-3 border-t pt-3 text-sm">
              <Link
                href={sectionHref(job.id, "notes")}
                className="font-medium text-bb-forest hover:underline"
              >
                {data.counts.notes
                  ? `Open notes (${data.counts.notes})`
                  : "No notes yet. Add the first one"}
              </Link>
            </p>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {/* Action Required */}
        <Card title="Action required" id="ov-actions">
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {actions.map((a) => (
                <li key={a.key} className="flex gap-2 text-sm">
                  {a.tone === "danger" ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  ) : a.tone === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  )}
                  <span className="min-w-0">
                    {a.text}
                    {a.section && (a.section !== "admin" || can.override) && (
                      <>
                        {" "}
                        <Link
                          href={sectionHref(job.id, a.section)}
                          className="inline-flex items-center gap-0.5 font-medium text-bb-forest hover:underline"
                        >
                          Open
                          <ArrowRight className="size-3" aria-hidden />
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {can.readAppointments && (
          <AppointmentsCard
            jobId={job.id}
            appointments={data.appointments}
            users={options.users}
            defaultAssignee={job.ownerId ?? data.viewerId}
            canManage={can.manageAppointments}
            readOnly={data.readOnly}
          />
        )}

        {/* Job Health */}
        <Card title="Job health" id="ov-health">
          {job.healthScore === null ? (
            <p className="text-sm text-muted-foreground">
              {job.stage === "closed_won" || job.stage === "closed_lost"
                ? "Closed jobs aren't scored."
                : "Not scored yet. Health updates within a minute of any change."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-14 place-items-center rounded-2xl text-xl font-bold tabular-nums",
                    job.healthScore >= 85
                      ? "bg-success-bg text-success"
                      : job.healthScore >= 60
                        ? "bg-warning-bg text-warning"
                        : "bg-danger-bg text-danger",
                  )}
                  aria-label={`Health ${job.healthScore} out of 100`}
                >
                  {job.healthScore}
                </span>
                <span>
                  <span className="flex items-center gap-1 font-semibold">
                    <HeartPulse className="size-4" aria-hidden />
                    {healthLabel(job.healthScore)}
                  </span>
                  {job.healthCheckedAt && (
                    <span className="block text-xs text-muted-foreground">
                      Checked {formatRelative(job.healthCheckedAt)}
                    </span>
                  )}
                </span>
              </p>
              {failed.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {failed.map((f) => (
                    <li key={f.key} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      {f.recommendation ?? f.label}
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium text-bb-forest">
                  View recommendations
                </summary>
                <div className="mt-2">
                  <HealthFactors factors={job.healthFactors} />
                </div>
              </details>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MoneyTile({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bb-forest/10 text-bb-forest">
        <Icon className="size-4" aria-hidden />
      </span>
    </div>
  );
}
