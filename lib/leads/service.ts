import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { toBusinessHours } from "@/lib/domain/company-settings";
import { businessSecondsBetween } from "@/lib/domain/leads/speed-to-lead";
import { scoreInputFromLead, scoreLead } from "@/lib/domain/leads/scoring";
import { findDuplicate, describeMatch, dedupeWindowStart } from "@/lib/domain/leads/dedupe";
import type { Service, Timeline } from "@/lib/domain/leads/constants";
import { normalizeEmail, normalizePhone } from "@/lib/domain/leads/normalize";
import { normalizeZip } from "@/lib/domain/territory";

/**
 * Lead operations shared by the wizard, Lead Detail, the list and (later)
 * workflows. Every function takes the client to use: the user-scoped client
 * wherever RLS should decide, the service client only after explicit checks.
 */

type Db = SupabaseClient<Database>;

export type Option = { value: string; label: string; parent?: string | null; active?: boolean };

export type LeadOptions = {
  picklists: Record<
    | "lead_source"
    | "lead_sub_source"
    | "lead_disposition"
    | "property_type"
    | "siding_type"
    | "lost_reason",
    Option[]
  >;
  users: Option[];
  territories: Option[];
};

const PICKLISTS = [
  "lead_source",
  "lead_sub_source",
  "lead_disposition",
  "property_type",
  "siding_type",
  "lost_reason",
] as const;

/** Picklist values, active users and territories for lead forms and filters. */
export async function loadLeadOptions(db: Db): Promise<LeadOptions> {
  const [lists, users, territories] = await Promise.all([
    db
      .from("picklists")
      .select("key, picklist_values(id, value, label, active, sort_order, parent_value_id)")
      .in("key", [...PICKLISTS]),
    db.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    db.from("territories").select("id, name").eq("active", true).order("sort_order"),
  ]);
  const picklists = Object.fromEntries(
    PICKLISTS.map((k) => [k, [] as Option[]]),
  ) as LeadOptions["picklists"];
  const idToValue = new Map<string, string>();
  for (const l of lists.data ?? []) {
    for (const v of l.picklist_values) idToValue.set(v.id, v.value);
  }
  for (const l of lists.data ?? []) {
    const key = l.key as (typeof PICKLISTS)[number];
    picklists[key] = [...l.picklist_values]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        value: v.value,
        label: v.label,
        active: v.active,
        parent: v.parent_value_id ? (idToValue.get(v.parent_value_id) ?? null) : null,
      }));
  }
  return {
    picklists,
    users: (users.data ?? []).map((u) => ({ value: u.id, label: u.full_name })),
    territories: (territories.data ?? []).map((t) => ({ value: t.id, label: t.name })),
  };
}

export type DuplicateHit = {
  id: string;
  name: string;
  status: string;
  ownerName: string | null;
  createdAt: string;
  reason: string;
  /** False when the duplicate belongs to someone the user can't see; show a notice, not a link. */
  canOpen: boolean;
};

/**
 * Live duplicate check (SPEC §8.4). Looks across the whole company with the
 * service client, because duplicates hide behind "own" scope too, but reveals
 * only a name, status and owner. `visibleIds` tells which ones the user may open.
 */
