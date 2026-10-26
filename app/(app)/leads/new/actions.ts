"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/domain/leads/constants";
import { LEAD_PHOTO_BUCKET } from "@/lib/intake/process";
import { findLeadDuplicates, loadLeadOptions, rescoreLead } from "@/lib/leads/service";
import { logError } from "@/lib/log";
import { safeFileName } from "@/lib/validation/intake";
import { duplicateCheckSchema, leadCreateSchema } from "@/lib/validation/leads";
import {
  MAX_PHOTOS,
  fieldForDbMessage,
  photoMetaSchema,
  resolveHomeBuilt,
  subSourceIssue,
} from "./helpers";

/**
 * New Lead wizard actions (SPEC §8.4). Writes go through the user's client so
 * RLS and the leads guard decide; audit rows and the `lead.created` event come
 * from database triggers. The service client is used only for the
 * company-wide duplicate lookup and Storage, after the permission checks.
 */

export type DuplicateNotice = {
  key: string;
  /** Only set when the viewer may open the lead. */
  id: string | null;
  name: string;
  status: string;
  ownerName: string | null;
  reason: string;
  canOpen: boolean;
};

export const checkLeadDuplicates = defineAction({
  name: "leads.duplicate_check",
  permissions: ["leads:create"],
  schema: duplicateCheckSchema,
  handler: async (input, { supabase, service, viewer }): Promise<DuplicateNotice[]> => {
    const hits = await findLeadDuplicates(await service(), supabase, viewer.orgId, {
      mobile: input.mobile,
      phone: input.phone,
      email: input.email,
      street: input.street,
      zip: input.zip,
      excludeId: input.exclude_id,
    });
    // Name, status and owner only; nothing else about a lead the viewer can't open.
    return hits.map((h, i) => ({
      key: h.canOpen ? h.id : `hidden-${i}`,
      id: h.canOpen ? h.id : null,
      name: h.name,
      status: LEAD_STATUS_LABELS[h.status as LeadStatus] ?? h.status,
      ownerName: h.ownerName,
      reason: h.reason,
      canOpen: h.canOpen,
    }));
  },
});

const OWNER_MESSAGE = "Only people who can assign leads can create a lead for someone else.";

export const createLead = defineAction({
  name: "leads.create",
  permissions: ["leads:create"],
  schema: leadCreateSchema,
  handler: async (v, { supabase, viewer }) => {
    const options = await loadLeadOptions(supabase);
    const subIssue = subSourceIssue(
      v.lead_source,
      v.lead_sub_source,
      options.picklists.lead_sub_source,
    );
    if (subIssue) {
      throw new ActionFailure(
        actionError("validation", undefined, { lead_sub_source: [subIssue] }),
      );
    }
    const ownerId = v.owner_id ?? viewer.id;
    if (ownerId !== viewer.id && !viewer.can("leads:assign")) {
      throw new ActionFailure(
        actionError("forbidden", OWNER_MESSAGE, { owner_id: [OWNER_MESSAGE] }),
      );
    }

    const { data, error } = await supabase
      .from("leads")
      .insert({
        org_id: viewer.orgId,
        intake_channel: "manual",
        first_name: v.first_name,
        last_name: v.last_name,
        company: v.company,
        mobile: v.mobile,
        phone: v.phone,
        email: v.email,
        street: v.street,
        unit: v.unit,
        city: v.city,
        state: v.state,
        zip: v.zip,
        year_built: v.year_built,
        home_built: resolveHomeBuilt(v.year_built, v.home_built),
        property_type: v.property_type,
        stories: v.stories,
        siding_type: v.siding_type,
        has_hoa: v.has_hoa,
        services: v.services,
        timeline: v.timeline,
        lead_source: v.lead_source,
        lead_sub_source: v.lead_sub_source,
        lead_set_by: v.lead_set_by ?? viewer.id,
        owner_id: ownerId,
        customer_notes: v.customer_notes,
      })
      .select("id")
      .single();
    if (error || !data) {
      const mapped = mapDbError(error);
      const field = fieldForDbMessage(mapped.message);
      throw new ActionFailure(
        field ? { ...mapped, fieldErrors: { [field]: [mapped.message] } } : mapped,
      );
    }

    // The lead is saved either way; a scoring hiccup shouldn't make someone save it twice.
    try {
      await rescoreLead(supabase, data.id);
    } catch (e) {
      logError("action:leads.create.rescore", e);
    }
    revalidatePath("/leads/list");
    revalidatePath("/leads");
    return { id: data.id };
  },
});

/** Signed one-time upload URLs in the private bucket, under `<org>/<new uuid>/<safe name>`. */
export const createLeadPhotoUploads = defineAction({
  name: "leads.photo_upload_urls",
  permissions: ["leads:create"],
  schema: z.object({
    lead_id: z.uuid(),
    files: z.array(photoMetaSchema).min(1).max(MAX_PHOTOS),
  }),
  handler: async ({ lead_id, files }, { supabase, service, viewer }) => {
    // The viewer must be able to see the lead (RLS) before we hand out upload URLs.
    const lead = check(await supabase.from("leads").select("id").eq("id", lead_id).maybeSingle());
    if (!lead) throw new ActionFailure(actionError("not_found", "That lead isn't available."));
    const db = await service();
    const uploads: { path: string; token: string }[] = [];
    for (const f of files) {
      const path = `${viewer.orgId}/${randomUUID()}/${safeFileName(f.file_name)}`;
      const { data, error } = await db.storage.from(LEAD_PHOTO_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw error ?? new Error("createSignedUploadUrl failed");
      uploads.push({ path, token: data.token });
    }
    return { bucket: LEAD_PHOTO_BUCKET, uploads };
  },
});

const attachSchema = z.object({
  lead_id: z.uuid(),
  photos: z
    .array(
      photoMetaSchema.extend({
        path: z
          .string()
          .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/, "Unknown upload."),
      }),
    )
    .min(1)
    .max(MAX_PHOTOS),
});

/**
 * Records uploaded files on the lead. Each object must exist in this
 * company's folder; the row is inserted with the user's client, so RLS checks
 * that they may edit the lead. Then the lead is rescored ("Sent photos").
 */
export const attachLeadPhotos = defineAction({
  name: "leads.attach_photos",
  permissions: ["leads:create"],
  schema: attachSchema,
  handler: async ({ lead_id, photos }, { supabase, service, viewer }) => {
    const db = await service();
    const verified: typeof photos = [];
    for (const p of photos) {
      if (!p.path.startsWith(`${viewer.orgId}/`)) continue;
      const folder = p.path.slice(0, p.path.lastIndexOf("/"));
      const name = p.path.slice(p.path.lastIndexOf("/") + 1);
      const { data } = await db.storage
        .from(LEAD_PHOTO_BUCKET)
        .list(folder, { search: name, limit: 1 });
      if (data?.some((o) => o.name === name)) verified.push(p);
    }
    if (verified.length === 0) {
      throw new ActionFailure(actionError("validation", "Those files didn't finish uploading."));
    }
    const rows = check(
      await supabase
        .from("lead_attachments")
        .insert(
          verified.map((p) => ({
            org_id: viewer.orgId,
            lead_id,
            storage_path: p.path,
            file_name: p.file_name,
            content_type: p.content_type,
            size_bytes: p.size_bytes,
            source: "staff",
          })),
        )
        .select("id"),
    );
    try {
      await rescoreLead(supabase, lead_id);
    } catch (e) {
      logError("action:leads.attach_photos.rescore", e);
    }
    return { attached: rows?.length ?? 0, skipped: photos.length - verified.length };
  },
});
