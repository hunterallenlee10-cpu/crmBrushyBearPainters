import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  keywordEffect,
  phoneKey,
  routeInbound,
  type InboundCandidate,
} from "@/lib/domain/messaging";
import { normalizeEmail, normalizePhone } from "@/lib/domain/leads/normalize";
import { logError } from "@/lib/log";
import type { InboundMessageInput } from "@/lib/validation/messaging";
import { loadCompanyMerge, recordOutbound } from "./core";

type Db = SupabaseClient<Database>;

/**
 * Inbound texts and emails (SPEC §5.7 threads, §13.2): the stub a real SMS or
 * email provider would call. Finds the conversation (an open job, then an open
 * lead, by phone number or email), records the message on its thread as
 * unread, and handles STOP / UNSUBSCRIBE / START / HELP: consent is updated on
 * every contact and lead with that number, and the carrier-style reply is
 * recorded in the outbox (simulated). Service client: the route checked the
 * shared secret.
 */

export type InboundResult = {
  matched: boolean;
  messageId: string | null;
  subject: { type: "lead" | "job" | "contact"; id: string } | null;
  keyword: "opt_out" | "opt_in" | "help" | null;
  duplicate: boolean;
};

const CLOSED = new Set(["closed_won", "closed_lost"]);
const OPEN_LEAD = new Set(["new", "contacted", "walkthrough_scheduled", "nurture"]);

async function candidatesFor(service: Db, orgId: string, input: InboundMessageInput) {
  const out: InboundCandidate[] = [];
  const isSms = input.channel === "sms";
  const digits = isSms ? phoneKey(input.from) : null;
  const email = !isSms ? normalizeEmail(input.from) : null;
  if (isSms && !digits) return { out, contactIds: [] as string[], leadIds: [] as string[] };
  if (!isSms && !email) return { out, contactIds: [] as string[], leadIds: [] as string[] };

  const contactQ = service
    .from("contacts")
    .select("id, account_id, updated_at")
    .eq("org_id", orgId)
    .is("deleted_at", null);
  const { data: contacts } = isSms
    ? await contactQ.like("phone_digits", `%${digits}%`)
    : await contactQ.ilike("email", email as string);
  const leadQ = service
    .from("leads")
    .select("id, status, contact_id, last_activity_at, converted_job_id")
    .eq("org_id", orgId)
    .is("deleted_at", null);
  const { data: leads } = isSms
    ? await leadQ.like("phone_digits", `%${digits}%`)
    : await leadQ.ilike("email", email as string);

  const contactIds = (contacts ?? []).map((c) => c.id);
  if (contactIds.length) {
    const { data: jobs } = await service
      .from("jobs")
      .select("id, stage, primary_contact_id, updated_at")
      .in("primary_contact_id", contactIds)
      .is("deleted_at", null);
    for (const j of jobs ?? []) {
      out.push({
        subjectType: "job",
        subjectId: j.id,
        contactId: j.primary_contact_id,
        open: !CLOSED.has(j.stage),
        lastActivityAt: j.updated_at,
      });
    }
  }
  for (const l of leads ?? []) {
    if (l.converted_job_id) continue; // the job holds the conversation now
    out.push({
      subjectType: "lead",
      subjectId: l.id,
      contactId: l.contact_id,
      open: OPEN_LEAD.has(l.status),
      lastActivityAt: l.last_activity_at,
    });
  }
  if (!out.length) {
    for (const c of contacts ?? []) {
      out.push({
        subjectType: "contact",
        subjectId: c.id,
        contactId: c.id,
        open: true,
        lastActivityAt: c.updated_at,
      });
    }
  }
  return { out, contactIds, leadIds: (leads ?? []).map((l) => l.id) };
}

async function applyKeyword(
  service: Db,
  kind: "opt_out" | "opt_in",
  contactIds: readonly string[],
  leadIds: readonly string[],
  now: Date,
) {
  const at = now.toISOString();
  if (contactIds.length) {
    const patch =
      kind === "opt_out"
        ? { opted_out_at: at, sms_opt_in: false, sms_opt_in_at: null, sms_opt_in_source: null }
        : {
            opted_out_at: null,
            sms_opt_in: true,
            sms_opt_in_at: at,
            sms_opt_in_source: "sms_keyword_start",
          };
    const { error } = await service.from("contacts").update(patch).in("id", contactIds);
    if (error) logError("inbound.keyword.contacts", error);
  }
  if (leadIds.length) {
    const { error } = await service
      .from("leads")
      .update({ sms_opted_out_at: kind === "opt_out" ? at : null })
      .in("id", leadIds);
    if (error) logError("inbound.keyword.leads", error);
  }
}

