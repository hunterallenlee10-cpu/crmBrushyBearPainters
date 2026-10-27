"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import type { Conflict } from "@/lib/domain/scheduling/conflicts";
import { isWorkRuleKey } from "@/lib/domain/scheduling/rules";
import { productionWorkType } from "@/lib/domain/scheduling/skills";
import { logError } from "@/lib/log";
import { logActivity } from "@/lib/jobs/activity";
import { reverifyJob } from "@/lib/onboarding/checks";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { advanceProduction, startJob as startJobFlow } from "@/lib/production/automation";
import { conflictsFor } from "@/lib/production/board";
import { publishSchedule, PublishBlocked } from "@/lib/production/publish";
import { markRainDelay as markRainDelayFlow } from "@/lib/production/rain";
import {
  approveRecommendation as approveFlow,
  generateRecommendations,
  undoRecommendation as undoFlow,
} from "@/lib/production/recommendations";
import { draftEntrySchema, rainDelaySchema } from "@/lib/validation/production";

/**
 * Production Center mutations (SPEC §8.6). Thin: validate, check permission,
 * write with the person's own session where row security can decide, and use
 * lib/production for the flows (Publish, Start job, rain delays,
 * recommendations). Audit rows and events come from the database triggers.
 */

const id = z.uuid();

function refresh(jobIds: readonly (string | null | undefined)[] = []) {
  revalidatePath("/schedule", "layout");
  for (const j of jobIds) if (j) revalidatePath(`/jobs/${j}`);
}

async function jobOrg(ctx: ActionContext, jobId: string) {
  const job = check(
    await ctx.supabase
      .from("jobs")
      .select("id, org_id, work_types, stage")
      .eq("id", jobId)
      .maybeSingle(),
  );
  if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
  return job;
}

export type DraftResult = { entryId: string; conflicts: Conflict[] };

/** Create or move a draft bar (drag from the tray, drag/resize a bar, or the Schedule dialog). */
export const saveDraftEntry = defineAction({
  name: "schedule.draft",
  schema: draftEntrySchema,
  permissions: ["schedule:manage"],
  handler: async (v, ctx): Promise<DraftResult> => {
    const job = await jobOrg(ctx, v.jobId);
    const service = await ctx.service();
    let entryId = v.entryId ?? null;
    let workType = v.workType ?? productionWorkType(job.work_types);
    let publishedStart: string | null = null;
    let allowSplit = v.allowSplit ?? false;
    let overrideRules: string[] = [];
    if (entryId) {
      const existing = check(
        await ctx.supabase
          .from("schedule_entries")
          .select("id, job_id, status, starts_on, work_type, allow_split, override_rules")
          .eq("id", entryId)
          .maybeSingle(),
      );
      if (!existing || existing.job_id !== v.jobId) {
        throw new ActionFailure(actionError("not_found", "That schedule entry isn't available."));
      }
      if (existing.status === "canceled") {
        throw new ActionFailure(actionError("validation", "That entry was canceled."));
      }
      workType = v.workType ?? existing.work_type;
      publishedStart = existing.starts_on;
      allowSplit = v.allowSplit ?? existing.allow_split;
      overrideRules = existing.override_rules;
      check(
        await ctx.supabase
          .from("schedule_entries")
          .update({
            draft_action: existing.status === "draft" ? "create" : "update",
            draft_crew_id: v.crewId,
            draft_starts_on: v.startsOn,
            draft_ends_on: v.endsOn,
            draft_reason: v.reason ?? "company",
            draft_note: v.note || null,
            allow_split: allowSplit,
            work_type: workType as "interior_production",
          })
          .eq("id", entryId)
          .select("id"),
      );
    } else {
      const created = check(
        await ctx.supabase
          .from("schedule_entries")
          .insert({
            org_id: job.org_id,
            job_id: v.jobId,
            work_order_id: v.workOrderId ?? null,
            work_type: workType as "interior_production",
            draft_action: "create",
            draft_crew_id: v.crewId,
            draft_starts_on: v.startsOn,
            draft_ends_on: v.endsOn,
            draft_reason: v.reason ?? "company",
            draft_note: v.note || null,
            allow_split: allowSplit,
          })
          .select("id")
          .single(),
      );
      if (!created) throw new ActionFailure(actionError("server", "The draft wasn't saved."));
      entryId = created.id;
    }
    const conflicts = await conflictsFor(service, {
      orgId: job.org_id,
      entryId,
      jobId: v.jobId,
      crewId: v.crewId,
      workType,
      startsOn: v.startsOn,
      endsOn: v.endsOn,
      allowSplit,
      overrideRules,
      publishedStart,
    });
    // A crew picked on the schedule counts for the onboarding crew check.
    await reverifyJob(service, v.jobId, { advance: false }).catch((e: unknown) =>
      logError("schedule.draft.reverify", e),
    );
    refresh([v.jobId]);
    return { entryId, conflicts };
  },
});

