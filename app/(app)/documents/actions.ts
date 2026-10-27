"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import {
  DOCUMENT_CATEGORIES,
  safeFileName,
  uploadProblem,
  type DocumentCategory,
} from "@/lib/domain/documents";
import { DOCUMENTS_BUCKET } from "@/lib/estimating/documents";
import { logError } from "@/lib/log";
import { reverifyJob } from "@/lib/onboarding/checks";
import { logActivity } from "@/lib/jobs/activity";

/**
 * Document mutations (SPEC §8.5 #7, §8.13). Uploads go straight from the
 * browser to the private bucket through a one-time signed upload URL; the row
 * is then inserted with the person's own client (row security: documents:manage
 * plus edit rights on the job or customer). Rename, recategorize, link and
 * delete (soft) also go through row security; the guard keeps signed files
 * and generated documents in place.
 */

const id = z.uuid();
const ONBOARDING_CATEGORIES = new Set<DocumentCategory>(["hoa", "lead_safe", "contract"]);

const target = z
  .object({ jobId: id.optional(), accountId: id.optional() })
  .refine((v) => Boolean(v.jobId) !== Boolean(v.accountId), {
    message: "Pick a job or a customer.",
  });

async function resolveTarget(ctx: ActionContext, t: { jobId?: string; accountId?: string }) {
  if (t.jobId) {
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, org_id, account_id")
        .eq("id", t.jobId)
        .maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    return {
      orgId: job.org_id,
      jobId: job.id,
      accountId: job.account_id,
      folder: `jobs/${job.id}`,
    };
  }
  const account = check(
    await ctx.supabase
      .from("accounts")
      .select("id, org_id")
      .eq("id", t.accountId as string)
      .maybeSingle(),
  );
  if (!account) throw new ActionFailure(actionError("not_found", "That customer isn't available."));
  return {
    orgId: account.org_id,
    jobId: null,
    accountId: account.id,
    folder: `accounts/${account.id}`,
  };
}

function paths(jobId: string | null, accountId: string | null) {
  revalidatePath("/documents");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}

const startSchema = z.intersection(
  target,
  z.object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().max(100),
    sizeBytes: z.number().int().nonnegative(),
  }),
);

/** Step 1: a one-time upload URL for the file (nothing is stored yet). */
export const startDocumentUpload = defineAction({
  name: "documents.upload.start",
  permissions: ["documents:manage"],
  schema: startSchema,
  handler: async (v, ctx) => {
    const problem = uploadProblem({ name: v.fileName, type: v.mimeType, size: v.sizeBytes });
    if (problem) throw new ActionFailure(actionError("validation", problem));
    const t = await resolveTarget(ctx, v);
    const path = `${t.orgId}/${t.folder}/${randomUUID()}-${safeFileName(v.fileName)}`;
    const service = await ctx.service();
    const { data, error } = await service.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("createSignedUploadUrl failed");
    return { bucket: DOCUMENTS_BUCKET, path, token: data.token };
  },
});

const finishSchema = z.intersection(
  target,
  z.object({
    path: z.string().max(400),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().max(100),
    title: z.string().trim().min(1, "Give it a title.").max(200),
    category: z.enum(DOCUMENT_CATEGORIES),
    notes: z.string().trim().max(1000).optional(),
    awaitingSignature: z.boolean().optional(),
  }),
);