export async function findLeadDuplicates(
  service: Db,
  user: Db,
  orgId: string,
  input: {
    mobile?: string | null;
    phone?: string | null;
    email?: string | null;
    street?: string | null;
    zip?: string | null;
    excludeId?: string;
  },
  now: Date = new Date(),
): Promise<DuplicateHit[]> {
  const phones = [normalizePhone(input.mobile), normalizePhone(input.phone)].filter(
    (p): p is string => Boolean(p),
  );
  const email = normalizeEmail(input.email);
  const zip = normalizeZip(input.zip);
  const street = input.street?.trim().toLowerCase() || null;
  const ors: string[] = [];
  for (const p of phones) ors.push(`mobile.eq."${p}"`, `phone.eq."${p}"`);
  if (email) ors.push(`email.eq."${email}"`);
  if (street && zip)
    ors.push(`and(zip.eq."${zip}",street.ilike."${street.replace(/["\\*%]/g, "")}")`);
  if (ors.length === 0) return [];

  let q = service
    .from("leads")
    .select(
      "id, first_name, last_name, mobile, phone, email, street, zip, status, created_at, last_activity_at, owner:profiles!leads_owner_id_fkey(full_name)",
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .gte("created_at", dedupeWindowStart(now).toISOString())
    .or(ors.join(","))
    .order("last_activity_at", { ascending: false })
    .limit(5);
  if (input.excludeId) q = q.neq("id", input.excludeId);
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) return [];

  const { data: visible } = await user
    .from("leads")
    .select("id")
    .in(
      "id",
      data.map((d) => d.id),
    );
  const visibleIds = new Set((visible ?? []).map((v) => v.id));

  return data.map((d) => {
    const match = findDuplicate({ phones, email }, [d], now);
    const addressMatch = Boolean(
      street && zip && d.zip === zip && d.street?.toLowerCase() === street,
    );
    const reason = match
      ? describeMatch(match.matchedOn)
      : addressMatch
        ? "Same address"
        : "Similar contact details";
    return {
      id: d.id,
      name: [d.first_name, d.last_name].filter(Boolean).join(" "),
      status: d.status,
      ownerName: d.owner?.full_name ?? null,
      createdAt: d.created_at,
      reason,
      canOpen: visibleIds.has(d.id),
    };
  });
}

/** Recomputes and stores a lead's score from its current fields and activity. */
export async function rescoreLead(db: Db, leadId: string, now: Date = new Date()): Promise<void> {
  const [{ data: lead, error }, photos, inbound, outbound, rules] = await Promise.all([
    db
      .from("leads")
      .select(
        "org_id, zip, out_of_area, territory_id, mobile, email, street, timeline, services, lead_source",
      )
      .eq("id", leadId)
      .single(),
    db.from("lead_attachments").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    db
      .from("messages")
      .select("created_at")
      .eq("subject_type", "lead")
      .eq("subject_id", leadId)
      .eq("direction", "inbound")
      .eq("channel", "sms")
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("messages")
      .select("created_at")
      .eq("subject_type", "lead")
      .eq("subject_id", leadId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("lead_scoring_rules").select("factor, label, points, active"),
  ]);
  if (error) throw error;
  const lastReply = inbound.data?.[0]?.created_at ?? null;
  const unanswered = (outbound.data ?? []).filter(
    (m) => !lastReply || m.created_at > lastReply,
  ).length;
  const score = scoreLead(
    scoreInputFromLead(
      {
        zip: lead.zip,
        out_of_area: lead.out_of_area,
        territory_id: lead.territory_id,
        mobile: lead.mobile,
        email: lead.email,
        street: lead.street,
        timeline: lead.timeline as Timeline | null,
        services: lead.services as Service[],
        lead_source: lead.lead_source,
      },
      {
        photoCount: photos.count ?? 0,
        respondedToText: lastReply !== null,
        unansweredAttempts: unanswered,
      },
    ),
    rules.data ?? [],
  );
  const { error: upErr } = await db
    .from("leads")
    .update({
      score: score.score,
      grade: score.grade,
      temperature: score.temperature,
      score_factors: score.factors,
      scored_at: now.toISOString(),
    })
    .eq("id", leadId);
  if (upErr) throw upErr;
}

/**
 * A person called, texted or emailed the lead. The first time, record when
 * (speed-to-lead, business hours only) and move New → Contacted (SPEC §6.1:
 * auto-texts don't count; a human touch is required).
 */
export async function recordHumanContact(
  db: Db,
  leadId: string,
  at: Date = new Date(),
): Promise<void> {
  const { data: lead, error } = await db
    .from("leads")
    .select("org_id, status, created_at, first_contacted_at")
    .eq("id", leadId)
    .single();
  if (error) throw error;
  if (lead.first_contacted_at) return;
  const { data: settings } = await db
    .from("company_settings")
    .select("business_hours")
    .eq("org_id", lead.org_id)
    .maybeSingle();
  const seconds = businessSecondsBetween(
    new Date(lead.created_at),
    at,
    toBusinessHours(settings?.business_hours),
  );
  const { error: upErr } = await db
    .from("leads")
    .update({
      first_contacted_at: at.toISOString(),
      speed_to_lead_seconds: seconds,
      ...(lead.status === "new" ? { status: "contacted" } : {}),
    })
    .eq("id", leadId);
  if (upErr) throw upErr;
}