/** Drop a pending change: a never-published draft is removed; a published bar goes back to what was published. */
export const discardDraft = defineAction({
  name: "schedule.discard",
  schema: z.object({ entryId: id }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    const e = check(
      await ctx.supabase
        .from("schedule_entries")
        .select("id, job_id, status")
        .eq("id", v.entryId)
        .maybeSingle(),
    );
    if (!e)
      throw new ActionFailure(actionError("not_found", "That schedule entry isn't available."));
    if (e.status === "draft") {
      const service = await ctx.service();
      const { error } = await service
        .from("schedule_entries")
        .update({ status: "canceled", draft_action: null })
        .eq("id", e.id);
      if (error) throw new ActionFailure(mapDbError(error));
    } else {
      check(
        await ctx.supabase
          .from("schedule_entries")
          .update({ draft_action: null })
          .eq("id", e.id)
          .select("id"),
      );
    }
    refresh([e.job_id]);
    return { ok: true };
  },
});

/** Take a published bar off the schedule (a draft until published). */
export const cancelEntry = defineAction({
  name: "schedule.cancel",
  schema: z.object({ entryId: id, note: z.string().trim().max(500).optional() }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    const e = check(
      await ctx.supabase
        .from("schedule_entries")
        .select("id, job_id, status")
        .eq("id", v.entryId)
        .maybeSingle(),
    );
    if (!e || e.status !== "published") {
      throw new ActionFailure(
        actionError(
          "validation",
          "Only published dates can be taken off; discard a draft instead.",
        ),
      );
    }
    check(
      await ctx.supabase
        .from("schedule_entries")
        .update({ draft_action: "cancel", draft_note: v.note || null })
        .eq("id", e.id)
        .select("id"),
    );
    refresh([e.job_id]);
    return { ok: true };
  },
});

/** Owner override of a work rule on one entry (e.g. exterior out of season), with a reason. */
export const overrideRules = defineAction({
  name: "schedule.override",
  schema: z.object({
    entryId: id,
    rules: z.array(z.string()).max(11),
    reason: z.string().trim().min(10, "Say why (at least 10 characters).").max(500),
  }),
  permissions: ["schedule:manage", "job_admin:override"],
  handler: async (v, ctx) => {
    const rules = v.rules.filter(isWorkRuleKey);
    const rows = check(
      await ctx.supabase
        .from("schedule_entries")
        .update({ override_rules: rules, override_reason: rules.length ? v.reason : null })
        .eq("id", v.entryId)
        .select("id, job_id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That schedule entry isn't available."));
    refresh([rows[0]?.job_id]);
    return { ok: true };
  },
});

