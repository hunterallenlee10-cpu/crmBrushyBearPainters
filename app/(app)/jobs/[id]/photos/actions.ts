"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import { PHOTO_CATEGORIES } from "@/lib/domain/photos";
import { logActivity } from "@/lib/jobs/activity";
import { sendJobMessage } from "@/lib/jobs/send";
import { logError } from "@/lib/log";

/**
 * Photo mutations (SPEC §8.5 #6). Tags change through the person's own client
 * (row security: the uploader or anyone who can edit the job); deletes are
 * soft, through soft_delete_record (photos:delete); sharing records a
 * simulated customer message and marks the photos customer-visible.
 */

const id = z.uuid();
const jobPath = (jobId: string) => `/jobs/${jobId}`;

const updateSchema = z.object({
  jobId: id,
  photoId: id,
  category: z.enum(PHOTO_CATEGORIES),
  area: z.string().trim().max(120).optional(),
  caption: z.string().trim().max(500).optional(),
});

export const updatePhoto = defineAction({
  name: "photos.update",
  permissions: ["photos:upload"],
  schema: updateSchema,
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("job_photos")
        .update({ category: v.category, area: v.area || null, caption: v.caption || null })
        .eq("id", v.photoId)
        .eq("job_id", v.jobId)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({
        code: "forbidden",
        message: "You can only change photos you took, or photos on jobs you can edit.",
      });
    }
    revalidatePath(jobPath(v.jobId));
    return { ok: true };
  },
});

const deleteSchema = z.object({
  jobId: id,
  photoIds: z.array(id).min(1).max(100),
  reason: z.string().trim().min(3, "Say why (at least 3 characters).").max(500),
});

export const deletePhotos = defineAction({
  name: "photos.delete",
  permissions: ["photos:delete"],
  schema: deleteSchema,
  handler: async (v, { supabase, service, viewer }) => {
    const visible = check(
      await supabase.from("job_photos").select("id").eq("job_id", v.jobId).in("id", v.photoIds),
    );
    let deleted = 0;
    const svc = await service();
    for (const p of visible ?? []) {
      const { error } = await supabase.rpc("soft_delete_record", {
        p_table: "job_photos",
        p_id: p.id,
        p_reason: v.reason,
      });
      if (error) throw new ActionFailure(mapDbError(error));
      deleted++;
    }
    if (deleted) {
      await logActivity(svc, {
        orgId: viewer.orgId,
        subjectType: "job",
        subjectId: v.jobId,
        type: "photo_deleted",
        summary: `Deleted ${deleted} photo${deleted === 1 ? "" : "s"}: ${v.reason}`,
        actorId: viewer.real.id,
      });
    }
    revalidatePath(jobPath(v.jobId));
    return { deleted };
  },
});

const shareSchema = z
  .object({
    jobId: id,
    photoIds: z.array(id).min(1).max(50),
    channel: z.enum(["sms", "email"]),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1, "Write a short message.").max(2000),
  })
  .refine((v) => v.channel === "sms" || (v.subject ?? "").length > 0, {
    message: "Add a subject.",
    path: ["subject"],
  });

export const sharePhotos = defineAction({
  name: "photos.share",
  permissions: ["photos:read", "messages:send"],
  schema: shareSchema,
  handler: async (v, ctx) => {
    const visible = check(
      await ctx.supabase.from("job_photos").select("id").eq("job_id", v.jobId).in("id", v.photoIds),
    );
    const ids = (visible ?? []).map((p) => p.id);
    if (!ids.length) {
      throw new ActionFailure({ code: "not_found", message: "Those photos aren't available." });
    }
    const sent = await sendJobMessage(ctx, v.jobId, {
      channel: v.channel,
      subject: v.subject,
      body: v.body,
      templateKey: "photo_share",
    });
    // Marking them customer-visible is bookkeeping after the person's own read check.
    const service = await ctx.service();
    const { error } = await service
      .from("job_photos")
      .update({ customer_visible: true, shared_at: new Date().toISOString() })
      .in("id", ids);
    if (error) logError("photos.share.mark", error);
    const { error: actErr } = await service.from("activity").insert({
      org_id: ctx.viewer.orgId,
      subject_type: "job",
      subject_id: v.jobId,
      type: "photo_shared",
      summary: `Shared ${ids.length} photo${ids.length === 1 ? "" : "s"} with the customer by ${v.channel === "sms" ? "text" : "email"} (simulated)`,
      payload: { photo_ids: ids, message_id: sent.messageId },
      actor_id: ctx.viewer.real.id,
    });
    if (actErr) logError("photos.share.activity", actErr);
    revalidatePath(jobPath(v.jobId));
    return { shared: ids.length, messageId: sent.messageId };
  },
});
