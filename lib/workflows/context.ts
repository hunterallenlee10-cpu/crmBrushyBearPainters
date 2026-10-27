import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { complianceIssues } from "@/lib/domain/scheduling/subcontractors";
import { formatRange, pacificToday } from "@/lib/domain/scheduling/dates";
import { arrivalWindowLabel } from "@/lib/domain/scheduling/messages";
import { isCustomerInitiated } from "@/lib/domain/messaging";
import { asciiPunctuation, firstWord, serviceWords } from "@/lib/domain/templates/words";
import type { MergeContext } from "@/lib/domain/templates/merge";
import type {
  Audience,
  Person,
  Recipient,
  RunContext,
  WorkflowSubject,
} from "@/lib/domain/workflows/types";
import { formatCents } from "@/lib/format/money";
import { DO_NOT_CONTACT } from "@/lib/leads/messaging";
import { PAYMENT_INSTRUCTIONS_PLACEHOLDER } from "@/lib/money/messages";
import { prepLines } from "@/lib/onboarding/messages";
import { appUrl, loadCompanyMerge } from "@/lib/messaging/core";

type Db = SupabaseClient<Database>;

/**
 * Builds a workflow run's context (merge fields, condition facts, recipients
 * and the people a notice can go to) from the database, for one subject
 * record. Service client: the worker and trusted server code only. The same
 * loader feeds real runs and the dry-run Test, so what the Test shows is what
 * a run would do.
 */

export type ContextEvent = {
  type: string;
  payload: Record<string, Json | undefined>;
};

export type LoadedContext = RunContext & {
  orgId: string;
  /** Where customer messages are logged. */
  thread: { subjectType: "lead" | "job"; subjectId: string; contactId: string | null } | null;
  jobId: string | null;
  leadId: string | null;
  /** For the estimate link: the version to mint a fresh proposal link for. */
  estimate: {
    id: string;
    versionId: string | null;
    jobId: string;
    expiresAt: string | null;
  } | null;
};

const CLOSED = new Set(["closed_won", "closed_lost"]);
const OPEN_LEAD = new Set(["new", "contacted", "walkthrough_scheduled", "nurture"]);

const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);

async function owners(service: Db, orgId: string): Promise<Person[]> {
  const { data } = await service
    .from("profiles")
    .select("id, full_name, role_templates!inner(grants_all)")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .eq("role_templates.grants_all", true)
    .order("created_at");
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
}

async function withPermission(service: Db, orgId: string, permission: string): Promise<Person[]> {
  const { data } = await service.rpc("users_with_permission", {
    p_org: orgId,
    p_permission: permission,
  });
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
}

