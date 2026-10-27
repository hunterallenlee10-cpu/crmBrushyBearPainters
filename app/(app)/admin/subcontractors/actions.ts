"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { safeFileName, uploadProblem } from "@/lib/domain/documents";
import { DOCUMENTS_BUCKET } from "@/lib/estimating/documents";
import { isoDate } from "@/lib/validation/production";

/**
 * Admin → Subcontractors (SPEC §5.4, §8.19, §13.4): roster and compliance.
 * Writes use the person's own session (row security: crews:manage). The
 * status (active / expiring) follows the paperwork in the database; people
 * only suspend (with a reason) or reinstate. Compliance files go to the
 * private documents bucket through a one-time signed upload URL.
 */

const PATH = "/admin/subcontractors";
const optDate = isoDate.nullable().optional();
const opt = (max: number) => z.string().trim().max(max).optional();

const subSchema = z.object({
  id: z.uuid().optional(),
  companyName: z.string().trim().min(1, "Name the company.").max(160),
  contactName: opt(120),
  phone: opt(40),
  email: z.union([z.literal(""), z.email("Use an email like name@example.com.")]).optional(),
  lniRegistration: opt(40),
  lniExpiresOn: optDate,
  coiCarrier: opt(120),
  coiExpiresOn: optDate,
  w9OnFile: z.boolean(),
  bondOnFile: z.boolean(),
  bondExpiresOn: optDate,
  rrpCertification: opt(60),
  rrpExpiresOn: optDate,
  notes: opt(2000),
});

export const saveSubcontractor = defineAction({
  name: "subcontractors.save",
  schema: subSchema,
  permissions: ["crews:manage"],
  handler: async (v, { supabase, viewer }) => {
    const row = {
      company_name: v.companyName,
      contact_name: v.contactName || null,
      phone: v.phone || null,
      email: v.email ? v.email.toLowerCase() : null,
      lni_registration: v.lniRegistration || null,
      lni_expires_on: v.lniExpiresOn ?? null,
      coi_carrier: v.coiCarrier || null,
      coi_expires_on: v.coiExpiresOn ?? null,
      w9_on_file: v.w9OnFile,
      bond_on_file: v.bondOnFile,
      bond_expires_on: v.bondExpiresOn ?? null,
      rrp_certification: v.rrpCertification || null,
      rrp_expires_on: v.rrpExpiresOn ?? null,
      notes: v.notes || null,
    };
    if (v.id) {
      const rows = check(
        await supabase.from("subcontractors").update(row).eq("id", v.id).select("id"),
      );
      if (!rows?.length)
        throw new ActionFailure(actionError("not_found", "That subcontractor isn't available."));
      revalidatePath(PATH);
      return { id: v.id };
    }
    const created = check(
      await supabase
        .from("subcontractors")
        .insert({ ...row, org_id: viewer.orgId })
        .select("id")
        .single(),
    );
    if (!created) throw new ActionFailure(actionError("server", "The subcontractor wasn't saved."));
    revalidatePath(PATH);
    return { id: created.id };
  },
});

export const setSubcontractorStatus = defineAction({
  name: "subcontractors.status",
  schema: z.object({
    id: z.uuid(),
    suspended: z.boolean(),
    reason: z.string().trim().max(500).optional(),
  }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase }) => {
    if (v.suspended && (v.reason ?? "").length < 3) {
      throw new ActionFailure(
        actionError("validation", "Say why (at least 3 characters).", {
          reason: ["Say why (at least 3 characters)."],
        }),
      );
    }
    const rows = check(
      await supabase
        .from("subcontractors")
        .update(
          v.suspended ? { status: "suspended", suspended_reason: v.reason } : { status: "active" },
        )
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That subcontractor isn't available."));
    revalidatePath(PATH);
    return { ok: true };
  },
});

const KINDS = ["coi", "lni", "w9", "bond", "rrp", "other"] as const;

export const startSubDocumentUpload = defineAction({
  name: "subcontractors.document.start",
  schema: z.object({
    subcontractorId: z.uuid(),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().max(100),
    sizeBytes: z.number().int().nonnegative(),
  }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase, service, viewer }) => {
    const problem = uploadProblem({ name: v.fileName, type: v.mimeType, size: v.sizeBytes });
    if (problem) throw new ActionFailure(actionError("validation", problem));
    const sub = check(
      await supabase.from("subcontractors").select("id").eq("id", v.subcontractorId).maybeSingle(),
    );
    if (!sub)
      throw new ActionFailure(actionError("not_found", "That subcontractor isn't available."));
    const path = `${viewer.orgId}/subcontractors/${sub.id}/${randomUUID()}-${safeFileName(v.fileName).toLowerCase()}`;
    const svc = await service();
    const { data, error } = await svc.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("createSignedUploadUrl failed");
    return { bucket: DOCUMENTS_BUCKET, path, token: data.token };
  },
});

export const finishSubDocumentUpload = defineAction({
  name: "subcontractors.document.finish",
  schema: z.object({
    subcontractorId: z.uuid(),
    path: z.string().max(400),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().max(100),
    kind: z.enum(KINDS),
    title: z.string().trim().min(1, "Give it a title.").max(200),
    expiresOn: isoDate.optional(),
  }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase, service, viewer }) => {
    const prefix = `${viewer.orgId}/subcontractors/${v.subcontractorId}/`;
    if (!v.path.startsWith(prefix) || v.path.includes("..")) {
      throw new ActionFailure(actionError("validation", "That upload doesn't belong here."));
    }
    const svc = await service();
    const bucket = svc.storage.from(DOCUMENTS_BUCKET);
    const name = v.path.slice(v.path.lastIndexOf("/") + 1);
    const { data: listed } = await bucket.list(v.path.slice(0, v.path.lastIndexOf("/")), {
      search: name,
      limit: 5,
    });
    const object = listed?.find((o) => o.name === name);
    if (!object)
      throw new ActionFailure(
        actionError("validation", "The file didn't finish uploading. Try again."),
      );
    const meta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
    const size = typeof meta.size === "number" ? meta.size : 0;
    const mime = typeof meta.mimetype === "string" ? meta.mimetype : v.mimeType;
    const problem = uploadProblem({ name: v.fileName, type: mime, size });
    if (problem) {
      await bucket.remove([v.path]);
      throw new ActionFailure(actionError("validation", problem));
    }
    const { data, error } = await supabase
      .from("subcontractor_documents")
      .insert({
        org_id: viewer.orgId,
        subcontractor_id: v.subcontractorId,
        kind: v.kind,
        title: v.title,
        file_name: v.fileName,
        storage_path: v.path,
        mime_type: mime,
        size_bytes: Math.max(1, size),
        expires_on: v.expiresOn ?? null,
      })
      .select("id")
      .single();
    if (error) {
      await bucket.remove([v.path]);
      throw new ActionFailure(mapDbError(error));
    }
    // Keep the roster's expiry in step with the newest certificate.
    if (v.expiresOn && v.kind !== "w9" && v.kind !== "other") {
      const patch =
        v.kind === "coi"
          ? { coi_expires_on: v.expiresOn }
          : v.kind === "lni"
            ? { lni_expires_on: v.expiresOn }
            : v.kind === "bond"
              ? { bond_expires_on: v.expiresOn, bond_on_file: true }
              : { rrp_expires_on: v.expiresOn };
      await supabase.from("subcontractors").update(patch).eq("id", v.subcontractorId);
    }
    if (v.kind === "w9")
      await supabase
        .from("subcontractors")
        .update({ w9_on_file: true })
        .eq("id", v.subcontractorId);
    revalidatePath(PATH);
    return { id: data.id };
  },
});
