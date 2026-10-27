"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { signoffStatement } from "@/lib/domain/scheduling/messages";
import { signatureHash } from "@/lib/estimating/tokens";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { advanceProduction } from "@/lib/production/automation";
import { punchItemSchema, punchUpdateSchema, signoffSchema } from "@/lib/validation/production";

/**
 * Job Detail production mutations (SPEC §8.5 #3 Schedule checklists and the
 * on-time credit decision, #13 Punch List and the customer's sign-off).
 * Row security decides who may write; audit rows, activity and events come
 * from the database triggers. Stage moves go through advanceProduction →
 * advanceIfGatePasses → advanceJobStage.
 */

const id = z.uuid();

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule", "layout");
}

async function jobFor(ctx: ActionContext, jobId: string) {
  const job = check(
    await ctx.supabase.from("jobs").select("id, org_id, stage").eq("id", jobId).maybeSingle(),
  );
  if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
  return job;
}

async function afterPunchChange(ctx: ActionContext, jobId: string) {
  const service = await ctx.service();
  await advanceProduction(service, jobId).catch((e: unknown) => logError("punch.advance", e));
  await recomputeJobHealth(service, [jobId]).catch(() => undefined);
  refresh(jobId);
}

export const addPunchItem = defineAction({
  name: "job.punch_item.add",
  schema: punchItemSchema,
  permissions: ["punch_list:manage"],
  handler: async (v, ctx) => {
    const job = await jobFor(ctx, v.jobId);
    const { data: last } = await ctx.supabase
      .from("punch_items")
      .select("sort_order")
      .eq("job_id", v.jobId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rows = check(
      await ctx.supabase
        .from("punch_items")
        .insert({
          org_id: job.org_id,
          job_id: v.jobId,
          area: v.area,
          description: v.description,
          photo_id: v.photoId ?? null,
          assigned_to: v.assignedTo ?? null,
          sort_order: (last?.sort_order ?? 0) + 1,
        })
        .select("id"),
    );
    refresh(v.jobId);
    return { id: rows?.[0]?.id ?? null };
  },
});

export const updatePunchItem = defineAction({
  name: "job.punch_item.update",
  schema: punchUpdateSchema,
  permissions: ["punch_list:manage"],
  handler: async (v, ctx) => {
    const item = check(
      await ctx.supabase.from("punch_items").select("id, job_id").eq("id", v.id).maybeSingle(),
    );
    if (!item)
      throw new ActionFailure(actionError("not_found", "That punch item isn't available."));
    const patch: {
      status?: string;
      waived_note?: string | null;
      fixed_photo_id?: string | null;
      area?: string;
      description?: string;
    } = {};
    if (v.status) patch.status = v.status;
    if (v.status === "customer_waived") patch.waived_note = v.waivedNote ?? null;
    if (v.fixedPhotoId !== undefined) patch.fixed_photo_id = v.fixedPhotoId;
    if (v.area) patch.area = v.area;
    if (v.description) patch.description = v.description;
    check(await ctx.supabase.from("punch_items").update(patch).eq("id", v.id).select("id"));
    await afterPunchChange(ctx, item.job_id);
    return { ok: true };
  },
});

export const deletePunchItem = defineAction({
  name: "job.punch_item.delete",
  schema: z.object({ id, reason: z.string().trim().max(500).optional() }),
  permissions: ["punch_list:manage"],
  handler: async (v, ctx) => {
    const item = check(
      await ctx.supabase.from("punch_items").select("id, job_id").eq("id", v.id).maybeSingle(),
    );
    if (!item)
      throw new ActionFailure(actionError("not_found", "That punch item isn't available."));
    // Soft delete; the row leaves the person's view, so no RETURNING.
    const { error } = await ctx.supabase
      .from("punch_items")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: ctx.viewer.id,
        delete_reason: v.reason || "Removed from the punch list",
      })
      .eq("id", v.id);
    if (error) throw new ActionFailure(mapDbError(error));
    await afterPunchChange(ctx, item.job_id);
    return { ok: true };
  },
});

