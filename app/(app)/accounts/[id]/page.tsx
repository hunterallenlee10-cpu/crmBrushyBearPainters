import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Clock,
  Home,
  Mail,
  MapPin,
  Phone,
  UserRound,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { RememberRecent } from "@/components/shell/recent-records";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/leads/lead-badges";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  HOME_BUILT_LABELS,
  SERVICE_LABELS,
  type HomeBuilt,
  type LeadStatus,
  type Service,
} from "@/lib/domain/leads/constants";
import {
  ACCOUNT_TYPE_LABELS,
  CONTACT_ROLE_LABELS,
  OCCUPANCY_LABELS,
  PREFERRED_CHANNEL_LABELS,
  STORIES_LABELS,
  isContactRole,
  isOccupancy,
  isPreferredChannel,
  type AccountStatus,
  type AccountType,
} from "@/lib/validation/accounts";
import {
  AccountStatusBadge,
  ConsentBadges,
  LeadSafeBadge,
  PrimaryBadge,
  ReferralChampionBadge,
} from "../_components/badges";
import {
  ContactDialog,
  DeleteRecordDialog,
  EditAccountDialog,
  MakePrimaryButton,
  PropertyDialog,
} from "../_components/record-dialogs";
import { AccessCodeControl } from "../_components/access-code";
import { fieldEncryptionKey } from "../_lib/rows";

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Account" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("accounts")
    .select("display_name")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.display_name ?? "Account" };
}

const CONTACT_SELECT =
  "id, first_name, last_name, role, mobile, phone, email, preferred_channel, language, sms_opt_in, sms_opt_in_at, sms_opt_in_source, email_opt_in, email_opt_in_at, email_opt_in_source, opted_out_at, do_not_contact, notes, created_at";

const PROPERTY_SELECT =
  "id, is_primary, street, unit, city, state, zip, territory_id, out_of_area, year_built, home_built, lead_safe_required, property_type, stories, approx_sqft, siding_type, has_hoa, hoa_name, hoa_contact, hoa_color_approval_required, access_notes, pets, parking, alarm, occupancy, water_power_access, created_at, territory:territories!properties_territory_id_fkey(name)";