async function profiles(service: Db, ids: readonly (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length)
    return new Map<
      string,
      { id: string; full_name: string; phone: string | null; email: string; is_active: boolean }
    >();
  const { data } = await service
    .from("profiles")
    .select("id, full_name, phone, email, is_active")
    .in("id", list);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

function person(p: { id: string; full_name: string } | undefined | null): Person[] {
  return p ? [{ id: p.id, name: p.full_name }] : [];
}

function staffRecipient(
  p:
    | { id: string; full_name: string; phone: string | null; email: string; is_active: boolean }
    | undefined,
): Recipient | null {
  if (!p || !p.is_active) return null;
  return {
    kind: "staff",
    id: p.id,
    name: p.full_name,
    mobile: p.phone && /^\+[1-9]\d{7,14}$/.test(p.phone) ? p.phone : null,
    email: p.email,
    doNotContact: false,
    smsOptedOut: false,
    emailOptedOut: false,
    smsOptIn: true,
    emailOptIn: true,
  };
}

export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export function contactRecipient(c: ContactRow, leadDnc: boolean): Recipient {
  return {
    kind: "contact",
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
    mobile: c.mobile,
    email: c.email,
    doNotContact: c.do_not_contact || leadDnc,
    smsOptedOut: !!c.opted_out_at,
    emailOptedOut: !!c.email_opted_out_at,
    smsOptIn: c.sms_opt_in,
    emailOptIn: c.email_opt_in,
  };
}

async function threadInitiated(
  service: Db,
  orgId: string,
  subjectType: "lead" | "job",
  subjectId: string,
  windowHours: number,
  now: Date,
): Promise<boolean> {
  const { data } = await service
    .from("message_threads")
    .select("last_inbound_at")
    .eq("org_id", orgId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .maybeSingle();
  return isCustomerInitiated(data?.last_inbound_at ?? null, now, windowHours);
}

/** Job + its people + its customer. */
async function loadJobPart(service: Db, jobId: string) {
  const { data: job } = await service
    .from("jobs")
    .select(
      "id, org_id, job_number, name, stage, work_types, owner_id, point_of_contact_id, project_manager_id, crew_id, primary_contact_id, lead_id, property_id, promised_start_date, paid_in_full_at, deleted_at, account_id",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const [property, contact, lead, crew] = await Promise.all([
    job.property_id
      ? service.from("properties").select("city").eq("id", job.property_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.primary_contact_id
      ? service
          .from("contacts")
          .select("*")
          .eq("id", job.primary_contact_id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.lead_id
      ? service.from("leads").select("disposition").eq("id", job.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.crew_id
      ? service
          .from("crews")
          .select("id, name, lead_user_id, members:crew_members(user_id, active)")
          .eq("id", job.crew_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const people = await profiles(service, [
    job.owner_id,
    job.point_of_contact_id,
    job.project_manager_id,
    crew.data?.lead_user_id ?? null,
    ...((crew.data?.members ?? []).filter((m) => m.active).map((m) => m.user_id) ?? []),
  ]);
  return {
    job,
    city: property.data?.city ?? null,
    contact: contact.data,
    leadDnc: lead.data?.disposition === DO_NOT_CONTACT,
    crew: crew.data,
    people,
  };
}

export type LeadRow = Database["public"]["Tables"]["leads"]["Row"];

async function loadLeadPart(service: Db, leadId: string) {
  const { data: lead } = await service.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) return null;
  const [contact, people] = await Promise.all([
    lead.contact_id
      ? service.from("contacts").select("*").eq("id", lead.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profiles(service, [lead.owner_id, lead.point_of_contact_id]),
  ]);
  return { lead, contact: contact.data, people };
}

export function leadRecipient(lead: LeadRow, contact: ContactRow | null): Recipient {
  return {
    kind: "lead",
    id: lead.id,
    name: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    mobile: lead.mobile ?? lead.phone,
    email: lead.email,
    doNotContact: lead.disposition === DO_NOT_CONTACT || !!contact?.do_not_contact,
    smsOptedOut: !!lead.sms_opted_out_at || !!contact?.opted_out_at,
    emailOptedOut: !!lead.email_opted_out_at || !!contact?.email_opted_out_at,
    smsOptIn: contact ? contact.sms_opt_in : null,
    emailOptIn: contact ? contact.email_opt_in : null,
  };
}

export type SubjectRef = { type: WorkflowSubject; id: string };

/**
 * The job (or lead) behind a subject record, for loading the customer part.
 * Returns the job id, lead id and the subject-specific row.
 */
export async function loadRunContext(
  service: Db,
  orgId: string,
  subject: SubjectRef,
  event: ContextEvent,
  opts: { now: Date; customerThreadHours: number; dryRun: boolean },
): Promise<LoadedContext | null> {
  const company = await loadCompanyMerge(service, orgId);
  const merge: MergeContext = {
    company,
    event: { type: event.type, payload: event.payload as MergeContext },
  };
  const people: Partial<Record<Audience, Person[]>> = { owners: await owners(service, orgId) };
  const recipients: RunContext["recipients"] = {
    customer: null,
    crew_lead: null,
    subcontractor: null,
  };
  let jobId: string | null = null;
  let leadId: string | null = null;
  let estimate: LoadedContext["estimate"] = null;

  // Subject-specific rows first (they point at the job or lead).
  switch (subject.type) {
    case "job":
    case "rain_delay":
      jobId = subject.id;
      break;
    case "lead":
      leadId = subject.id;
      break;
    case "appointment": {
      const { data: a } = await service
        .from("appointments")
        .select("*")
        .eq("id", subject.id)
        .maybeSingle();
      if (!a) return null;
      jobId = a.job_id;
      leadId = a.job_id ? null : a.lead_id;
      const who = await profiles(service, a.assigned_user_ids ?? []);
      merge.appointment = {
        id: a.id,
        type: a.type,
        status: a.status,
        result: a.result,
        start: a.starts_at,
        end: a.ends_at,
        with:
          [...who.values()]
            .map((p) => firstWord(p.full_name))
            .filter(Boolean)
            .join(" and ") || null,
        deleted: !!a.deleted_at,
        location: a.location,
      };
      break;
    }
    case "estimate": {
      const { data: e } = await service
        .from("estimates")
        .select(
          "id, job_id, estimate_number, status, sent_at, viewed_at, expires_at, current_version_id, accepted_at, declined_at",
        )
        .eq("id", subject.id)
        .maybeSingle();
      if (!e) return null;
      jobId = e.job_id;
      const runVersion = str(event.payload.version_id);
      const superseded =
        !!runVersion && !!e.current_version_id && runVersion !== e.current_version_id;
      let repliedAfterViewing = false;
      if (e.viewed_at) {
        const { count } = await service
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("subject_type", "job")
          .eq("subject_id", e.job_id)
          .eq("direction", "inbound")
          .gte("created_at", e.viewed_at);
        repliedAfterViewing = (count ?? 0) > 0;
      }
      merge.estimate = {
        id: e.id,
        number: e.estimate_number,
        status: superseded ? "superseded" : e.status,
        sent_at: e.sent_at,
        viewed_at: e.viewed_at,
        expires_at: e.expires_at,
        replied_after_viewing: repliedAfterViewing,
        link: opts.dryRun ? "(a fresh proposal link is made when it sends)" : null,
      };
      estimate = {
        id: e.id,
        versionId: e.current_version_id,
        jobId: e.job_id,
        expiresAt: e.expires_at,
      };
      break;
    }
    case "daily_log": {
      const { data: l } = await service
        .from("daily_logs")
        .select("id, job_id, finished_today, next_up, customer_update_status, log_date")
        .eq("id", subject.id)
        .maybeSingle();
      if (!l) return null;
      jobId = l.job_id;
      const { count } = await service
        .from("job_photos")
        .select("id", { count: "exact", head: true })
        .eq("daily_log_id", l.id);
      const n = count ?? 0;
      merge.daily_log = {
        id: l.id,
        date: l.log_date,
        finished_today: l.finished_today.trim().replace(/[.!?]+$/, ""),
        next_up: l.next_up?.trim().replace(/[.!?]+$/, "") || null,
        photo_note: n ? `${n} photo${n === 1 ? "" : "s"} from today are in your project.` : null,
        update_status: l.customer_update_status,
      };
      break;
    }
    case "invoice": {
      const { data: inv } = await service
        .from("invoice_ledger")
        .select("id, job_id, invoice_number, balance_cents, days_past_due, status, due_date")
        .eq("id", subject.id)
        .maybeSingle();
      if (!inv) return null;
      jobId = inv.job_id;
      const payloadDays = event.payload.days;
      merge.invoice = {
        id: inv.id,
        number: inv.invoice_number,
        balance_cents: inv.balance_cents ?? 0,
        days_past_due: inv.days_past_due ?? (typeof payloadDays === "number" ? payloadDays : null),
        due_date: inv.due_date,
        how_to_pay: PAYMENT_INSTRUCTIONS_PLACEHOLDER,
        open: inv.status !== "void" && (inv.balance_cents ?? 0) > 0,
      };
      break;
    }
    case "subcontractor": {
      const { data: s } = await service
        .from("subcontractors")
        .select("*")
        .eq("id", subject.id)
        .maybeSingle();
      if (!s) return null;
      const issues = complianceIssues(
        {
          status: s.status,
          lniExpiresOn: s.lni_expires_on,
          coiExpiresOn: s.coi_expires_on,
          bondExpiresOn: s.bond_expires_on,
          rrpExpiresOn: s.rrp_expires_on,
          w9OnFile: s.w9_on_file,
        },
        pacificToday(opts.now),
      );
      merge.subcontractor = {
        id: s.id,
        company_name: s.company_name,
        issues: issues.map((i) => i.message).join(" ") || "Paperwork needs a look.",
      };
      recipients.subcontractor = {
        kind: "subcontractor",
        id: s.id,
        name: s.contact_name ?? s.company_name,
        mobile: s.phone && /^\+[1-9]\d{7,14}$/.test(s.phone) ? s.phone : null,
        email: s.email,
        doNotContact: false,
        smsOptedOut: false,
        emailOptedOut: false,
        smsOptIn: true,
        emailOptIn: true,
      };
      break;
    }
  }

  let thread: LoadedContext["thread"] = null;
  let customerInitiated = false;
  let pocName: string | null = null;

  if (jobId) {
    const part = await loadJobPart(service, jobId);
    if (!part) return null;
    const { job } = part;
    leadId = job.lead_id;
    const poc =
      part.people.get(job.point_of_contact_id ?? "") ?? part.people.get(job.owner_id ?? "");
    const owner = part.people.get(job.owner_id ?? "");
    const pm = part.people.get(job.project_manager_id ?? "");
    const crewLead = part.people.get(part.crew?.lead_user_id ?? "");
    pocName = poc?.full_name ?? null;
    merge.job = {
      id: job.id,
      number: job.job_number,
      name: job.name,
      city: part.city,
      stage: job.stage,
      work_type_keys: job.work_types,
      work_types: serviceWords(job.work_types),
      start_date: job.promised_start_date,
      paid_in_full_at: job.paid_in_full_at,
      prep_list: prepLines(job.work_types)
        .map((l) => `- ${l}`)
        .join("\n"),
      point_of_contact: {
        first_name: firstWord(poc?.full_name),
        full_name: poc?.full_name ?? null,
      },
      owner: { first_name: firstWord(owner?.full_name), full_name: owner?.full_name ?? null },
      crew_lead: { first_name: firstWord(crewLead?.full_name) },
      link: appUrl(`/jobs/${job.id}`),
      closed: CLOSED.has(job.stage) || !!job.deleted_at,
      deleted: !!job.deleted_at,
    };
    if (part.contact) {
      recipients.customer = contactRecipient(part.contact, part.leadDnc);
      merge.contact = {
        first_name: part.contact.first_name,
        last_name: part.contact.last_name,
        full_name: [part.contact.first_name, part.contact.last_name].filter(Boolean).join(" "),
      };
    }
    recipients.crew_lead = staffRecipient(crewLead);
    people.job_owner = person(owner);
    people.point_of_contact = person(part.people.get(job.point_of_contact_id ?? ""));
    people.project_manager = person(pm);
    people.crew_lead = person(crewLead);
    people.crew = [
      ...person(crewLead),
      ...(part.crew?.members ?? [])
        .filter((m) => m.active && m.user_id && m.user_id !== part.crew?.lead_user_id)
        .flatMap((m) => person(part.people.get(m.user_id as string))),
    ];
    thread = { subjectType: "job", subjectId: job.id, contactId: part.contact?.id ?? null };
    customerInitiated = await threadInitiated(
      service,
      orgId,
      "job",
      job.id,
      opts.customerThreadHours,
      opts.now,
    );

    // Facts some workflows read.
    if (subject.type === "rain_delay" || event.type === "job.rain_delay") {
      const id = str(event.payload.rain_delay_id);
      const { data: rd } = id
        ? await service
            .from("rain_delays")
            .select("id, delay_date, notify_customer")
            .eq("id", id)
            .maybeSingle()
        : { data: null };
      merge.rain_delay = rd
        ? { id: rd.id, date: rd.delay_date, notify_customer: rd.notify_customer }
        : {
            date: str(event.payload.date),
            notify_customer: event.payload.notify_customer === true,
          };
    }
    if (event.type === "job.schedule_published") {
      const p = event.payload;
      const startsOn = str(p.starts_on);
      const endsOn = str(p.ends_on);
      const { data: settings } = await service
        .from("schedule_settings")
        .select("day_start, arrival_window_minutes")
        .eq("org_id", orgId)
        .maybeSingle();
      const { data: entries } = await service
        .from("schedule_entries")
        .select("starts_on")
        .eq("job_id", job.id)
        .eq("status", "published")
        .not("starts_on", "is", null)
        .order("starts_on")
        .limit(1);
      const currentStart = entries?.[0]?.starts_on ?? null;
      const leadName = str(p.crew_lead_name);
      merge.schedule = {
        change: str(p.change),
        notify_customer: p.notify_customer === true,
        start_date: startsOn,
        end_date: endsOn,
        dates: startsOn && endsOn ? asciiPunctuation(formatRange(startsOn, endsOn)) : null,
        arrival_window: settings
          ? asciiPunctuation(
              arrivalWindowLabel(settings.day_start, settings.arrival_window_minutes) ?? "",
            )
          : null,
        crew_lead_first_name: firstWord(leadName) ?? firstWord(crewLead?.full_name),
        crew_changes: str(p.crew_changes),
        still_current: str(p.change) === "unscheduled" ? !currentStart : currentStart === startsOn,
      };
      if (str(p.crew_id) && str(p.crew_id) !== job.crew_id) {
        const { data: c } = await service
          .from("crews")
          .select("lead_user_id, members:crew_members(user_id, active)")
          .eq("id", str(p.crew_id) as string)
          .maybeSingle();
        const ppl = await profiles(service, [
          c?.lead_user_id ?? null,
          ...(c?.members ?? []).filter((m) => m.active).map((m) => m.user_id),
        ]);
        const lead = ppl.get(c?.lead_user_id ?? "");
        recipients.crew_lead = staffRecipient(lead);
        people.crew_lead = person(lead);
        people.crew = [...ppl.values()].map((x) => ({ id: x.id, name: x.full_name }));
      }
    }
  }

  if (leadId && !jobId) {
    const part = await loadLeadPart(service, leadId);
    if (!part) return null;
    const { lead } = part;
    const poc =
      part.people.get(lead.point_of_contact_id ?? "") ?? part.people.get(lead.owner_id ?? "");
    pocName = poc?.full_name ?? null;
    recipients.customer = leadRecipient(lead, part.contact);
    merge.contact = {
      first_name: lead.first_name,
      last_name: lead.last_name,
      full_name: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    };
    people.lead_owner = person(part.people.get(lead.owner_id ?? ""));
    thread = { subjectType: "lead", subjectId: lead.id, contactId: lead.contact_id };
    customerInitiated = await threadInitiated(
      service,
      orgId,
      "lead",
      lead.id,
      opts.customerThreadHours,
      opts.now,
    );
  }
  if (leadId) {
    const { data: lead } = await service.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (lead) {
      merge.lead = {
        id: lead.id,
        first_name: lead.first_name,
        status: lead.status,
        intake_channel: lead.intake_channel,
        timeline: lead.timeline,
        owner_id: lead.owner_id,
        territory_id: lead.territory_id,
        service_keys: lead.services,
        services: serviceWords(lead.services),
        city: lead.city,
        open: OPEN_LEAD.has(lead.status),
        link: appUrl(`/leads/${lead.id}`),
      };
      if (!people.lead_owner) {
        const p = await profiles(service, [lead.owner_id]);
        people.lead_owner = person(p.get(lead.owner_id ?? ""));
      }
    }
  }

  // Signature: the point of contact, else the owner of the record, else the first owner.
  const signer = pocName ?? people.owners?.[0]?.name ?? null;
  // (An empty company with no owners signs as "the team".)
  merge.poc = {
    first_name: firstWord(signer) ?? "the team",
    full_name: signer ?? String(company.name),
  };

  // Review and referral bits.
  const reward =
    typeof company.referral_reward_cents === "number"
      ? formatCents(company.referral_reward_cents)
      : "[REFERRAL_REWARD]";
  merge.referral = { code: opts.dryRun ? "(their Bear Champion code)" : null, reward };
  merge.review = { link: opts.dryRun ? "(a tracked review link)" : null };

  // Audiences that need a permission lookup.
  const [schedulers, finance] = await Promise.all([
    withPermission(service, orgId, "schedule:publish"),
    withPermission(service, orgId, "payments:record"),
  ]);
  people.schedulers = schedulers;
  people.finance = finance;

  return {
    orgId,
    merge,
    facts: merge,
    recipients,
    people,
    customerInitiated,
    thread,
    jobId,
    leadId,
    estimate,
  };
}

/** The job behind an event's aggregate (for workflows about a job). */
export async function jobIdForAggregate(
  service: Db,
  aggregateType: string,
  id: string,
): Promise<string | null> {
  const lookups: Record<
    string,
    "estimates" | "invoices" | "daily_logs" | "appointments" | "on_time_credits" | "change_orders"
  > = {
    estimate: "estimates",
    invoice: "invoices",
    daily_log: "daily_logs",
    appointment: "appointments",
    on_time_credit: "on_time_credits",
    change_order: "change_orders",
  };
  const table = lookups[aggregateType];
  if (aggregateType === "job") return id;
  if (!table) return null;
  const { data } = await service.from(table).select("job_id").eq("id", id).maybeSingle();
  const j = (data as { job_id: string | null } | null)?.job_id;
  return j ?? null;
}
