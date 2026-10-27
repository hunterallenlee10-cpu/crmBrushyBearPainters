import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { sendCustomerNotice, signerName } from "@/lib/production/notify";
import { reminderMessage, REMINDER_TEMPLATE_KEY } from "./messages";

type Db = SupabaseClient<Database>;

/**
 * Overdue reminders (SPEC §11.2 #14, §9): the worker raises one
 * `invoice.overdue` event per invoice at 7 and 30 days past due; this sends
 * the customer a friendly reminder through the outbox (simulated, consent
 * and Do Not Contact apply, signed by the point of contact) and tells the
 * job's people and the owners in the app. Draft wording – owner to approve.
 */
export async function sendOverdueReminder(
  service: Db,
  invoiceId: string,
  days: number,
): Promise<"processed" | "skipped"> {
  const { data: inv } = await service
    .from("invoice_ledger")
    .select("id, org_id, job_id, invoice_number, balance_cents, days_past_due, status, job_name")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv?.job_id || !inv.org_id || inv.status === "void" || (inv.balance_cents ?? 0) <= 0) {
    return "skipped";
  }
  const [{ data: job }, { data: company }] = await Promise.all([
    service
      .from("jobs")
      .select(
        "id, name, owner_id, point_of_contact_id, contact:contacts!jobs_primary_contact_id_fkey(first_name)",
      )
      .eq("id", inv.job_id)
      .maybeSingle(),
    service.from("company_settings").select("company_name").eq("org_id", inv.org_id).maybeSingle(),
  ]);
  if (!job) return "skipped";
  const companyName = company?.company_name ?? "Brushy Bear Painters";
  const msg = reminderMessage({
    customerFirstName: job.contact?.first_name ?? null,
    senderName: await signerName(service, job.id, companyName),
    companyName,
    invoiceNumber: inv.invoice_number ?? "",
    balanceCents: inv.balance_cents ?? 0,
    daysPastDue: inv.days_past_due ?? days,
  });
  const sent = await sendCustomerNotice(service, job.id, {
    sms: msg.sms,
    emailSubject: msg.emailSubject,
    emailBody: msg.emailBody,
    templateKey: REMINDER_TEMPLATE_KEY,
    actorId: null,
  });

  const { data: owners } = await service
    .from("profiles")
    .select("id, role_templates!inner(grants_all)")
    .eq("org_id", inv.org_id)
    .eq("is_active", true)
    .eq("role_templates.grants_all", true);
  const people = new Set(
    [job.point_of_contact_id, job.owner_id, ...(owners ?? []).map((o) => o.id)].filter(
      (u): u is string => !!u,
    ),
  );
  if (people.size) {
    const { error } = await service.from("notifications").insert(
      [...people].map((user_id) => ({
        org_id: inv.org_id as string,
        user_id,
        type: "finance",
        title: `Invoice ${inv.invoice_number} is ${days}+ days past due: ${job.name}`.slice(0, 200),
        body:
          sent.status === "simulated"
            ? `A reminder was recorded by ${sent.channel === "sms" ? "text" : "email"} (simulated).`
            : `No reminder sent: ${sent.reason}`,
        link: `/jobs/${job.id}?section=financial&tab=invoices`,
      })),
    );
    if (error) throw error;
  }
  return "processed";
}
