"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { renderTemplate } from "@/lib/domain/templates/merge";
import { asciiPunctuation } from "@/lib/domain/templates/words";
import { loadMessagingSettings } from "@/lib/messaging/core";
import { markThreadSchema, renderForSchema } from "@/lib/validation/communication";
import { loadRunContext } from "@/lib/workflows/context";

/**
 * Inbox (SPEC §5.7): mark a conversation read or unread (for everyone; only
 * people who can reply may), and fill a composer from a template for a lead
 * or job. Replies go through the lead's and job's own send actions, so
 * consent, Do Not Contact and the outbox rules are the same everywhere.
 */

export const markThread = defineAction({
  name: "messages.thread.mark",
  schema: markThreadSchema,
  permissions: ["messages:read", "messages:send"],
  handler: async (v, { supabase }) => {
    const { error } = await supabase.rpc("mark_thread_read", {
      p_thread: v.threadId,
      p_read: v.read,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath("/messages");
    return { read: v.read };
  },
});

/** A template filled in for this lead or job (fields with no value are left as [field] to fix by hand). */
export const renderTemplateFor = defineAction({
  name: "messages.template.render",
  schema: renderForSchema,
  permissions: ["messages:send"],
  handler: async (v, ctx) => {
    const table = v.subjectType === "job" ? "jobs" : "leads";
    const visible = check(
      await ctx.supabase.from(table).select("id").eq("id", v.subjectId).maybeSingle(),
    );
    if (!visible) throw new ActionFailure(actionError("not_found", "That record isn't available."));
    const t = check(
      await ctx.supabase
        .from("message_templates")
        .select("subject, body, active")
        .eq("key", v.key)
        .eq("channel", v.channel)
        .maybeSingle(),
    );
    if (!t || !t.active)
      throw new ActionFailure(actionError("not_found", "That template is off or missing."));
    const service = await ctx.service();
    const settings = await loadMessagingSettings(service, ctx.viewer.orgId);
    const run = await loadRunContext(
      service,
      ctx.viewer.orgId,
      { type: v.subjectType, id: v.subjectId },
      { type: "composer", payload: {} },
      { now: new Date(), customerThreadHours: settings.customerThreadHours, dryRun: false },
    );
    if (!run) throw new ActionFailure(actionError("not_found", "That record isn't available."));
    // The person writing signs it.
    const merge = {
      ...run.merge,
      poc: {
        first_name: ctx.viewer.name.split(/\s+/)[0] ?? ctx.viewer.name,
        full_name: ctx.viewer.name,
      },
    };
    const body = renderTemplate(t.body, merge, { missingAs: "marker" }).text;
    return {
      subject: t.subject ? renderTemplate(t.subject, merge, { missingAs: "marker" }).text : null,
      body: v.channel === "sms" ? asciiPunctuation(body) : body,
      templateKey: v.key,
    };
  },
});
