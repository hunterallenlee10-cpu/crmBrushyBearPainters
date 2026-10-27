"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import type { Json } from "@/lib/db/types";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { resolveAudience } from "@/lib/campaigns/audience";
import { sendTest } from "@/lib/campaigns/worker";
import { campaignChecks, canSend, planRecipients } from "@/lib/domain/campaigns";
import { PACIFIC } from "@/lib/domain/workflows/compliance";
import { loadCompanyMerge, loadMessagingSettings } from "@/lib/messaging/core";
import {
  campaignIdSchema,
  campaignStatusSchema,
  cancelEnrollmentSchema,
  previewAudienceSchema,
  saveCampaignSchema,
  saveDripSchema,
  scheduleCampaignSchema,
} from "@/lib/validation/campaigns";
import type { z } from "zod";

/**
 * Campaigns & drips (SPEC §8.11). campaigns:manage. A campaign is edited
 * while it's a draft; scheduling re-runs the compliance checks on the server;
 * the worker does the sending (outbox only, simulated). The campaigns guard
 * enforces the status rules, audit and change events come from triggers.
 */

const NOT_FOUND = new ActionFailure(actionError("not_found", "That campaign isn't available."));

function refresh(id?: string) {
  revalidatePath("/campaigns");
  if (id) revalidatePath(`/campaigns/${id}`);
}

type Preview = z.output<typeof previewAudienceSchema>;

async function evaluate(ctx: ActionContext, v: Preview) {
  const [{ members, capped }, service] = await Promise.all([
    resolveAudience(ctx.supabase, v.audience),
    ctx.service(),
  ]);
  const planned = planRecipients(members, v.channel);
  const reachable = planned.filter((p) => !p.excluded);
  const [settings, company, template] = await Promise.all([
    loadMessagingSettings(service, ctx.viewer.orgId),
    loadCompanyMerge(service, ctx.viewer.orgId),
    v.templateId
      ? ctx.supabase.from("message_templates").select("status").eq("id", v.templateId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const first = reachable[0];
  const checks = campaignChecks({
    channel: v.channel,
    subject: v.subject ?? null,
    body: v.body,
    audienceCount: planned.length,
    reachableCount: reachable.length,
    scheduledAt: v.scheduledAt ? new Date(v.scheduledAt) : null,
    quietHours: settings.engine.quietHours,
    templateStatus: template.data
      ? template.data.status === "approved"
        ? "approved"
        : "draft"
      : null,
    sample: {
      company,
      contact: { first_name: first?.firstName ?? "Sam", full_name: first?.name ?? "Sam Sample" },
      unsubscribe: { link: "(unsubscribe link)" },
    },
  });
  const reasons = new Map<string, number>();
  for (const p of planned)
    if (p.excluded) reasons.set(p.excluded, (reasons.get(p.excluded) ?? 0) + 1);
  return {
    total: planned.length,
    reachable: reachable.length,
    capped,
    sample: reachable.slice(0, 8).map((p) => ({ name: p.name, address: p.address })),
    excluded: [...reasons.entries()].map(([reason, count]) => ({ reason, count })),
    checks,
  };
}

export const previewCampaign = defineAction({
  name: "campaigns.preview",
  schema: previewAudienceSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => evaluate(ctx, v),
});

export const saveCampaign = defineAction({
  name: "campaigns.save",
  schema: saveCampaignSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const values = {
      name: v.name,
      channel: v.channel,
      audience: v.audience as unknown as NonNullable<Json>,
      template_id: v.templateId ?? null,
      subject: v.channel === "email" ? (v.subject ?? null) : null,
      body: v.body,
    };
    if (v.id) {
      const rows = check(
        await ctx.supabase.from("campaigns").update(values).eq("id", v.id).select("id"),
      );
      if (!rows?.length) throw NOT_FOUND;
      refresh(v.id);
      return { id: v.id };
    }
    const { data, error } = await ctx.supabase
      .from("campaigns")
      .insert({ ...values, org_id: ctx.viewer.orgId })
      .select("id")
      .single();
    if (error) throw new ActionFailure(mapDbError(error));
    refresh(data.id);
    return { id: data.id };
  },
});

export const scheduleCampaign = defineAction({
  name: "campaigns.schedule",
  schema: scheduleCampaignSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const c = check(
      await ctx.supabase
        .from("campaigns")
        .select("id, status, channel, audience, template_id, subject, body")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!c) throw NOT_FOUND;
    const at = v.when === "now" ? new Date() : fromZonedTime(`${v.when}:00`, PACIFIC);
    if (v.when !== "now" && at.getTime() < Date.now() - 60_000) {
      throw new ActionFailure(
        actionError("validation", "Pick a time that hasn't passed.", {
          when: ["Pick a time that hasn't passed."],
        }),
      );
    }
    const audience = previewAudienceSchema.shape.audience.safeParse(c.audience);
    if (!audience.success) {
      throw new ActionFailure(actionError("validation", "Fix the audience rules first."));
    }
    const result = await evaluate(ctx, {
      channel: c.channel === "email" ? "email" : "sms",
      audience: audience.data,
      subject: c.subject ?? undefined,
      body: c.body ?? "",
      templateId: c.template_id,
      scheduledAt: at.toISOString(),
    });
    if (!canSend(result.checks)) {
      throw new ActionFailure(
        actionError(
          "validation",
          result.checks.find((x) => x.level === "error")?.message ?? "Fix the checks first.",
        ),
      );
    }
    const rows = check(
      await ctx.supabase
        .from("campaigns")
        .update({ status: "scheduled", scheduled_at: at.toISOString() })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length) throw NOT_FOUND;
    refresh(v.id);
    return { scheduledAt: at.toISOString(), reachable: result.reachable };
  },
});

export const setCampaignStatus = defineAction({
  name: "campaigns.status",
  schema: campaignStatusSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const c = check(
      await ctx.supabase
        .from("campaigns")
        .select("id, status, started_at")
        .eq("id", v.id)
        .maybeSingle(),
    );
    if (!c) throw NOT_FOUND;
    // Resuming a paused campaign that already started goes straight back to sending.
    const patch =
      v.status === "scheduled"
        ? { status: "scheduled" as const, scheduled_at: new Date().toISOString() }
        : v.status === "canceled"
          ? { status: "canceled" as const, canceled_reason: v.reason }
          : { status: v.status };
    const { error } = await ctx.supabase.from("campaigns").update(patch).eq("id", v.id);
    if (error) throw new ActionFailure(mapDbError(error));
    refresh(v.id);
    return { status: v.status };
  },
});

