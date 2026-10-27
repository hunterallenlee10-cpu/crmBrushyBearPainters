import Link from "next/link";
import {
  Briefcase,
  Building2,
  ExternalLink,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/layout/stage-badge";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatCents } from "@/lib/domain/company-settings";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { isJobStageId } from "@/lib/domain/stages";
import { TEAM_ROLES, type TeamRole } from "@/lib/domain/jobs/constants";
import {
  ACCOUNT_TYPE_LABELS,
  CONTACT_ROLE_LABELS,
  OCCUPANCY_LABELS,
  isAccountType,
  isContactRole,
  isOccupancy,
} from "@/lib/validation/accounts";
import { ConsentBadges, LeadSafeBadge } from "@/app/(app)/accounts/_components/badges";
import { AccessCodeControl } from "@/app/(app)/accounts/_components/access-code";
import { fieldEncryptionKey } from "@/app/(app)/accounts/_lib/rows";
import { loadActiveUsers, loadJobCore, loadNames } from "./data";
import { customerJobCounts, lifetimeContractCents } from "./feed-utils";
import { Card, Unavailable } from "./section-card";
import { InternalTeam, type TeamRow } from "./team";

const PROPERTY_SELECT =
  "id, street, unit, city, state, zip, lead_safe_required, occupancy, access_notes, pets, parking, alarm, water_power_access, has_hoa, hoa_name";

/** Customer (SPEC §8.5 #10): account, property & access, internal team, contacts, jobs. */
export async function CustomerSection({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}): Promise<React.ReactNode> {
  const [viewer, job] = await Promise.all([requireViewer(), loadJobCore(jobId)]);
  if (!job) return <Unavailable />;
  const supabase = await createSupabaseServerClient();
  const canSeeMoney = viewer.can("financials:read");
  const canSeeCodes = viewer.can("properties:view_access_codes");
  const readOnly = viewer.impersonating;

  const [accountRes, contactsRes, jobsRes, teamRes, propertyRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, display_name, account_type, primary_contact_id")
      .eq("id", job.accountId)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, role, mobile, phone, email, sms_opt_in, email_opt_in, opted_out_at, do_not_contact",
      )
      .eq("account_id", job.accountId)
      .order("created_at")
      .limit(100),
    supabase
      .from("jobs")
      .select("id, job_number, name, stage, status, created_at")
      .eq("account_id", job.accountId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("job_team").select("user_id, role, added_at").eq("job_id", job.id).limit(50),
    job.propertyId
      ? supabase.from("properties").select(PROPERTY_SELECT).eq("id", job.propertyId).maybeSingle()
      : supabase
          .from("properties")
          .select(PROPERTY_SELECT)
          .eq("account_id", job.accountId)
          .eq("is_primary", true)
          .maybeSingle(),
  ]);

  const account = accountRes.data;
  const contacts = contactsRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const team = teamRes.data ?? [];
  const property = propertyRes.data;

  const [financials, secret, names, users] = await Promise.all([
    canSeeMoney && jobs.length
      ? supabase
          .from("job_financials")
          .select("job_id, contract_cents")
          .in(
            "job_id",
            jobs.map((j) => j.id),
          )
      : Promise.resolve({
          data: [] as { job_id: string; contract_cents: number | null }[],
        }),
    canSeeCodes && property
      ? supabase
          .from("property_secrets")
          .select("property_id")
          .eq("property_id", property.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadNames([
      job.ownerId,
      job.pointOfContactId,
      job.projectManagerId,
      ...team.map((t) => t.user_id),
    ]),
    loadActiveUsers(),
  ]);

  const counts = customerJobCounts(jobs);
  const contractByJob = new Map((financials.data ?? []).map((f) => [f.job_id, f.contract_cents]));
  const lifetime = lifetimeContractCents(
    jobs.map((j) => ({ contractCents: contractByJob.get(j.id) ?? null, status: j.status })),
  );
  const primary =
    contacts.find((c) => c.id === account?.primary_contact_id) ??
    contacts.find((c) => c.id === job.primaryContactId) ??
    null;
  const phone = primary ? (primary.mobile ?? primary.phone) : null;
  const nameOf = (id: string) => names.get(id) ?? "Former teammate";

  const teamRows: TeamRow[] = [
    ...(job.ownerId
      ? [
          {
            userId: job.ownerId,
            name: nameOf(job.ownerId),
            role: "owner" as const,
            removable: false,
          },
        ]
      : []),
    ...(job.pointOfContactId
      ? [
          {
            userId: job.pointOfContactId,
            name: nameOf(job.pointOfContactId),
            role: "job_point_of_contact" as const,
            removable: false,
          },
        ]
      : []),
    ...(job.projectManagerId
      ? [
          {
            userId: job.projectManagerId,
            name: nameOf(job.projectManagerId),
            role: "job_project_manager" as const,
            removable: false,
          },
        ]
      : []),
    ...team
      .filter((t): t is typeof t & { role: TeamRole } =>
        (TEAM_ROLES as readonly string[]).includes(t.role),
      )
      .map((t) => ({ userId: t.user_id, name: nameOf(t.user_id), role: t.role, removable: true })),
  ];

  const address = property
    ? [
        [property.street, property.unit].filter(Boolean).join(" "),
        property.city,
        [property.state, property.zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  const accountHref = `/accounts/${job.accountId}`;
  const canEditAccount = viewer.can("accounts:update") && !readOnly;
  const accessRows: [string, string | null][] = property
    ? [
        [
          "Occupancy",
          property.occupancy && isOccupancy(property.occupancy)
            ? OCCUPANCY_LABELS[property.occupancy]
            : null,
        ],
        ["Access", property.access_notes],
        ["Pets", property.pets],
        ["Parking", property.parking],
        ["Alarm", property.alarm],
        ["Water / power", property.water_power_access],
        ["HOA", property.has_hoa ? (property.hoa_name ?? "Yes") : null],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Account header */}
      <section
        aria-labelledby="customer-account-title"
        className="rounded-2xl border bg-card p-4 sm:p-5"
      >
        {account ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h2
                  id="customer-account-title"
                  className="text-lg font-semibold break-words text-bb-ink"
                >
                  <Link href={accountHref} className="hover:underline">
                    {account.display_name}
                  </Link>
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <Badge variant="outline">
                    <Building2 aria-hidden />
                    {isAccountType(account.account_type)
                      ? ACCOUNT_TYPE_LABELS[account.account_type]
                      : account.account_type}
                  </Badge>
                  {address && (
                    <span className="inline-flex min-w-0 items-center gap-1 break-words">
                      <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {address}
                    </span>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      className="inline-flex items-center gap-1 text-bb-forest tabular-nums hover:underline"
                    >
                      <Phone className="size-4" aria-hidden />
                      {formatPhone(phone)}
                    </a>
                  )}
                </div>
              </div>
              <Link
                href={accountHref}
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-bb-forest hover:underline"
              >
                Open account
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <Stat label="Jobs" value={String(counts.total)} />
              <Stat label="Open" value={String(counts.open)} />
              <Stat label="Won" value={String(counts.won)} />
              <Stat label="Lost" value={String(counts.lost)} />
              {canSeeMoney && (
                <Stat
                  label="Lifetime contract value"
                  value={formatCents(lifetime)}
                  caption="Contract amounts on this customer's jobs · lost jobs excluded"
                  className="col-span-2 sm:col-span-4 lg:col-span-1"
                />
              )}
            </dl>
          </div>
        ) : (
          <>
            <h2 id="customer-account-title" className="text-base font-semibold">
              Customer
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You can&apos;t open this customer&apos;s account. Ask an office manager if you need
              it.
            </p>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Property & Access */}
        <Card
          title="Property & Access"
          action={
            canEditAccount && account ? (
              <Link
                href={accountHref}
                className="inline-flex items-center gap-1 text-sm font-medium text-bb-forest hover:underline"
              >
                <PenLine className="size-3.5" aria-hidden />
                Edit on the account
              </Link>
            ) : null
          }
        >
          {!property ? (
            <p className="text-sm text-muted-foreground">
              No property on this job yet. Add one on the customer&apos;s account.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {property.lead_safe_required && <LeadSafeBadge />}
              <dl className="flex flex-col gap-1.5 text-sm">
                {accessRows.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words whitespace-pre-line">
                      {v ?? <span className="text-muted-foreground">Not noted</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              {canSeeCodes ? (
                <AccessCodeControl
                  propertyId={property.id}
                  hasCode={Boolean(secret.data)}
                  canEdit={false}
                  keyMissing={fieldEncryptionKey() === null}
                />
              ) : (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">Gate / lockbox code:</span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden />
                    Hidden for your role
                  </span>
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Internal Team */}
        <Card title="Internal Team">
          <InternalTeam
            jobId={job.id}
            rows={teamRows}
            canAssign={canEdit && viewer.can("jobs:assign")}
            users={users}
          />
        </Card>

        {/* Contacts */}
        <Card
          title="Contacts"
          count={contacts.length}
          action={
            viewer.can("contacts:create") && !readOnly && account ? (
              <Link
                href={accountHref}
                className="inline-flex items-center gap-1 text-sm font-medium text-bb-forest hover:underline"
              >
                Add contact on the account
              </Link>
            ) : null
          }
        >
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {account
                ? "No contacts yet. Add the homeowner on the customer's account."
                : "Contacts are hidden for your role."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y" aria-label="Contacts">
              {contacts.map((c) => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
                const isPrimary = c.id === account?.primary_contact_id;
                return (
                  <li key={c.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isPrimary && (
                        <Star
                          className="size-4 fill-bb-honey text-bb-honey"
                          aria-label="Primary contact"
                          role="img"
                        />
                      )}
                      <Link
                        href={`/contacts/${c.id}`}
                        className="font-medium break-words text-bb-forest hover:underline"
                      >
                        {name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {isContactRole(c.role) ? CONTACT_ROLE_LABELS[c.role] : c.role}
                      </span>
                      {c.id === job.primaryContactId && <Badge variant="info">Job contact</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {c.mobile && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                          <span className="sr-only">Mobile</span>
                          {formatPhone(c.mobile)}
                        </span>
                      )}
                      {c.phone && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                          <span className="sr-only">Phone</span>
                          {formatPhone(c.phone)}
                        </span>
                      )}
                      {c.email && (
                        <span className="inline-flex min-w-0 items-center gap-1 break-all">
                          <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          {c.email}
                        </span>
                      )}
                    </div>
                    <ConsentBadges
                      smsOptIn={c.sms_opt_in}
                      emailOptIn={c.email_opt_in}
                      doNotContact={c.do_not_contact}
                      optedOut={c.opted_out_at !== null}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Signing Order */}
        <Card title="Signing Order">
          <p className="text-sm text-muted-foreground">
            The primary contact signs proposals and change orders on the proposal page (BearSign).
            Co-signers arrive with signer roles in the agreement templates.
          </p>
        </Card>
      </div>

      {/* All jobs for this customer */}
      <Card title="All Jobs for this customer" count={jobs.length}>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other jobs you can see.</p>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Jobs for this customer">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Briefcase className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <Link
                    href={`/jobs/${j.id}`}
                    className="min-w-0 font-medium break-words text-bb-forest hover:underline"
                    aria-current={j.id === job.id ? "page" : undefined}
                  >
                    <span className="tabular-nums">{j.job_number}</span> · {j.name}
                  </Link>
                  {j.id === job.id && <Badge variant="neutral">This job</Badge>}
                </div>
                {isJobStageId(j.stage) && <StageBadge stage={j.stage} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  className,
}: {
  label: string;
  value: string;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-background p-3 ${className ?? ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {caption && <dd className="mt-0.5 text-xs text-muted-foreground">{caption}</dd>}
    </div>
  );
}
