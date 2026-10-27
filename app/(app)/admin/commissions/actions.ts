"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { recalculateCommissions } from "@/lib/commissions/server";
import type { Database } from "@/lib/db/types";
import { pacificToday, ymdString } from "@/lib/domain/analytics/periods";
import {
  commissionAdjustmentActionSchema,
  commissionAdjustmentSchema,
  commissionEntryActionSchema,
  commissionPlanSchema,
  commissionSettingsSchema,
} from "@/lib/validation/commissions";

/**
 * Admin → Commissions (SPEC §10): off by default. commissions:manage; row
 * security checks again; paid entries are frozen by a database guard; audit
 * rows and commission_* events come from triggers.
 */
function done() {
  revalidatePath("/admin/commissions");
  revalidatePath("/my-numbers");
}

export const saveCommissionSettings = defineAction({
  name: "commissions.settings",
  schema: commissionSettingsSchema,
  permissions: ["commissions:manage"],
  handler: async (v, { supabase, viewer }) => {
    check(
      await supabase.from("commission_settings").upsert(
        {
          org_id: viewer.orgId,
          enabled: v.enabled,
          basis: v.basis,
          overhead_deduction_percent: v.overhead_deduction_percent,
          review_threshold_cents: v.review_threshold,
          self_generated_sources: v.self_generated_sources,
          require_cleared_funds: v.require_cleared_funds,
          notes: v.notes ?? null,
        },
        { onConflict: "org_id" },
      ),
    );
    done();
    return { enabled: v.enabled };
  },
});

export const saveCommissionPlan = defineAction({
  name: "commissions.plan",
  schema: commissionPlanSchema,
  permissions: ["commissions:manage"],
  handler: async (v, { supabase, viewer }) => {
    const row = {
      name: v.name,
      role_template_id: v.user_id ? null : v.role_template_id,
      user_id: v.user_id,
      company_rate_percent: v.company_rate_percent,
      self_rate_percent: v.self_rate_percent,
      overhead_deduction_percent: v.overhead_deduction_percent,
      active: v.active,
    };
    if (v.id) check(await supabase.from("commission_plans").update(row).eq("id", v.id));
    else check(await supabase.from("commission_plans").insert({ ...row, org_id: viewer.orgId }));
    done();
    return { saved: true };
  },
});

export const deleteCommissionPlan = defineAction({
  name: "commissions.plan_delete",
  schema: z.object({ id: z.uuid() }),
  permissions: ["commissions:manage"],
  handler: async ({ id }, { supabase, viewer }) => {
    check(
      await supabase
        .from("commission_plans")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: viewer.id,
          delete_reason: "Removed in Admin → Commissions",
          active: false,
        })
        .eq("id", id),
    );
    done();
    return { id };
  },
});

export const recalculate = defineAction({
  name: "commissions.recalculate",
  schema: z.object({}),
  permissions: ["commissions:manage"],
  handler: async (_v, { supabase, viewer }) => {
    const counts = await recalculateCommissions(supabase, viewer.orgId);
    done();
    return counts;
  },
});

export const updateCommissionEntry = defineAction({
  name: "commissions.entry",
  schema: commissionEntryActionSchema,
  permissions: ["commissions:manage"],
  handler: async ({ id, action, paid_on, payroll_ref, note }, { supabase, viewer }) => {
    const { data: entry } = await supabase
      .from("commission_entries")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (!entry)
      throw new ActionFailure(actionError("not_found", "That commission no longer exists."));
    const now = new Date().toISOString();
    let patch: Database["public"]["Tables"]["commission_entries"]["Update"] = {};
    if (action === "approve") {
      if (!["eligible", "needs_review"].includes(entry.status))
        throw new ActionFailure(
          actionError(
            "validation",
            "Only an eligible commission (or one waiting for review) can be approved.",
          ),
        );
      patch = { status: "approved", approved_at: now, approved_by: viewer.id };
    } else if (action === "pay") {
      if (entry.status !== "approved")
        throw new ActionFailure(actionError("validation", "Approve it before marking it paid."));
      patch = {
        status: "paid",
        paid_on: paid_on ?? ymdString(pacificToday()),
        payroll_ref: payroll_ref ?? null,
      };
    } else if (action === "void") {
      if (entry.status === "paid")
        throw new ActionFailure(
          actionError("validation", "A paid commission can't be voided. Add a clawback instead."),
        );
      patch = { status: "void" };
    } else {
      if (entry.status !== "void" && entry.status !== "approved")
        throw new ActionFailure(
          actionError("validation", "Only a void or approved commission can be reopened."),
        );
      patch = { status: "pending", approved_at: null, approved_by: null };
    }
    if (note) patch.note = note;
    check(await supabase.from("commission_entries").update(patch).eq("id", id));
    done();
    return { id, action };
  },
});

export const addCommissionAdjustment = defineAction({
  name: "commissions.adjustment",
  schema: commissionAdjustmentSchema,
  permissions: ["commissions:manage"],
  handler: async (v, { supabase, viewer }) => {
    check(
      await supabase.from("commission_adjustments").insert({
        org_id: viewer.orgId,
        user_id: v.user_id,
        job_id: v.job_id,
        kind: v.kind,
        amount_cents: v.amount,
        reason: v.reason,
      }),
    );
    done();
    return { saved: true };
  },
});

export const updateCommissionAdjustment = defineAction({
  name: "commissions.adjustment_status",
  schema: commissionAdjustmentActionSchema,
  permissions: ["commissions:manage"],
  handler: async ({ id, action, paid_on }, { supabase, viewer }) => {
    const patch =
      action === "approve"
        ? { status: "approved", approved_at: new Date().toISOString(), approved_by: viewer.id }
        : action === "pay"
          ? { status: "paid", paid_on: paid_on ?? ymdString(pacificToday()) }
          : { status: "void" };
    check(await supabase.from("commission_adjustments").update(patch).eq("id", id));
    done();
    return { id, action };
  },
});