/** Step 2: the file is in storage; record it (or remove it if the person may not). */
export const finishDocumentUpload = defineAction({
  name: "documents.upload.finish",
  permissions: ["documents:manage"],
  schema: finishSchema,
  handler: async (v, ctx) => {
    const t = await resolveTarget(ctx, v);
    const prefix = `${t.orgId}/${t.folder}/`;
    if (!v.path.startsWith(prefix) || v.path.includes("..")) {
      throw new ActionFailure(actionError("validation", "That upload doesn't belong here."));
    }
    const service = await ctx.service();
    const bucket = service.storage.from(DOCUMENTS_BUCKET);
    const folder = v.path.slice(0, v.path.lastIndexOf("/"));
    const name = v.path.slice(v.path.lastIndexOf("/") + 1);
    const { data: listed } = await bucket.list(folder, { search: name, limit: 5 });
    const object = listed?.find((o) => o.name === name);
    if (!object) {
      throw new ActionFailure(
        actionError("validation", "The file didn't finish uploading. Try again."),
      );
    }
    const meta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
    const size = typeof meta.size === "number" ? meta.size : 0;
    const mime = typeof meta.mimetype === "string" ? meta.mimetype : v.mimeType;
    const problem = uploadProblem({ name: v.fileName, type: mime, size });
    if (problem) {
      await bucket.remove([v.path]);
      throw new ActionFailure(actionError("validation", problem));
    }
    const { data: row, error } = await ctx.supabase
      .from("documents")
      .insert({
        org_id: t.orgId,
        job_id: t.jobId,
        account_id: t.accountId,
        category: v.category,
        title: v.title,
        file_name: v.fileName,
        storage_path: v.path,
        mime_type: mime,
        size_bytes: size,
        status: v.awaitingSignature ? "awaiting_signature" : "active",
        notes: v.notes || null,
      })
      .select("id")
      .single();
    if (error) {
      await bucket.remove([v.path]);
      throw new ActionFailure(mapDbError(error));
    }
    await logActivity(service, {
      orgId: t.orgId,
      subjectType: t.jobId ? "job" : "account",
      subjectId: t.jobId ?? t.accountId,
      type: "document_uploaded",
      summary: `Document uploaded: ${v.title}`,
      actorId: ctx.viewer.real.id,
      payload: { document_id: row.id, category: v.category },
    });
    if (t.jobId && ONBOARDING_CATEGORIES.has(v.category)) {
      await reverifyJob(service, t.jobId).catch((e: unknown) => logError("documents.reverify", e));
    }
    paths(t.jobId, t.accountId);
    return { id: row.id };
  },
});

const updateSchema = z.object({
  id,
  title: z.string().trim().min(1, "Give it a title.").max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  /** Move to another job of the same customer, or null to keep it on the customer only. */
  jobId: id.nullable().optional(),
  awaitingSignature: z.boolean().optional(),
});

export const updateDocument = defineAction({
  name: "documents.update",
  permissions: ["documents:manage"],
  schema: updateSchema,
  handler: async (v, { supabase, service }) => {
    const before = check(
      await supabase
        .from("documents")
        .select("id, job_id, account_id, status, category")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!before)
      throw new ActionFailure(actionError("not_found", "That document isn't available."));
    const patch: {
      title?: string;
      category?: DocumentCategory;
      job_id?: string | null;
      status?: "active" | "awaiting_signature";
    } = {};
    if (v.title !== undefined) patch.title = v.title;
    if (v.category !== undefined) patch.category = v.category;
    if (v.jobId !== undefined) patch.job_id = v.jobId;
    if (
      v.awaitingSignature !== undefined &&
      ["active", "awaiting_signature"].includes(before.status)
    ) {
      patch.status = v.awaitingSignature ? "awaiting_signature" : "active";
    }
    const { data, error } = await supabase
      .from("documents")
      .update(patch)
      .eq("id", v.id)
      .select("id, job_id");
    if (error) throw new ActionFailure(mapDbError(error));
    if (!data?.length) {
      throw new ActionFailure(actionError("forbidden", "You can't change that document."));
    }
    const svc = await service();
    for (const j of new Set([before.job_id, data[0]?.job_id].filter((x): x is string => !!x))) {
      await reverifyJob(svc, j).catch((e: unknown) => logError("documents.reverify", e));
      revalidatePath(`/jobs/${j}`);
    }
    paths(null, before.account_id);
    return { ok: true };
  },
});

const deleteSchema = z.object({
  id,
  reason: z.string().trim().min(3, "Say why (at least 3 characters).").max(500),
});

export const deleteDocument = defineAction({
  name: "documents.delete",
  permissions: ["documents:manage"],
  schema: deleteSchema,
  handler: async (v, { supabase, service, viewer }) => {
    const doc = check(
      await supabase
        .from("documents")
        .select("id, org_id, job_id, account_id, title")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!doc) throw new ActionFailure(actionError("not_found", "That document isn't available."));
    const { error } = await supabase.rpc("soft_delete_record", {
      p_table: "documents",
      p_id: v.id,
      p_reason: v.reason,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    const svc = await service();
    const subjectId = doc.job_id ?? doc.account_id;
    if (subjectId) {
      await logActivity(svc, {
        orgId: doc.org_id,
        subjectType: doc.job_id ? "job" : "account",
        subjectId,
        type: "document_deleted",
        summary: `Document deleted: ${doc.title} (${v.reason})`,
        actorId: viewer.real.id,
      });
    }
    if (doc.job_id) {
      await reverifyJob(svc, doc.job_id).catch((e: unknown) => logError("documents.reverify", e));
    }
    paths(doc.job_id, doc.account_id);
    return { ok: true };
  },
});
