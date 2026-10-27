"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { PACIFIC } from "@/lib/domain/workflows/compliance";
import { getVoiceProvider } from "@/lib/integrations/sms_voice";
import { integrationContext, loadMessagingJob } from "@/lib/jobs/send";
import { logJobCall } from "@/lib/jobs/messaging";
import { logLeadCall } from "@/lib/leads/messaging";
import { recordHumanContact, rescoreLead } from "@/lib/leads/service";
import { serverEnv } from "@/lib/env";
import {
  dispositionSchema,
  placeCallSchema,
  saveDispositionSchema,
  updateListSchema,
} from "@/lib/validation/follow-ups";

/**
 * Follow-up lists (SPEC §11.4, §8.19): log a disposition from the power
 * dialer (the call goes on the lead's or job's history, the lead's
 * disposition follows, Do Not Contact sticks), place a call through the voice
 * adapter (outbox only), and the owner settings for lists and dispositions.
 */

type Subject = { subjectType: "lead" | "job" | "account"; subjectId: string };

async function phoneFor(ctx: ActionContext, s: Subject): Promise<string | null> {
  if (s.subjectType === "lead") {
    const l = check(
      await ctx.supabase.from("leads").select("mobile, phone").eq("id", s.subjectId).maybeSingle(),
    );
    return l ? (l.mobile ?? l.phone) : null;
  }
  const table = s.subjectType === "job" ? "jobs" : "accounts";
  const row = check(
    await ctx.supabase.from(table).select("primary_contact_id").eq("id", s.subjectId).maybeSingle(),
  );
  if (!row?.primary_contact_id) return null;
  const c = check(
    await ctx.supabase
      .from("contacts")
      .select("mobile, phone")
      .eq("id", row.primary_contact_id)
      .maybeSingle(),
  );
  return c ? (c.mobile ?? c.phone) : null;
}

async function primaryContactId(ctx: ActionContext, s: Subject): Promise<string | null> {
  if (s.subjectType === "lead") return null;
  const table = s.subjectType === "job" ? "jobs" : "accounts";
  const row = check(
    await ctx.supabase.from(table).select("primary_contact_id").eq("id", s.subjectId).maybeSingle(),
  );
  return row?.primary_contact_id ?? null;
}

export const logDisposition = defineAction({
  name: "follow_ups.disposition",
  schema: dispositionSchema,
  permissions: ["messages:send"],
  handler: async (v, ctx) => {
    const d = check(
      await ctx.supabase
        .from("follow_up_dispositions")
        .select(
          "key, label, disposition_group, lead_disposition, requires_callback, sets_do_not_contact, active",
        )
        .eq("key", v.dispositionKey)
        .maybeSingle(),
    );
    if (!d || !d.active) {
      throw new ActionFailure(actionError("validation", "Pick one of the listed outcomes."));
    }
    const callbackAt = v.callbackAt ? fromZonedTime(`${v.callbackAt}:00`, PACIFIC) : null;
    if (d.requires_callback && !callbackAt) {
      throw new ActionFailure(
        actionError("validation", "Pick when to call back.", {
          callbackAt: ["Pick when to call back."],
        }),
      );
    }
    if (callbackAt && callbackAt.getTime() < Date.now() - 5 * 60_000) {
      throw new ActionFailure(
        actionError("validation", "Pick a callback time that hasn't passed.", {
          callbackAt: ["Pick a time that hasn't passed."],
        }),
      );
    }

    // The call itself goes on the record's history (leads and jobs only).
    let messageId: string | null = null;
    const where =
      v.subjectType === "account"
        ? (v.messageSubject ?? null)
        : { type: v.subjectType, id: v.subjectId };
    if (v.channel === "call" && where) {
      if (where.type === "lead") {
        const lead = check(
          await ctx.supabase
            .from("leads")
            .select("id, org_id, mobile, phone, email, disposition, sms_opted_out_at")
            .eq("id", where.id)
            .maybeSingle(),
        );
        if (!lead) throw new ActionFailure(actionError("not_found", "That lead isn't available."));
        messageId = (
          await logLeadCall(
            ctx.supabase,
            { ...lead, orgId: lead.org_id, smsOptedOutAt: lead.sms_opted_out_at },
            { outcome: d.lead_disposition, durationSeconds: null, notes: v.notes },
          )
        ).messageId;
      } else {
        const job = await loadMessagingJob(ctx, where.id);
        messageId = (
          await logJobCall(ctx.supabase, job, {
            outcome: d.lead_disposition,
            durationSeconds: null,
            notes: v.notes,
          })
        ).messageId;
      }
    }

    const { error } = await ctx.supabase.from("follow_up_attempts").insert({
      org_id: ctx.viewer.orgId,
      list_key: v.listKey,
      subject_type: v.subjectType,
      subject_id: v.subjectId,
      disposition_key: d.key,
      disposition_group: d.disposition_group,
      channel: v.channel,
      notes: v.notes,
      callback_at: callbackAt?.toISOString() ?? null,
      message_id: messageId,
      actor_id: ctx.viewer.id,
    });
    if (error) throw new ActionFailure(mapDbError(error));

    const svc = await ctx.service();
    if (v.subjectType === "lead") {
      if (d.lead_disposition) {
        check(
          await svc.from("leads").update({ disposition: d.lead_disposition }).eq("id", v.subjectId),
        );
      }
      if (v.channel !== "none") await recordHumanContact(svc, v.subjectId);
      await rescoreLead(svc, v.subjectId);
    }
    if (d.sets_do_not_contact && v.subjectType !== "lead") {
      // Do Not Contact is a customer's request; it applies even without contacts:update.
      const contactId = await primaryContactId(ctx, v);
      if (contactId) {
        check(await svc.from("contacts").update({ do_not_contact: true }).eq("id", contactId));
      }
    }
    await svc.rpc("emit_domain_event", {
      p_org: ctx.viewer.orgId,
      p_type: "follow_up.dispositioned",
      p_aggregate_type: v.subjectType,
      p_aggregate_id: v.subjectId,
      p_payload: {
        list_key: v.listKey,
        disposition: d.key,
        group: d.disposition_group,
        callback_at: callbackAt?.toISOString() ?? null,
        actor_id: ctx.viewer.id,
      },
    });
    revalidatePath("/follow-ups");
    revalidatePath(`/follow-ups/${v.listKey}`);
    return { disposition: d.label, callbackAt: callbackAt?.toISOString() ?? null };
  },
});