/** "Publish changes": blocked changes come back with their reasons and nothing is published. */
export const publishChanges = defineAction({
  name: "schedule.publish",
  schema: z.object({ entryIds: z.array(id).max(500).optional() }),
  permissions: ["schedule:publish"],
  handler: async (v, ctx) => {
    const service = await ctx.service();
    try {
      const r = await publishSchedule(service, {
        orgId: ctx.viewer.orgId,
        actorId: ctx.viewer.id,
        entryIds: v.entryIds ?? null,
      });
      refresh();
      revalidatePath("/jobs", "layout");
      return r;
    } catch (e) {
      if (e instanceof PublishBlocked) throw e;
      throw e;
    }
  },
});

/** Assign (or clear) the job's crew. */
export const assignCrew = defineAction({
  name: "schedule.assign_crew",
  schema: z.object({ jobId: id, crewId: id.nullable() }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    const job = await jobOrg(ctx, v.jobId);
    let crewName = "no crew";
    if (v.crewId) {
      const crew = check(
        await ctx.supabase.from("crews").select("id, name").eq("id", v.crewId).maybeSingle(),
      );
      if (!crew) throw new ActionFailure(actionError("not_found", "That crew isn't available."));
      crewName = crew.name;
    }
    check(
      await ctx.supabase.from("jobs").update({ crew_id: v.crewId }).eq("id", v.jobId).select("id"),
    );
    const service = await ctx.service();
    await logActivity(service, {
      orgId: job.org_id,
      subjectType: "job",
      subjectId: v.jobId,
      type: "crew_assigned",
      summary: v.crewId ? `Crew assigned: ${crewName}` : "Crew removed",
      actorId: ctx.viewer.real.id,
    });
    await reverifyJob(service, v.jobId).catch((e: unknown) =>
      logError("schedule.crew.reverify", e),
    );
    await recomputeJobHealth(service, [v.jobId]).catch(() => undefined);
    refresh([v.jobId]);
    return { ok: true };
  },
});

/** Rain-day promise: mark a rain delay (PM or scheduler). */
export const markRainDelay = defineAction({
  name: "schedule.rain_delay",
  schema: rainDelaySchema,
  permissions: [],
  handler: async (v, ctx) => {
    if (!ctx.viewer.can("schedule:manage") && !ctx.viewer.can("daily_logs:create")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't mark rain delays."));
    }
    const job = await jobOrg(ctx, v.jobId);
    const r = await markRainDelayFlow(
      { supabase: ctx.supabase, service: await ctx.service() },
      {
        orgId: job.org_id,
        jobId: v.jobId,
        date: v.date,
        note: v.note,
        notifyCustomer: v.notifyCustomer,
        actorId: ctx.viewer.id,
      },
    );
    refresh([v.jobId]);
    return r;
  },
});

/** "Start job" (crew lead or office): records the actual start and moves Scheduled → In Progress when ready. */
export const startJob = defineAction({
  name: "schedule.start_job",
  schema: z.object({ jobId: id }),
  permissions: [],
  handler: async (v, ctx) => {
    if (!ctx.viewer.can("daily_logs:create") && !ctx.viewer.can("schedule:manage")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't start jobs."));
    }
    await jobOrg(ctx, v.jobId);
    const r = await startJobFlow(await ctx.service(), v.jobId, {
      actorId: ctx.viewer.id,
      source: "start_button",
    });
    refresh([v.jobId]);
    return r;
  },
});

export const approveRecommendation = defineAction({
  name: "schedule.recommendation.approve",
  schema: z.object({ id }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    const r = await approveFlow(
      { supabase: ctx.supabase, service: await ctx.service() },
      { id: v.id, actorId: ctx.viewer.id, orgId: ctx.viewer.orgId },
    );
    refresh();
    return r;
  },
});

export const rejectRecommendation = defineAction({
  name: "schedule.recommendation.reject",
  schema: z.object({ id }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("schedule_recommendations")
        .update({ status: "rejected" })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That recommendation isn't available."));
    refresh();
    return { ok: true };
  },
});

