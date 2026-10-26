"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { bulkAssignSchema, bulkStatusSchema } from "@/lib/validation/leads";
import type { Grade, LeadStatus, Temperature } from "@/lib/domain/leads/constants";

/** Lead List: quick preview and bulk actions. RLS limits every read and write. */

export type LeadPreview = {
  id: string;
  name: string;
  company: string | null;
  status: LeadStatus;
  grade: Grade | null;
  score: number | null;
  temperature: Temperature | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  outOfArea: boolean;
  services: string[];
  timeline: string | null;
  homeBuilt: string | null;
  source: string;
  subSource: string | null;
  ownerName: string | null;
  walkthroughAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  notes: string | null;
  factors: { label: string; points: number }[];
};

export const getLeadPreview = defineAction({
  name: "leads.preview",
  permissions: ["leads:read"],
  schema: z.object({ id: z.uuid() }),
  handler: async ({ id }, { supabase }): Promise<LeadPreview> => {
    const { data: l, error } = await supabase
      .from("leads")
      .select(
        "id, first_name, last_name, company, status, grade, score, temperature, mobile, phone, email, street, unit, city, state, zip, out_of_area, services, timeline, home_built, lead_source, lead_sub_source, walkthrough_at, created_at, last_activity_at, customer_notes, score_factors, owner:profiles!leads_owner_id_fkey(full_name)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!l) throw new ActionFailure({ code: "not_found", message: "That lead isn't available." });
    const address = [
      l.street && [l.street, l.unit].filter(Boolean).join(" "),
      l.city,
      [l.state, l.zip].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    const factors = Array.isArray(l.score_factors)
      ? l.score_factors.flatMap((f) =>
          f && typeof f === "object" && "label" in f && "points" in f
            ? [{ label: String(f.label), points: Number(f.points) }]
            : [],
        )
      : [];
    return {
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" "),
      company: l.company,
      status: l.status as LeadStatus,
      grade: l.grade as Grade | null,
      score: l.score,
      temperature: l.temperature as Temperature | null,
      mobile: l.mobile,
      phone: l.phone,
      email: l.email,
      address: address || null,
      outOfArea: l.out_of_area,
      services: l.services,
      timeline: l.timeline,
      homeBuilt: l.home_built,
      source: l.lead_source,
      subSource: l.lead_sub_source,
      ownerName: l.owner?.full_name ?? null,
      walkthroughAt: l.walkthrough_at,
      createdAt: l.created_at,
      lastActivityAt: l.last_activity_at,
      notes: l.customer_notes,
      factors,
    };
  },
});

export const bulkAssignLeads = defineAction({
  name: "leads.bulk_assign",
  permissions: ["leads:assign"],
  schema: bulkAssignSchema,
  handler: async ({ ids, owner_id }, { supabase }) => {
    const rows = check(
      await supabase.from("leads").update({ owner_id }).in("id", ids).select("id"),
    );
    revalidatePath("/leads/list");
    return { updated: rows?.length ?? 0, skipped: ids.length - (rows?.length ?? 0) };
  },
});

export const bulkSetLeadStatus = defineAction({
  name: "leads.bulk_status",
  permissions: ["leads:update"],
  schema: bulkStatusSchema,
  handler: async ({ ids, status }, { supabase }) => {
    const rows = check(
      await supabase
        .from("leads")
        .update({ status })
        .in("id", ids)
        .in("status", ["new", "contacted", "nurture", "unqualified", "walkthrough_scheduled"])
        .select("id"),
    );
    revalidatePath("/leads/list");
    return { updated: rows?.length ?? 0, skipped: ids.length - (rows?.length ?? 0) };
  },
});