/** "Call" in the dialer: the voice adapter records the call to the outbox (no real call). */
export const placeFollowUpCall = defineAction({
  name: "follow_ups.place_call",
  schema: placeCallSchema,
  permissions: ["messages:send"],
  handler: async (v, ctx) => {
    const to = await phoneFor(ctx, v);
    if (!to) throw new ActionFailure(actionError("validation", "No phone number on file."));
    const { ic, connectionStatus } = await integrationContext(ctx, "sms_voice");
    const provider = getVoiceProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    if (provider.provider !== "outbox") {
      throw new ActionFailure(
        actionError("forbidden", "Calls only go to the outbox in this build."),
      );
    }
    const r = await provider.placeCall({ to, related: { type: v.subjectType, id: v.subjectId } });
    return { to, outboxId: r.outboxId ?? null };
  },
});

// --- Admin → Follow-up Lists ----------------------------------------------------------

export const updateFollowUpList = defineAction({
  name: "follow_ups.list.update",
  schema: updateListSchema,
  permissions: ["settings:manage"],
  handler: async (v, ctx) => {
    const rows = check(
      await ctx.supabase
        .from("follow_up_lists")
        .update({
          name: v.name,
          description: v.description,
          script: v.script,
          cooldown_hours: v.cooldownHours,
          active: v.active,
        })
        .eq("key", v.key)
        .select("key"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That list isn't available."));
    revalidatePath("/admin/follow-up-lists");
    revalidatePath("/follow-ups");
    return { key: v.key };
  },
});

export const saveDisposition = defineAction({
  name: "follow_ups.disposition.save",
  schema: saveDispositionSchema,
  permissions: ["settings:manage"],
  handler: async (v, ctx) => {
    const values = {
      label: v.label,
      disposition_group: v.group,
      lead_disposition: v.leadDisposition ? v.leadDisposition : null,
      requires_callback: v.requiresCallback,
      sets_do_not_contact: v.setsDoNotContact,
      active: v.active,
    };
    if (v.id) {
      const rows = check(
        await ctx.supabase
          .from("follow_up_dispositions")
          .update(values)
          .eq("id", v.id)
          .select("id"),
      );
      if (!rows?.length) {
        throw new ActionFailure(actionError("not_found", "That disposition isn't available."));
      }
    } else {
      const { error } = await ctx.supabase.from("follow_up_dispositions").insert({
        ...values,
        org_id: ctx.viewer.orgId,
        key: v.key ?? "",
        sort_order: 500,
      });
      if (error) throw new ActionFailure(mapDbError(error));
    }
    revalidatePath("/admin/follow-up-lists");
    return { ok: true };
  },
});