export const undoRecommendation = defineAction({
  name: "schedule.recommendation.undo",
  schema: z.object({ id }),
  permissions: ["schedule:manage"],
  handler: async (v, ctx) => {
    await undoFlow(
      { supabase: ctx.supabase, service: await ctx.service() },
      { id: v.id, actorId: ctx.viewer.id, orgId: ctx.viewer.orgId },
    );
    refresh();
    return { ok: true };
  },
});

export const refreshRecommendations = defineAction({
  name: "schedule.recommendation.refresh",
  schema: z.object({}),
  permissions: ["schedule:manage"],
  handler: async (_v, ctx) => {
    const r = await generateRecommendations(await ctx.service(), ctx.viewer.orgId);
    refresh();
    return r;
  },
});

const PAINT_STATUSES = [
  "draft",
  "waiting_to_order",
  "ordered",
  "partially_received",
  "picked_up",
  "delivered",
  "canceled",
] as const;

/** Paint Orders queue: move an order along (and fill supplier, PO and dates). */
export const updatePaintOrder = defineAction({
  name: "schedule.paint_order.update",
  schema: z.object({
    id,
    status: z.enum(PAINT_STATUSES).optional(),
    supplier: z.string().trim().max(120).optional(),
    externalRef: z.string().trim().max(120).optional(),
    fulfillment: z.enum(["pickup", "delivery"]).nullable().optional(),
    expectedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  }),
  permissions: ["paint_orders:manage"],
  handler: async (v, ctx) => {
    const patch: Database["public"]["Tables"]["paint_orders"]["Update"] = {};
    if (v.status) patch.status = v.status;
    if (v.supplier !== undefined) patch.supplier = v.supplier || null;
    if (v.externalRef !== undefined) patch.external_ref = v.externalRef || null;
    if (v.fulfillment !== undefined) patch.fulfillment = v.fulfillment;
    if (v.expectedOn !== undefined) patch.expected_on = v.expectedOn;
    if (v.status === "picked_up" || v.status === "delivered")
      patch.received_at = new Date().toISOString();
    const rows = check(
      await ctx.supabase
        .from("paint_orders")
        .update(patch)
        .eq("id", v.id)
        .select("id, job_id, po_number"),
    );
    const row = rows?.[0];
    if (!row)
      throw new ActionFailure(actionError("not_found", "That paint order isn't available."));
    const service = await ctx.service();
    if (v.status) {
      await logActivity(service, {
        orgId: ctx.viewer.orgId,
        subjectType: "job",
        subjectId: row.job_id,
        type: "paint_order_status",
        summary: `Paint order ${row.po_number}: ${v.status.replace(/_/g, " ")}`,
        actorId: ctx.viewer.real.id,
      });
      await reverifyJob(service, row.job_id).catch((e: unknown) => logError("paint.reverify", e));
      await recomputeJobHealth(service, [row.job_id]).catch(() => undefined);
    }
    refresh([row.job_id]);
    return { ok: true };
  },
});