/** The customer's final-walkthrough sign-off, captured on the crew's device. */
export const captureSignoff = defineAction({
  name: "job.punch.signoff",
  schema: signoffSchema,
  permissions: ["punch_list:manage"],
  handler: async (v, ctx) => {
    const job = await jobFor(ctx, v.jobId);
    if (!["in_progress", "final_walkthrough", "completed"].includes(job.stage)) {
      throw new ActionFailure(
        actionError(
          "conflict",
          "Capture the sign-off at the final walkthrough, once the work is done.",
        ),
      );
    }
    const { count } = await ctx.supabase
      .from("punch_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", v.jobId)
      .eq("status", "open");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const rows = check(
      await ctx.supabase
        .from("punch_signoffs")
        .insert({
          org_id: job.org_id,
          job_id: v.jobId,
          signer_name: v.signerName,
          signature_png: v.signaturePng,
          signature_sha256: signatureHash(v.signaturePng),
          statement: signoffStatement(count ?? 0),
          note: v.note || null,
          ip: ip ? ip.slice(0, 64) : null,
          user_agent: h.get("user-agent")?.slice(0, 400) ?? null,
        })
        .select("id"),
    );
    await afterPunchChange(ctx, v.jobId);
    return { id: rows?.[0]?.id ?? null, openItems: count ?? 0 };
  },
});

/** Owner decision on a drafted on-time credit (SPEC §1.3); Phase 7 applies approved ones to the invoice. */
export const decideOnTimeCredit = defineAction({
  name: "job.on_time_credit.decide",
  schema: z.object({
    id,
    decision: z.enum(["approved", "waived"]),
    note: z.string().trim().max(500).optional(),
  }),
  permissions: ["credits:approve"],
  handler: async (v, ctx) => {
    const credit = check(
      await ctx.supabase
        .from("on_time_credits")
        .select("id, job_id, status")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!credit) throw new ActionFailure(actionError("not_found", "That credit isn't available."));
    if (credit.status !== "pending_approval") {
      throw new ActionFailure(actionError("conflict", "That credit was already decided."));
    }
    check(
      await ctx.supabase
        .from("on_time_credits")
        .update({ status: v.decision, decision_note: v.note || null })
        .eq("id", v.id)
        .select("id"),
    );
    refresh(credit.job_id);
    return { ok: true };
  },
});

/** Add a checklist to the job from a template (Schedule Admin → Checklist templates). */
export const addChecklist = defineAction({
  name: "job.checklist.add",
  schema: z.object({ jobId: id, templateId: id, workOrderId: id.optional() }),
  permissions: [],
  handler: async (v, ctx) => {
    const job = await jobFor(ctx, v.jobId);
    const tpl = check(
      await ctx.supabase
        .from("checklist_templates")
        .select("id, key, name, items")
        .eq("id", v.templateId)
        .eq("active", true)
        .maybeSingle(),
    );
    if (!tpl)
      throw new ActionFailure(actionError("not_found", "That checklist template isn't available."));
    const items = z
      .array(z.object({ key: z.string(), label: z.string(), required: z.boolean().optional() }))
      .catch([])
      .parse(tpl.items);
    const inst = check(
      await ctx.supabase
        .from("checklist_instances")
        .insert({
          org_id: job.org_id,
          job_id: v.jobId,
          template_id: tpl.id,
          template_key: tpl.key,
          name: tpl.name,
          work_order_id: v.workOrderId ?? null,
        })
        .select("id"),
    )?.[0];
    if (!inst)
      throw new ActionFailure(actionError("forbidden", "Your role can't add checklists here."));
    if (items.length) {
      check(
        await ctx.supabase
          .from("checklist_items")
          .insert(
            items.map((it, i) => ({
              org_id: job.org_id,
              instance_id: inst.id,
              key: it.key,
              label: it.label,
              required: it.required ?? true,
              sort_order: i,
            })),
          )
          .select("id"),
      );
    }
    refresh(v.jobId);
    return { id: inst.id };
  },
});

export const toggleChecklistItem = defineAction({
  name: "job.checklist.toggle",
  schema: z.object({ id, done: z.boolean() }),
  permissions: [],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("checklist_items")
        .update({ done: v.done })
        .eq("id", v.id)
        .select("id, instance_id"),
    );
    if (!rows?.[0]) {
      throw new ActionFailure(actionError("forbidden", "Your role can't tick this checklist."));
    }
    const inst = check(
      await ctx.supabase
        .from("checklist_instances")
        .select("job_id")
        .eq("id", rows?.[0].instance_id)
        .maybeSingle(),
    );
    if (inst) refresh(inst.job_id);
    return { ok: true };
  },
});
