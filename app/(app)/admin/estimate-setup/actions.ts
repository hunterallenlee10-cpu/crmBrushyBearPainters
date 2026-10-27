"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { parseDiscountLimits, parseInclusions } from "@/lib/estimating/engine";
import {
  estimateSetupSchema,
  guaranteesSchema,
  inclusionsSchema,
} from "@/lib/validation/estimates";

/**
 * Admin → Estimate Setup (SPEC §8.19): the pricing knobs, discount limits,
 * tax treatment, "What's included" lists and guarantees. Saving the pricing
 * marks it calibrated (no longer sample) in the database. Owners only
 * (settings:manage); audit rows come from the triggers.
 */

const refresh = () => {
  revalidatePath("/admin/estimate-setup");
  revalidatePath("/price-book", "layout");
};

async function settingsRow(ctx: ActionContext) {
  const row = check(
    await ctx.supabase
      .from("estimate_settings")
      .select("id, discount_limits, whats_included")
      .eq("org_id", ctx.viewer.orgId)
      .maybeSingle(),
  );
  if (!row) throw new ActionFailure(actionError("not_found", "Estimate Setup isn't set up yet."));
  return row;
}

export const saveEstimateSetup = defineAction({
  name: "estimate_setup.save",
  permissions: ["settings:manage"],
  schema: estimateSetupSchema,
  handler: async ({ pricing, discount_limits, tax }, ctx) => {
    const row = await settingsRow(ctx);
    const current = parseDiscountLimits(row.discount_limits);
    const rows = check(
      await ctx.supabase
        .from("estimate_settings")
        .update({
          pricing,
          discount_limits: { roles: discount_limits.roles, users: current.users },
        })
        .eq("id", row.id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    checkOne(
      await ctx.supabase
        .from("company_settings")
        .update({ tax_config: tax })
        .eq("org_id", ctx.viewer.orgId)
        .select("id")
        .single(),
    );
    refresh();
    return { saved: true };
  },
});

export const saveInclusions = defineAction({
  name: "estimate_setup.save_inclusions",
  permissions: ["settings:manage"],
  schema: inclusionsSchema,
  handler: async ({ work_type, items, approved }, ctx) => {
    const row = await settingsRow(ctx);
    const all = parseInclusions(row.whats_included);
    const prev = all[work_type];
    const next = {
      ...(row.whats_included &&
      typeof row.whats_included === "object" &&
      !Array.isArray(row.whats_included)
        ? row.whats_included
        : {}),
      [work_type]: {
        items,
        status: approved ? "approved" : "draft",
        source:
          prev.source === "website" && JSON.stringify(prev.items) === JSON.stringify(items)
            ? "website"
            : "owner",
      },
    };
    check(
      await ctx.supabase
        .from("estimate_settings")
        .update({ whats_included: next })
        .eq("id", row.id)
        .select("id"),
    );
    refresh();
    return { saved: true };
  },
});

export const saveGuarantees = defineAction({
  name: "estimate_setup.save_guarantees",
  permissions: ["settings:manage"],
  schema: guaranteesSchema,
  handler: async ({ guarantees, approved, lead_safe_disclosure }, ctx) => {
    const row = await settingsRow(ctx);
    check(
      await ctx.supabase
        .from("estimate_settings")
        .update({
          guarantees,
          guarantees_status: approved ? "approved" : "draft",
          ...(lead_safe_disclosure !== undefined ? { lead_safe_disclosure } : {}),
        })
        .eq("id", row.id)
        .select("id"),
    );
    refresh();
    return { saved: true };
  },
});
