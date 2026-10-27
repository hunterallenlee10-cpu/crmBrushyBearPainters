"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { isPayable, type PayableWhen } from "@/lib/domain/referrals";
import {
  addChampionSchema,
  championStatusSchema,
  ineligibleSchema,
  manualReferralSchema,
  payoutSchema,
  referralSettingsSchema,
  reviewLeftSchema,
} from "@/lib/validation/referrals";

/**
 * Bear Champions (SPEC §5.8, §8.16) and review requests. referrals:manage /
 * reviews:manage; row security and the database guards decide the rest
 * (codes are generated, a reward can't be paid twice), and the audit log and
 * change events come from triggers.
 */

function refresh() {
  revalidatePath("/referrals");
  revalidatePath("/admin/referrals");
}

export const addChampion = defineAction({
  name: "referrals.champion.add",
  schema: addChampionSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const { data, error } = await ctx.supabase
      .from("referral_champions")
      .insert({ org_id: ctx.viewer.orgId, contact_id: v.contactId, notes: v.notes })
      .select("id, code")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new ActionFailure(actionError("conflict", "They're already a Bear Champion."));
      }
      throw new ActionFailure(mapDbError(error));
    }
    refresh();
    return data;
  },
});

export const setChampionStatus = defineAction({
  name: "referrals.champion.status",
  schema: championStatusSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("referral_champions")
        .update({ status: v.status })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That champion isn't available."));
    refresh();
    return { status: v.status };
  },
});

export const addManualReferral = defineAction({
  name: "referrals.add",
  schema: manualReferralSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const { data: c } = await ctx.supabase
      .from("company_settings")
      .select("referral_reward_cents")
      .maybeSingle();
    const { error } = await ctx.supabase.from("referrals").insert({
      org_id: ctx.viewer.orgId,
      champion_id: v.championId,
      lead_id: v.leadId ?? null,
      job_id: v.jobId ?? null,
      referred_name: v.referredName,
      notes: v.notes,
      source: "manual",
      reward_cents: c?.referral_reward_cents ?? null,
    });
    if (error) {
      if (error.code === "23505") {
        throw new ActionFailure(
          actionError("conflict", "That lead or job already has a referral."),
        );
      }
      throw new ActionFailure(mapDbError(error));
    }
    refresh();
    return { ok: true };
  },
});

export const recordPayout = defineAction({
  name: "referrals.payout",
  schema: payoutSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const r = check(
      await ctx.supabase
        .from("referrals")
        .select(
          "id, paid_at, ineligible_reason, job:jobs(stage, estimate_accepted_at, paid_in_full_at)",
        )
        .eq("id", v.referralId)
        .maybeSingle(),
    );
    if (!r) throw new ActionFailure(actionError("not_found", "That referral isn't available."));
    if (r.paid_at) throw new ActionFailure(actionError("conflict", "This reward is already paid."));
    const { data: s } = await ctx.supabase
      .from("referral_settings")
      .select("payable_when")
      .maybeSingle();
    const when: PayableWhen = s?.payable_when === "sold" ? "sold" : "paid_in_full";
    const ok = isPayable(
      {
        ineligibleReason: r.ineligible_reason,
        paidAt: null,
        leadStatus: null,
        jobStage: r.job?.stage ?? null,
        estimateAcceptedAt: r.job?.estimate_accepted_at ?? null,
        paidInFullAt: r.job?.paid_in_full_at ?? null,
      },
      when,
    );
    if (!ok) {
      throw new ActionFailure(
        actionError(
          "validation",
          when === "sold"
            ? "The reward becomes payable once the referred job is sold."
            : "The reward becomes payable once the referred job is paid in full.",
        ),
      );
    }
    const rows = check(
      await ctx.supabase
        .from("referrals")
        .update({
          paid_at: new Date().toISOString(),
          payout_method: v.method,
          payout_reference: v.reference,
        })
        .eq("id", v.referralId)
        .is("paid_at", null)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("conflict", "This reward is already paid."));
    refresh();
    return { ok: true };
  },
});

export const markIneligible = defineAction({
  name: "referrals.ineligible",
  schema: ineligibleSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("referrals")
        .update({ ineligible_reason: v.reason })
        .eq("id", v.referralId)
        .is("paid_at", null)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("conflict", "Paid rewards can't be changed."));
    refresh();
    return { ok: true };
  },
});

export const saveReferralSettings = defineAction({
  name: "referrals.settings",
  schema: referralSettingsSchema,
  permissions: ["referrals:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("referral_settings")
        .update({
          payable_when: v.payableWhen,
          code_prefix: v.codePrefix,
          program_note: v.programNote,
          terms: v.terms,
        })
        .eq("org_id", ctx.viewer.orgId)
        .select("org_id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "Referral settings aren't set up."));
    refresh();
    return { ok: true };
  },
});

export const markReview = defineAction({
  name: "reviews.mark",
  schema: reviewLeftSchema,
  permissions: ["reviews:manage"],
  handler: async (v, ctx) => {
    const current = check(
      await ctx.supabase.from("review_requests").select("clicked_at").eq("id", v.id).maybeSingle(),
    );
    if (!current) {
      throw new ActionFailure(actionError("not_found", "That review request isn't available."));
    }
    const rows = check(
      await ctx.supabase
        .from("review_requests")
        .update({
          review_left: v.reviewLeft,
          review_left_at: v.reviewLeft ? new Date().toISOString() : null,
          status: v.reviewLeft ? "reviewed" : current.clicked_at ? "clicked" : "sent",
          rating: v.reviewLeft ? (v.rating ?? null) : null,
          ...(v.platform ? { platform: v.platform } : {}),
          notes: v.notes,
        })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That review request isn't available."));
    revalidatePath("/reviews");
    return { ok: true };
  },
});