/** "Generate order from estimate": a fresh draft from the accepted estimate's paint list. */
export const generatePaintOrder = defineAction({
  name: "schedule.paint_order.generate",
  schema: z.object({ jobId: id }),
  permissions: ["paint_orders:manage"],
  handler: async (v, ctx) => {
    const job = await jobOrg(ctx, v.jobId);
    const service = await ctx.service();
    const { data: live } = await service
      .from("paint_orders")
      .select("id")
      .eq("job_id", v.jobId)
      .is("deleted_at", null)
      .neq("status", "canceled")
      .limit(1);
    if (live?.length) {
      throw new ActionFailure(
        actionError("conflict", "This job already has a paint order. Update that one."),
      );
    }
    const { data: jobRow } = await service
      .from("jobs")
      .select("accepted_estimate_id")
      .eq("id", v.jobId)
      .maybeSingle();
    const { data: est } = jobRow?.accepted_estimate_id
      ? await service
          .from("estimates")
          .select("accepted_version_id")
          .eq("id", jobRow.accepted_estimate_id)
          .maybeSingle()
      : { data: null };
    if (!est?.accepted_version_id) {
      throw new ActionFailure(
        actionError("validation", "This job has no accepted estimate to build a paint order from."),
      );
    }
    const { data: source } = await service
      .from("paint_orders")
      .select(
        "id, paint_order_lines(paint_product_id, label, color_name, color_code, sheen, is_primer, is_sundries, gallons_needed, gallons, containers, unit_cost_cents, cost_cents, sort_order)",
      )
      .eq("job_id", v.jobId)
      .eq("estimate_version_id", est.accepted_version_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const lines = source?.paint_order_lines ?? [];
    if (!lines.length) {
      throw new ActionFailure(
        actionError("validation", "The accepted estimate has no paint products on it."),
      );
    }
    const created = check(
      await ctx.supabase
        .from("paint_orders")
        .insert({
          org_id: job.org_id,
          job_id: v.jobId,
          po_number: "",
          status: "waiting_to_order",
          estimate_version_id: est.accepted_version_id,
        })
        .select("id, po_number")
        .single(),
    );
    if (!created) throw new ActionFailure(actionError("server", "The paint order wasn't created."));
    check(
      await ctx.supabase
        .from("paint_order_lines")
        .insert(lines.map((l) => ({ ...l, org_id: job.org_id, paint_order_id: created.id })))
        .select("id"),
    );
    refresh([v.jobId]);
    return { id: created.id, poNumber: created.po_number };
  },
});

const WO_STATUSES = [
  "new",
  "scheduled",
  "in_progress",
  "pending_approval",
  "completed",
  "canceled",
] as const;

/**
 * Work order status. Office (work_orders:manage) through row security; a crew
 * lead may move work orders on jobs they're on (assigned, or their crew's job).
 * Completing the last one moves the job to Final Walkthrough.
 */
export const updateWorkOrder = defineAction({
  name: "schedule.work_order.update",
  schema: z.object({
    id,
    status: z.enum(WO_STATUSES).optional(),
    crewId: id.nullable().optional(),
    actualHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  }),
  permissions: [],
  handler: async (v, ctx) => {
    const wo = check(
      await ctx.supabase
        .from("work_orders")
        .select("id, job_id, status, title, work_order_number")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!wo) throw new ActionFailure(actionError("not_found", "That work order isn't available."));
    const service = await ctx.service();
    const patch: { status?: string; crew_id?: string | null; actual_hours?: number | null } = {};
    if (v.status) patch.status = v.status;
    if (v.crewId !== undefined) patch.crew_id = v.crewId;
    if (v.actualHours !== undefined) patch.actual_hours = v.actualHours;
    if (ctx.viewer.can("work_orders:manage")) {
      check(await ctx.supabase.from("work_orders").update(patch).eq("id", v.id).select("id"));
    } else if (ctx.viewer.can("daily_logs:create") && v.crewId === undefined) {
      if (v.status && !["in_progress", "completed", "pending_approval"].includes(v.status)) {
        throw new ActionFailure(
          actionError("forbidden", "Crew leads can start, finish or flag work orders."),
        );
      }
      // The person can open the job (row security above); write as the trusted service.
      const { error } = await service.from("work_orders").update(patch).eq("id", v.id);
      if (error) throw new ActionFailure(mapDbError(error));
    } else {
      throw new ActionFailure(actionError("forbidden", "Your role can't change work orders."));
    }
    if (v.status && v.status !== wo.status) {
      await logActivity(service, {
        orgId: ctx.viewer.orgId,
        subjectType: "job",
        subjectId: wo.job_id,
        type: "work_order_status",
        summary: `Work order ${wo.work_order_number} ${v.status.replace(/_/g, " ")}: ${wo.title}`,
        actorId: ctx.viewer.real.id,
      });
      await advanceProduction(service, wo.job_id).catch((e: unknown) =>
        logError("work_order.advance", e),
      );
      await recomputeJobHealth(service, [wo.job_id]).catch(() => undefined);
    }
    refresh([wo.job_id]);
    return { ok: true };
  },
});