export async function recordInbound(
  service: Db,
  orgId: string,
  input: InboundMessageInput,
  now = new Date(),
): Promise<InboundResult> {
  const { out, contactIds, leadIds } = await candidatesFor(service, orgId, input);
  const pick = routeInbound(out);
  const effect =
    input.channel === "sms"
      ? keywordEffect(
          input.body,
          await loadCompanyMerge(service, orgId).then((c) => ({
            name: String(c.name),
            phone: String(c.phone),
          })),
        )
      : { kind: "none" as const };
  if (effect.kind === "opt_out" || effect.kind === "opt_in") {
    await applyKeyword(service, effect.kind, contactIds, leadIds, now);
  }
  const keyword = effect.kind === "none" ? null : effect.kind;
  if (!pick) return { matched: false, messageId: null, subject: null, keyword, duplicate: false };

  const from =
    input.channel === "sms"
      ? (normalizePhone(input.from) ?? input.from)
      : (normalizeEmail(input.from) ?? input.from);
  const { data: msg, error } = await service
    .from("messages")
    .insert({
      org_id: orgId,
      channel: input.channel,
      direction: "inbound",
      subject_type: pick.subjectType,
      subject_id: pick.subjectId,
      contact_id: pick.contactId,
      from_address: from,
      to_address: input.to ?? null,
      email_subject: input.channel === "email" ? (input.subject ?? null) : null,
      body: input.body,
      status: "received",
      simulated: false,
      provider_message_id: input.provider_message_id ?? null,
      created_at: input.received_at ?? now.toISOString(),
    })
    .select("id, thread_id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return {
        matched: true,
        messageId: null,
        subject: { type: pick.subjectType, id: pick.subjectId },
        keyword,
        duplicate: true,
      };
    }
    throw error;
  }

  // The carrier-style reply to a keyword (transactional, never held by quiet hours).
  if (effect.kind !== "none") {
    try {
      await recordOutbound(service, {
        orgId,
        channel: "sms",
        to: from,
        body: effect.reply,
        messageType: "transactional",
        related: { type: pick.subjectType, id: pick.subjectId },
        thread: {
          subjectType: pick.subjectType,
          subjectId: pick.subjectId,
          contactId: pick.contactId,
        },
        templateKey: `keyword_${effect.kind}`,
      });
    } catch (e) {
      logError("inbound.keyword.reply", e);
    }
  }

  // Campaign replies and unsubscribes count on the campaign that reached them.
  const since = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString();
  const recipientPatch =
    effect.kind === "opt_out"
      ? { replied_at: now.toISOString(), unsubscribed_at: now.toISOString() }
      : { replied_at: now.toISOString() };
  if (pick.contactId) {
    await service
      .from("campaign_recipients")
      .update(recipientPatch)
      .eq("contact_id", pick.contactId)
      .gte("sent_at", since)
      .is("replied_at", null);
  }
  for (const id of leadIds) {
    await service
      .from("campaign_recipients")
      .update(recipientPatch)
      .eq("lead_id", id)
      .gte("sent_at", since)
      .is("replied_at", null);
  }

  // Tell the owner / point of contact (keyword-only texts are handled already).
  if (effect.kind === "none") await notifyOwner(service, orgId, pick, input);

  return {
    matched: true,
    messageId: msg.id,
    subject: { type: pick.subjectType, id: pick.subjectId },
    keyword,
    duplicate: false,
  };
}

async function notifyOwner(
  service: Db,
  orgId: string,
  pick: InboundCandidate,
  input: InboundMessageInput,
) {
  let users: (string | null)[] = [];
  let name = "a customer";
  let link = "/messages";
  if (pick.subjectType === "job") {
    const { data } = await service
      .from("jobs")
      .select("name, owner_id, point_of_contact_id")
      .eq("id", pick.subjectId)
      .maybeSingle();
    users = [data?.point_of_contact_id ?? null, data?.owner_id ?? null];
    name = data?.name ?? name;
    link = `/jobs/${pick.subjectId}?section=messages`;
  } else if (pick.subjectType === "lead") {
    const { data } = await service
      .from("leads")
      .select("first_name, last_name, owner_id, point_of_contact_id")
      .eq("id", pick.subjectId)
      .maybeSingle();
    users = [data?.point_of_contact_id ?? null, data?.owner_id ?? null];
    name = data ? [data.first_name, data.last_name].filter(Boolean).join(" ") : name;
    link = `/leads/${pick.subjectId}?tab=activity`;
  }
  const ids = [...new Set(users.filter((u): u is string => !!u))];
  if (!ids.length) return;
  const preview = input.body.replace(/\s+/g, " ").trim().slice(0, 200);
  const { error } = await service.from("notifications").insert(
    ids.map((user_id) => ({
      org_id: orgId,
      user_id,
      type: "message",
      title: `New ${input.channel === "sms" ? "text" : "email"} from ${name}`.slice(0, 200),
      body: preview || null,
      link,
    })),
  );
  if (error) logError("inbound.notify", error);
}
