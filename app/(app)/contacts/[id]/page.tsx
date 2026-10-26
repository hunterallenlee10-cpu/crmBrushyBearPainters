import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, UserRoundSearch } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { LeadStatusBadge } from "@/components/leads/lead-badges";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { SERVICE_LABELS, type LeadStatus, type Service } from "@/lib/domain/leads/constants";
import {
  CONTACT_ROLE_LABELS,
  PREFERRED_CHANNEL_LABELS,
  isContactRole,
  isPreferredChannel,
} from "@/lib/validation/accounts";
import { ConsentBadges, PrimaryBadge } from "../../accounts/_components/badges";
import {
  ContactDialog,
  DeleteRecordDialog,
  MakePrimaryButton,
} from "../../accounts/_components/record-dialogs";
import { ConsentDetails } from "../consent-details";

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Contact" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("contacts")
    .select("first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  return {
    title: data ? [data.first_name, data.last_name].filter(Boolean).join(" ") : "Contact",
  };
}

export default async function ContactDetailPage({ params }: { params: Params }) {
  const viewer = await requirePermission("contacts:read");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createSupabaseServerClient();

  const [contactRes, leadsRes, activityRes] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, account_id, first_name, last_name, role, mobile, phone, email, preferred_channel, language, sms_opt_in, sms_opt_in_at, sms_opt_in_source, email_opt_in, email_opt_in_at, email_opt_in_source, opted_out_at, do_not_contact, notes, created_at, updated_at, account:accounts!contacts_account_id_fkey(id, display_name, primary_contact_id)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("id, first_name, last_name, status, services, created_at")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("activity")
      .select("id, summary, created_at")
      .eq("subject_type", "contact")
      .eq("subject_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (contactRes.error) throw contactRes.error;
  const c = contactRes.data;
  if (!c) notFound();

  const leads = leadsRes.data ?? [];
  const activity = activityRes.data ?? [];
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  const isPrimary = c.account?.primary_contact_id === c.id;
  const readOnly = viewer.impersonating;
  const canEdit = viewer.can("contacts:update") && !readOnly;
  const canDelete = viewer.can("contacts:delete") && !readOnly && !isPrimary;
  const canMakePrimary = viewer.can("accounts:update") && !readOnly && !isPrimary && c.account;

  const info: [string, React.ReactNode][] = [
    ["Mobile", c.mobile ? formatPhone(c.mobile) : null],
    ["Other phone", c.phone ? formatPhone(c.phone) : null],
    ["Email", c.email],
    [
      "Prefers",
      c.preferred_channel && isPreferredChannel(c.preferred_channel)
        ? PREFERRED_CHANNEL_LABELS[c.preferred_channel]
        : null,
    ],
    ["Language", c.language],
    ["Added", formatDate(c.created_at)],
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/contacts"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Contacts
      </Link>

      <header className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight break-words text-bb-ink">{name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{isContactRole(c.role) ? CONTACT_ROLE_LABELS[c.role] : c.role}</span>
            {c.account && (
              <>
                <span className="text-muted-foreground">on</span>
                <Link
                  href={`/accounts/${c.account.id}`}
                  className="font-medium text-bb-forest hover:underline"
                >
                  {c.account.display_name}
                </Link>
              </>
            )}
            {isPrimary && <PrimaryBadge />}
            <ConsentBadges
              smsOptIn={c.sms_opt_in}
              emailOptIn={c.email_opt_in}
              doNotContact={c.do_not_contact}
              optedOut={c.opted_out_at !== null}
            />
          </div>
        </div>
        {(canEdit || canDelete || canMakePrimary) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canEdit && <ContactDialog mode="edit" contact={c} />}
            {canMakePrimary && c.account && (
              <MakePrimaryButton accountId={c.account.id} contactId={c.id} name={name} />
            )}
            {canDelete && (
              <DeleteRecordDialog
                kind="contact"
                id={c.id}
                label={name}
                redirectTo={c.account ? `/accounts/${c.account.id}` : "/contacts"}
              />
            )}
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <section aria-labelledby="contact-info" className="rounded-2xl border bg-card p-4 sm:p-5">
            <h2 id="contact-info" className="mb-3 text-base font-semibold">
              Contact info
            </h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {info
                .filter(([, v]) => Boolean(v))
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words tabular-nums">{v}</dd>
                  </div>
                ))}
            </dl>
            {c.notes && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted-foreground">Notes</h3>
                <p className="text-sm whitespace-pre-line">{c.notes}</p>
              </div>
            )}
          </section>

          <section
            aria-labelledby="contact-leads"
            className="rounded-2xl border bg-card p-4 sm:p-5"
          >
            <h2 id="contact-leads" className="mb-3 text-base font-semibold">
              Leads
              <span className="ml-2 text-sm font-normal text-muted-foreground">{leads.length}</span>
            </h2>
            {leads.length === 0 ? (
              <EmptyState icon={UserRoundSearch} title="No leads linked" className="py-8">
                Leads from this person show up here once they&apos;re linked to the contact.
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
                      </span>
                    </div>
                    <LeadStatusBadge status={l.status as LeadStatus} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby="contact-consent"
            className="rounded-2xl border bg-card p-4 sm:p-5"
          >
            <h2 id="contact-consent" className="mb-3 text-base font-semibold">
              Consent
            </h2>
            <ConsentDetails
              smsOptIn={c.sms_opt_in}
              smsOptInAt={c.sms_opt_in_at}
              smsOptInSource={c.sms_opt_in_source}
              emailOptIn={c.email_opt_in}
              emailOptInAt={c.email_opt_in_at}
              emailOptInSource={c.email_opt_in_source}
              optedOutAt={c.opted_out_at}
              doNotContact={c.do_not_contact}
            />
          </section>
          <section
            aria-labelledby="contact-timeline"
            className="rounded-2xl border bg-card p-4 sm:p-5"
          >
            <h2 id="contact-timeline" className="mb-3 text-base font-semibold">
              Timeline
            </h2>
            {activity.length === 0 ? (
              <EmptyState icon={History} title="Nothing yet" className="py-8">
                Messages and changes for this person will show up here.
              </EmptyState>
            ) : (
              <ol className="flex flex-col gap-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex flex-col border-l-2 border-bb-forest/30 pl-3">
                    <span className="text-sm">{a.summary}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
