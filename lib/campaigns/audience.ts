import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { AudienceMember, AudienceModule } from "@/lib/domain/campaigns";
import { filterToOps, type FieldDef, type FilterSpec } from "@/lib/lists/filters";
import { CONTACT_FIELDS } from "@/lib/lists/modules/contacts";
import { JOB_FIELDS } from "@/lib/lists/modules/jobs";
import { LEAD_FIELDS } from "@/lib/lists/modules/leads";
import { applyOps } from "@/lib/lists/server";
import {
  contactRecipient,
  leadRecipient,
  type ContactRow,
  type LeadRow,
} from "@/lib/workflows/context";

type Db = SupabaseClient<Database>;

/**
 * Campaign audiences (SPEC §8.11 "audience builder"): the same field · operator
 * · value rules as the list filters, over contacts, leads, or the primary
 * contacts of matching jobs. The preview reads with the person's own client;
 * the worker uses the service client and always filters by company.
 */

export const AUDIENCE_CAP = 2000;

export type AudienceSpec = { module: AudienceModule } & FilterSpec;

/** Fields an audience can use (columns on the table itself). */
export function audienceFields(module: AudienceModule): readonly FieldDef[] {
  const base =
    module === "contacts" ? CONTACT_FIELDS : module === "leads" ? LEAD_FIELDS : JOB_FIELDS;
  return base.filter((f) => !f.column.includes("."));
}

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function fromContact(c: ContactRow): AudienceMember {
  const r = contactRecipient(c, false);
  return {
    subjectType: "contact",
    subjectId: c.id,
    name: r.name,
    firstName: c.first_name || firstName(r.name),
    recipient: r,
  };
}

export async function resolveAudience(
  db: Db,
  spec: AudienceSpec,
  opts: { orgId?: string; now?: Date; limit?: number } = {},
): Promise<{ members: AudienceMember[]; capped: boolean }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(opts.limit ?? AUDIENCE_CAP, AUDIENCE_CAP);
  const ops = filterToOps(
    { match: spec.match, rules: spec.rules },
    audienceFields(spec.module),
    now,
  );

  if (spec.module === "contacts") {
    let q = db.from("contacts").select("*").is("deleted_at", null);
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    const { data, error } = await applyOps(q, ops)
      .order("created_at")
      .limit(limit + 1);
    if (error) throw error;
    const rows = data ?? [];
    return { members: rows.slice(0, limit).map(fromContact), capped: rows.length > limit };
  }

  if (spec.module === "leads") {
    let q = db.from("leads").select("*").is("deleted_at", null);
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    const { data, error } = await applyOps(q, ops)
      .order("created_at")
      .limit(limit + 1);
    if (error) throw error;
    const rows = (data ?? []) as LeadRow[];
    const contactIds = [...new Set(rows.map((l) => l.contact_id).filter((x): x is string => !!x))];
    const { data: contacts } = contactIds.length
      ? await db.from("contacts").select("*").in("id", contactIds)
      : { data: [] as ContactRow[] };
    const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
    return {
      members: rows.slice(0, limit).map((l) => {
        const r = leadRecipient(l, l.contact_id ? (byId.get(l.contact_id) ?? null) : null);
        return {
          subjectType: "lead" as const,
          subjectId: l.id,
          name: r.name,
          firstName: l.first_name || firstName(r.name),
          recipient: r,
        };
      }),
      capped: rows.length > limit,
    };
  }

  // Jobs: their primary contacts, once each.
  let q = db.from("jobs").select("id, primary_contact_id").is("deleted_at", null);
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  const { data, error } = await applyOps(q, ops)
    .order("created_at")
    .limit(limit * 2);
  if (error) throw error;
  const ids = [
    ...new Set((data ?? []).map((j) => j.primary_contact_id).filter((x): x is string => !!x)),
  ];
  const take = ids.slice(0, limit);
  const { data: contacts } = take.length
    ? await db.from("contacts").select("*").in("id", take).is("deleted_at", null)
    : { data: [] as ContactRow[] };
  return { members: (contacts ?? []).map(fromContact), capped: ids.length > limit };
}