export default async function AccountDetailPage({ params }: { params: Params }) {
  const viewer = await requirePermission("accounts:read");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const canSeeCodes = viewer.can("properties:view_access_codes");

  const [accountRes, contactsRes, propertiesRes, leadsRes, activityRes, options] =
    await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, display_name, account_type, status, owner_id, primary_contact_id, is_referral_champion, tags, notes, created_at, updated_at, owner:profiles!accounts_owner_id_fkey(full_name), territory:territories!accounts_territory_id_fkey(name)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("account_id", id)
        .order("created_at")
        .limit(100),
      supabase
        .from("properties")
        .select(PROPERTY_SELECT)
        .eq("account_id", id)
        .order("is_primary", { ascending: false })
        .order("created_at")
        .limit(50),
      supabase
        .from("leads")
        .select(
          "id, first_name, last_name, status, services, created_at, owner:profiles!leads_owner_id_fkey(full_name)",
        )
        .eq("account_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("activity")
        .select("id, type, summary, created_at, actor_id")
        .eq("subject_type", "account")
        .eq("subject_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      loadLeadOptions(supabase),
    ]);

  const account = accountRes.data;
  if (accountRes.error) throw accountRes.error;
  if (!account) notFound();

  const contacts = contactsRes.data ?? [];
  const properties = propertiesRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const activity = activityRes.data ?? [];
  // Only which properties have a code (never the ciphertext).
  const withCode = new Set<string>();
  if (canSeeCodes && properties.length) {
    const { data } = await supabase
      .from("property_secrets")
      .select("property_id")
      .in(
        "property_id",
        properties.map((p) => p.id),
      );
    for (const s of data ?? []) withCode.add(s.property_id);
  }

  const actorIds = [...new Set(activity.flatMap((a) => (a.actor_id ? [a.actor_id] : [])))];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of data ?? []) actorNames.set(p.id, p.full_name);
  }

  const readOnly = viewer.impersonating;
  const canUpdate = viewer.can("accounts:update") && !readOnly;
  const canDelete = viewer.can("accounts:delete") && !readOnly;
  const canCreateJob = viewer.can("jobs:create") && !readOnly;
  const canAddContact = viewer.can("contacts:create") && !readOnly;
  const canEditContact = viewer.can("contacts:update") && !readOnly;
  const canDeleteContact = viewer.can("contacts:delete") && !readOnly;
  const keyMissing = fieldEncryptionKey() === null;

  const formOptions = {
    users: options.users,
    propertyTypes: options.picklists.property_type,
    sidingTypes: options.picklists.siding_type,
  };
  const pickLabel = (list: "property_type" | "siding_type", value: string | null) =>
    value ? (options.picklists[list].find((o) => o.value === value)?.label ?? value) : null;

  const status = account.status as AccountStatus;
  const type = account.account_type as AccountType;

  return (
    <div className="flex flex-col gap-5">
      <RememberRecent
        kind="account"
        id={account.id}
        title={account.display_name}
        href={`/accounts/${account.id}`}
      />
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Accounts
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight break-words text-bb-ink">
            {account.display_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={status} />
            <Badge variant="outline">{ACCOUNT_TYPE_LABELS[type]}</Badge>
            {account.is_referral_champion && <ReferralChampionBadge />}
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex items-center gap-1.5">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <UserRound className="size-4" aria-hidden />
                Owner
              </dt>
              <dd>{account.owner?.full_name ?? "Unassigned"}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="size-4" aria-hidden />
                Territory
              </dt>
              <dd>{account.territory?.name ?? "Not set"}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                Created
              </dt>
              <dd>{formatDate(account.created_at)}</dd>
            </div>
          </dl>
        </div>
        {(canUpdate || canDelete || canCreateJob) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canCreateJob && (
              <Button asChild variant="outline">
                <Link href={`/jobs/new?account=${account.id}`}>
                  <Briefcase aria-hidden />
                  New job
                </Link>
              </Button>
            )}
            {canUpdate && (
              <EditAccountDialog
                accountId={account.id}
                account={{
                  display_name: account.display_name,
                  account_type: account.account_type,
                  status: account.status,
                  owner_id: account.owner_id,
                  is_referral_champion: account.is_referral_champion,
                  tags: account.tags,
                  notes: account.notes,
                }}
                options={formOptions}
              />
            )}
            {canDelete && (
              <DeleteRecordDialog
                kind="account"
                id={account.id}
                label={account.display_name}
                redirectTo="/accounts"
              />
            )}
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          {/* Contacts */}
          <Section
            title="Contacts"
            count={contacts.length}
            action={canAddContact ? <ContactDialog mode="add" accountId={account.id} /> : null}
          >
            {contacts.length === 0 ? (
              <EmptyState icon={Users} title="No contacts yet" className="py-8">
                Add the people we talk to: the homeowner, a partner, a property manager.
              </EmptyState>
            ) : (
              <ul className="flex flex-col divide-y">
                {contacts.map((c) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
                  const isPrimary = account.primary_contact_id === c.id;
                  return (
                    <li
                      key={c.id}
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/contacts/${c.id}`}
                            className="font-medium text-bb-forest hover:underline"
                          >
                            {name}
                          </Link>
                          {!(isPrimary && c.role === "primary") && (
                            <span className="text-xs text-muted-foreground">
                              {isContactRole(c.role) ? CONTACT_ROLE_LABELS[c.role] : c.role}
                            </span>
                          )}
                          {isPrimary && <PrimaryBadge />}
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
                              <Mail
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              {c.email}
                            </span>
                          )}
                          {c.preferred_channel && isPreferredChannel(c.preferred_channel) && (
                            <span className="text-xs text-muted-foreground">
                              Prefers {PREFERRED_CHANNEL_LABELS[c.preferred_channel].toLowerCase()}
                            </span>
                          )}
                        </div>
                        <ConsentBadges
                          smsOptIn={c.sms_opt_in}
                          emailOptIn={c.email_opt_in}
                          doNotContact={c.do_not_contact}
                          optedOut={c.opted_out_at !== null}
                        />
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {canEditContact && (
                          <ContactDialog mode="edit" contact={c} trigger="small" />
                        )}
                        {canUpdate && !isPrimary && (
                          <MakePrimaryButton accountId={account.id} contactId={c.id} name={name} />
                        )}
                        {canDeleteContact && !isPrimary && (
                          <DeleteRecordDialog kind="contact" id={c.id} label={name} size="sm" />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Properties */}
          <Section
            title="Properties"
            count={properties.length}
            action={
              canUpdate ? (
                <PropertyDialog mode="add" accountId={account.id} options={formOptions} />
              ) : null
            }
          >
            {properties.length === 0 ? (
              <EmptyState icon={Home} title="No properties yet" className="py-8">
                Add the home we&apos;d paint. The ZIP code sets the territory.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-4">
                {properties.map((p) => {
                  const line1 = [p.street, p.unit].filter(Boolean).join(" ");
                  const line2 = [p.city, [p.state, p.zip].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ");
                  const label = line1 || line2 || "Property";
                  const details: [string, string | null][] = [
                    [
                      "Built",
                      p.year_built !== null
                        ? String(p.year_built)
                        : p.home_built
                          ? HOME_BUILT_LABELS[p.home_built as HomeBuilt]
                          : null,
                    ],
                    ["Home type", pickLabel("property_type", p.property_type)],
                    ["Siding", pickLabel("siding_type", p.siding_type)],
                    [
                      "Stories",
                      p.stories === 1 || p.stories === 2 || p.stories === 3
                        ? STORIES_LABELS[p.stories]
                        : null,
                    ],
                    [
                      "Approx. sq ft",
                      p.approx_sqft !== null ? p.approx_sqft.toLocaleString("en-US") : null,
                    ],
                    [
                      "Occupancy",
                      p.occupancy && isOccupancy(p.occupancy)
                        ? OCCUPANCY_LABELS[p.occupancy]
                        : null,
                    ],
                    ["Pets", p.pets],
                    ["Parking", p.parking],
                    ["Alarm", p.alarm],
                    ["Water / power", p.water_power_access],
                  ];
                  return (
                    <li key={p.id} className="rounded-xl border p-3 sm:p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-1">
                          <h3 className="font-semibold break-words">{label}</h3>
                          {line1 && line2 && <p className="text-sm">{line2}</p>}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {p.is_primary && properties.length > 1 && <PrimaryBadge />}
                            {p.territory?.name && (
                              <Badge variant="neutral">
                                <MapPin aria-hidden />
                                {p.territory.name}
                              </Badge>
                            )}
                            {p.out_of_area && <Badge variant="warning">Out of area</Badge>}
                            {p.lead_safe_required && <LeadSafeBadge />}
                            {p.has_hoa && (
                              <Badge variant="info">
                                HOA{p.hoa_color_approval_required ? " · color approval" : ""}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {(canUpdate || canDelete) && (
                          <div className="flex shrink-0 gap-1.5">
                            {canUpdate && (
                              <PropertyDialog
                                mode="edit"
                                property={p}
                                options={formOptions}
                                label={label}
                              />
                            )}
                            {canDelete && (
                              <DeleteRecordDialog
                                kind="property"
                                id={p.id}
                                label={label}
                                size="sm"
                              />
                            )}
                          </div>
                        )}
                      </div>
                      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        {details
                          .filter((d): d is [string, string] => Boolean(d[1]))
                          .map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                              <dd className="min-w-0 break-words">{v}</dd>
                            </div>
                          ))}
                        {p.has_hoa && (p.hoa_name || p.hoa_contact) && (
                          <div className="flex gap-2 sm:col-span-2">
                            <dt className="w-28 shrink-0 text-muted-foreground">HOA</dt>
                            <dd className="min-w-0 break-words">
                              {[p.hoa_name, p.hoa_contact].filter(Boolean).join(" · ")}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {p.access_notes && (
                        <div className="mt-3 rounded-lg bg-muted/50 p-2.5 text-sm">
                          <p className="text-xs font-semibold text-muted-foreground">
                            Access notes
                          </p>
                          <p className="whitespace-pre-line">{p.access_notes}</p>
                        </div>
                      )}
                      {canSeeCodes && (
                        <div className="mt-3">
                          <AccessCodeControl
                            propertyId={p.id}
                            hasCode={withCode.has(p.id)}
                            canEdit={canUpdate}
                            keyMissing={keyMissing}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Related leads */}
          <Section title="Leads" count={leads.length}>
            {leads.length === 0 ? (
              <EmptyState icon={UserRoundSearch} title="No leads linked" className="py-8">
                Leads from this household show up here once they&apos;re linked to the account.
              </EmptyState>
            ) : (
              <ul className="flex flex-col divide-y">
                {leads.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/leads/${l.id}`}
                        className="font-medium text-bb-forest hover:underline"
                      >
                        {[l.first_name, l.last_name].filter(Boolean).join(" ")}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {(l.services as Service[]).map((s) => SERVICE_LABELS[s] ?? s).join(", ") ||
                          "No services yet"}{" "}
                        · {formatRelative(l.created_at)}
                        {l.owner?.full_name ? ` · ${l.owner.full_name}` : ""}
                      </span>
                    </div>
                    <LeadStatusBadge status={l.status as LeadStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Details">
            <dl className="flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {account.tags.length ? (
                    account.tags.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-1 whitespace-pre-line">
                  {account.notes ?? <span className="text-muted-foreground">None</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last updated</dt>
                <dd>{formatDateTime(account.updated_at)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Timeline">
            {activity.length === 0 ? (
              <EmptyState icon={Building2} title="Nothing yet" className="py-8">
                Changes, gate-code views and messages on this account will show up here.
              </EmptyState>
            ) : (
              <ol className="flex flex-col gap-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex flex-col border-l-2 border-bb-forest/30 pl-3">
                    <span className="text-sm">{a.summary}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                      {a.actor_id && actorNames.get(a.actor_id)
                        ? ` · ${actorNames.get(a.actor_id)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `section-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
