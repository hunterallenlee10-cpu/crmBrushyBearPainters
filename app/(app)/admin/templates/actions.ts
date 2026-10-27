"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { renderSend } from "@/lib/domain/workflows/plan";
import { sampleContext, mergeContexts } from "@/lib/domain/templates/merge";
import { loadCompanyMerge, loadMessagingSettings } from "@/lib/messaging/core";
import {
  messagingSettingsSchema,
  previewTemplateSchema,
  saveTemplateSchema,
  templateIdSchema,
} from "@/lib/validation/communication";
import { loadRunContext } from "@/lib/workflows/context";
import { z } from "zod";

/**
 * Admin → Messaging & Templates (SPEC §11.3, §8.19). Templates are written
 * with the person's own session (row security: templates:manage); editing the
 * wording puts it back to "Draft – owner to approve" (database guard); only an
 * owner can approve (approve_template). Audit rows and events come from the
 * table's triggers.
 */

const pathFor = (id?: string) => (id ? `/admin/templates/${id}` : "/admin/templates");

export const saveTemplate = defineAction({
  name: "templates.save",
  schema: saveTemplateSchema,
  permissions: ["templates:manage"],
  handler: async (v, { supabase, viewer }) => {
    const fields = {
      name: v.name,
      description: v.description,
      category: v.category,
      message_type: v.messageType,
      subject: v.channel === "email" ? (v.subject?.trim() ?? null) : null,
      body: v.body,
      active: v.active,
    };
    if (v.id) {
      const rows = check(await supabase.from("message_templates").update(fields).eq("id", v.id).select("id"));
      if (!rows?.length) throw new ActionFailure(actionError("not_found", "That template isn't available."));
      revalidatePath(pathFor(v.id));
      revalidatePath("/admin/templates");
      return { id: v.id };
    }
    const { data, error } = await supabase
      .from("message_templates")
      .insert({ org_id: viewer.orgId, key: v.key as string, channel: v.channel, ...fields })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new ActionFailure(
          actionError("conflict", "There's already a template with that key for this channel.", {
            key: ["Pick another key."],
          }),
        );
      }
      throw new ActionFailure(mapDbError(error));
    }
    revalidatePath("/admin/templates");
    return { id: data.id };
  },
});

export const approveTemplate = defineAction({
  name: "templates.approve",
  schema: templateIdSchema,
  permissions: ["templates:manage"],
  handler: async (v, { supabase }) => {
    const { error } = await supabase.rpc("approve_template", { p_template: v.id });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath(pathFor(v.id));
    revalidatePath("/admin/templates");
    return { approved: true };
  },
});

export const setTemplateActive = defineAction({
  name: "templates.active",
  schema: templateIdSchema.extend({ active: z.boolean() }),
  permissions: ["templates:manage"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase.from("message_templates").update({ active: v.active }).eq("id", v.id).select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("not_found", "That template isn't available."));
    revalidatePath(pathFor(v.id));
    revalidatePath("/admin/templates");
    return { active: v.active };
  },
});

/** The message as it would go out: sample values, or a real job or lead (read with row security first). */
export const previewTemplate = defineAction({
  name: "templates.preview",
  schema: previewTemplateSchema,
  permissions: ["templates:manage"],
  handler: async (v, ctx) => {
    const service = await ctx.service();
    const [company, settings] = await Promise.all([
      loadCompanyMerge(service, ctx.viewer.orgId),
      loadMessagingSettings(service, ctx.viewer.orgId),
    ]);
    let merge = sampleContext({ company });
    if (v.jobId || v.leadId) {
      const table = v.jobId ? "jobs" : "leads";
      const id = (v.jobId ?? v.leadId) as string;
      const visible = check(await ctx.supabase.from(table).select("id").eq("id", id).maybeSingle());
      if (!visible) throw new ActionFailure(actionError("not_found", "That record isn't available."));
      const run = await loadRunContext(
        service,
        ctx.viewer.orgId,
        { type: v.jobId ? "job" : "lead", id },
        { type: "template.preview", payload: {} },
        { now: new Date(), customerThreadHours: settings.customerThreadHours, dryRun: true },
      );
      if (run) merge = mergeContexts(sampleContext({ company }), run.merge);
    }
    const r = renderSend(
      {
        channel: v.channel,
        recipient: null,
        template: {
          key: "preview",
          channel: v.channel,
          subject: v.subject ?? null,
          body: v.body,
          active: true,
          status: "draft",
          messageType: v.messageType,
        },
        messageType: v.messageType,
        blocked: null,
        deferUntil: null,
      },
      { ...merge, unsubscribe: { link: "https://crm.example/u/sample" } },
      settings.footer,
      { missingAs: "marker" },
    );
    return r;
  },
});

export const saveMessagingSettings = defineAction({
  name: "messaging_settings.save",
  schema: messagingSettingsSchema,
  permissions: ["templates:manage"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("messaging_settings")
        .update({
          quiet_hours_enabled: v.quietHoursEnabled,
          quiet_hours_start: v.quietHoursStart,
          quiet_hours_end: v.quietHoursEnd,
          customer_thread_hours: v.customerThreadHours,
          sms_opt_out_text: v.smsOptOutText,
          email_footer: v.emailFooter,
          review_delay_days: v.reviewDelayDays,
          referral_invite_delay_days: v.referralInviteDelayDays,
          case_sla_business_days: v.caseSlaBusinessDays,
        })
        .not("org_id", "is", null)
        .select("org_id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden", "You can't change messaging settings."));
    revalidatePath("/admin/templates/settings");
    return { saved: true };
  },
});