export const sendCampaignTest = defineAction({
  name: "campaigns.test",
  schema: campaignIdSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const visible = check(
      await ctx.supabase.from("campaigns").select("id").eq("id", v.id).maybeSingle(),
    );
    if (!visible) throw NOT_FOUND;
    const service = await ctx.service();
    const [{ data: c }, { data: me }] = await Promise.all([
      service.from("campaigns").select("*").eq("id", v.id).single(),
      service
        .from("profiles")
        .select("email, phone, full_name")
        .eq("id", ctx.viewer.id)
        .maybeSingle(),
    ]);
    if (!c) throw NOT_FOUND;
    const phone = me?.phone && /^\+[1-9]\d{7,14}$/.test(me.phone) ? me.phone : null;
    const r = await sendTest(service, c, {
      email: me?.email ?? null,
      phone,
      firstName: (me?.full_name ?? ctx.viewer.name).split(/\s+/)[0] ?? "",
      actorId: ctx.viewer.id,
    });
    if ("error" in r) throw new ActionFailure(actionError("validation", r.error));
    refresh(v.id);
    return r;
  },
});

// --- Drips ------------------------------------------------------------------------------

export const saveDrip = defineAction({
  name: "drips.save",
  schema: saveDripSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("drips")
        .update({
          name: v.name,
          description: v.description,
          active: v.active,
          steps: v.steps as unknown as NonNullable<Json>,
          exit_conditions: v.exitConditions,
        })
        .eq("id", v.id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That drip isn't available."));
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/drips/${v.id}`);
    return { id: v.id };
  },
});

export const cancelEnrollment = defineAction({
  name: "drips.enrollment.cancel",
  schema: cancelEnrollmentSchema,
  permissions: ["campaigns:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("drip_enrollments")
        .update({ status: "canceled" })
        .eq("id", v.id)
        .eq("status", "active")
        .select("id, drip_id"),
    );
    const row = rows?.[0];
    if (!row) throw new ActionFailure(actionError("not_found", "That enrollment isn't active."));
    revalidatePath(`/campaigns/drips/${row.drip_id}`);
    return { ok: true };
  },
});
