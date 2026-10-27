"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { subSourceIssue } from "@/lib/domain/leads/sub-source";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import { loadLeadOptions, rescoreLead, recordHumanContact } from "@/lib/leads/service";
import { logLeadCall, sendLeadEmail, sendLeadSms, type MessagingLead } from "@/lib/leads/messaging";
import {
  bookWalkthroughSchema,
  convertLeadSchema,
  leadStatusSchema,
  leadUpdateSchema,
} from "@/lib/validation/leads";
import { convertLeadToJob } from "@/lib/jobs/convert";
import { logError } from "@/lib/log";
import {
  commentSchema,
  commentUpdateSchema,
  deleteLeadSchema,
  logCallSchema,
  noteSchema,
  noteUpdateSchema,
  recordRefSchema,
  sendEmailSchema,
  sendSmsSchema,
  taskSchema,
  taskStatusSchema,
} from "./schemas";
import { pacificToUtcIso } from "./utils";

/**
 * Lead Detail mutations (SPEC §8.4). Each one: zod-validated, permission-checked
 * by defineAction (which also refuses while viewing as another user), runs
 * through the user's own Supabase client so RLS decides, and is audit-logged
 * and turned into a domain event by database triggers.
 */

/** Default walkthrough length (SPEC §15.1 work types: Walkthrough/Estimate 60 min). */
const WALKTHROUGH_MINUTES = 60;

const NOT_FOUND = new ActionFailure({ code: "not_found", message: "That lead isn't available." });

const leadPath = (id: string) => `/leads/${id}`;

async function loadMessagingLead(ctx: ActionContext, id: string): Promise<MessagingLead> {
  const lead = check(
    await ctx.supabase
      .from("leads")
      .select("id, org_id, mobile, phone, email, disposition")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!lead) throw NOT_FOUND;
  return {
    id: lead.id,
    orgId: lead.org_id,
    mobile: lead.mobile,
    phone: lead.phone,
    email: lead.email,
    disposition: lead.disposition,
  };
}

async function integrationContext(ctx: ActionContext, domain: "sms_voice" | "email") {
  const connection = check(
    await ctx.supabase
      .from("integration_connections")
      .select("status")
      .eq("org_id", ctx.viewer.orgId)
      .eq("domain", domain)
      .maybeSingle(),
  );
  const ic: IntegrationContext = {
    orgId: ctx.viewer.orgId,
    actorId: ctx.viewer.id,
    sink: createSupabaseOutboxSink(await ctx.service()),
  };
  return { ic, connectionStatus: connection?.status ?? null };
}

/**
 * After a person reached out: stamp first contact (speed-to-lead, New →
 * Contacted) and rescore. This is bookkeeping, not an edit, so it runs with the
 * service client (actor recorded) even for people who can message a lead but
 * not edit it. The caller has already proved access through RLS.
 */
async function afterHumanContact(ctx: ActionContext, leadId: string, disposition?: string) {
  const svc = await ctx.service();
  if (disposition) check(await svc.from("leads").update({ disposition }).eq("id", leadId));
  await recordHumanContact(svc, leadId);
  await rescoreLead(svc, leadId);
}

// --- Lead fields, status, booking ------------------------------------------------

export const updateLead = defineAction({
  name: "leads.update",
  permissions: ["leads:update"],
  schema: leadUpdateSchema,
  handler: async ({ id, owner_id, ...values }, { supabase, viewer }) => {
    // Only check the sub-source rule when source or sub-source changes, so an
    // older lead without a sub-source can still have its email fixed.
    const current = check(
      await supabase
        .from("leads")
        .select("lead_source, lead_sub_source")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!current) throw NOT_FOUND;
    const sourceChanged =
      (values.lead_source ?? null) !== current.lead_source ||
      (values.lead_sub_source ?? null) !== current.lead_sub_source;
    const subIssue = sourceChanged
      ? subSourceIssue(
          values.lead_source,
          values.lead_sub_source,
          (await loadLeadOptions(supabase)).picklists.lead_sub_source,
        )
      : null;
    if (subIssue) {
      throw new ActionFailure(
        actionError("validation", undefined, { lead_sub_source: [subIssue] }),
      );
    }
    const changes = viewer.can("leads:assign") ? { ...values, owner_id } : values;
    const rows = check(await supabase.from("leads").update(changes).eq("id", id).select("id"));
    if (!rows?.length) throw NOT_FOUND;
    await rescoreLead(supabase, id);
    revalidatePath(leadPath(id));
    return { id };
  },
});

export const changeLeadStatus = defineAction({
  name: "leads.change_status",
  permissions: ["leads:update"],
  schema: leadStatusSchema,
  handler: async ({ id, status, disposition, lost_reason, nurture_until }, { supabase }) => {
    const current = check(await supabase.from("leads").select("status").eq("id", id).maybeSingle());
    if (!current) throw NOT_FOUND;
    if (current.status === "converted") {
      throw new ActionFailure({
        code: "validation",
        message: "This lead is already a job. Change it on the job instead.",
      });
    }
    const rows = check(
      await supabase
        .from("leads")
        .update({
          status,
          disposition,
          lost_reason: status === "lost" ? lost_reason : null,
          nurture_until: status === "nurture" ? nurture_until : null,
        })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) throw NOT_FOUND;
    revalidatePath(leadPath(id));
    return { id };
  },
});

export const bookWalkthrough = defineAction({
  name: "leads.book_walkthrough",
  permissions: ["leads:update", "appointments:manage"],
  schema: bookWalkthroughSchema,
  handler: async ({ id, date, time, owner_id, notes }, ctx) => {
    const { supabase, viewer } = ctx;
    const walkthroughAt = pacificToUtcIso(date, time);
    if (new Date(walkthroughAt).getTime() < Date.now() - 60_000) {
      throw new ActionFailure({
        code: "validation",
        message: "Pick a time that hasn't passed yet.",
        fieldErrors: { date: ["Pick a time that hasn't passed yet."] },
      });
    }
    const current = check(
      await supabase.from("leads").select("status, org_id, owner_id").eq("id", id).maybeSingle(),
    );
    if (!current) throw NOT_FOUND;
    if (current.status === "converted") {
      throw new ActionFailure({ code: "validation", message: "This lead is already a job." });
    }
    const newOwner = viewer.can("leads:assign") && owner_id ? owner_id : null;
    const rows = check(
      await supabase
        .from("leads")
        .update({
          status: "walkthrough_scheduled",
          disposition: "walkthrough_scheduled",
          // Only people who can assign leads may change the owner (DB guard agrees).
          ...(newOwner ? { owner_id: newOwner } : {}),
        })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) throw NOT_FOUND;
    // The appointment is the record; a trigger keeps the lead's walkthrough date in sync.
    const assignee = newOwner ?? current.owner_id ?? viewer.id;
    check(
      await supabase.from("appointments").insert({
        org_id: current.org_id,
        lead_id: id,
        type: "walkthrough",
        starts_at: walkthroughAt,
        ends_at: new Date(
          new Date(walkthroughAt).getTime() + WALKTHROUGH_MINUTES * 60_000,
        ).toISOString(),
        assigned_user_ids: [assignee],
        notes: notes ?? null,
      }),
    );
    if (notes && viewer.can("notes:write")) {
      check(
        await supabase.from("notes").insert({
          org_id: current.org_id,
          subject_type: "lead",
          subject_id: id,
          body: `Walkthrough notes: ${notes}`,
        }),
      );
    }
    await recordHumanContact(supabase, id);
    await rescoreLead(supabase, id);

    // SPEC §6.1: convert when the walkthrough is booked (Company Settings, default on).
    let jobId: string | null = null;
    let conversionError: string | null = null;
    if (viewer.can("jobs:create")) {
      const service = await ctx.service();
      const { data: settings } = await service
        .from("company_settings")
        .select("auto_convert_on_walkthrough")
        .eq("org_id", current.org_id)
        .maybeSingle();
      if (settings?.auto_convert_on_walkthrough ?? true) {
        // The booking stands even if converting fails; the screen shows why.
        try {
          jobId = (await convertLeadToJob(id, ctx)).jobId;
          revalidatePath("/jobs");
          revalidatePath(`/jobs/${jobId}`);
        } catch (e) {
          logError("leads.book_walkthrough.convert", e);
          conversionError =
            e instanceof ActionFailure
              ? e.error.message
              : "The lead couldn't be converted to a job.";
        }
      }
    }
    revalidatePath(leadPath(id));
    return { id, walkthroughAt, jobId, conversionError };
  },
});

export const convertLead = defineAction({
  name: "leads.convert",
  permissions: ["leads:update", "jobs:create"],
  schema: convertLeadSchema,
  handler: async ({ id, work_types }, ctx) => {
    const { jobId } = await convertLeadToJob(id, ctx, { workTypes: work_types ?? null });
    revalidatePath(leadPath(id));
    revalidatePath("/jobs");
    revalidatePath("/leads/list");
    return { jobId };
  },
});

export const deleteLead = defineAction({
  name: "leads.delete",
  permissions: ["leads:delete"],
  schema: deleteLeadSchema,
  handler: async ({ id, reason }, { supabase }) => {
    // soft_delete_record checks the permission; we also require that the user can see the lead.
    const visible = check(await supabase.from("leads").select("id").eq("id", id).maybeSingle());
    if (!visible) throw NOT_FOUND;
    check(
      await supabase.rpc("soft_delete_record", { p_table: "leads", p_id: id, p_reason: reason }),
    );
    revalidatePath("/leads/list");
    revalidatePath("/leads");
    return { id };
  },
});

// --- Messages ----------------------------------------------------------------------

export const sendSms = defineAction({
  name: "leads.send_sms",
  permissions: ["messages:send"],
  schema: sendSmsSchema,
  handler: async ({ lead_id, body }, ctx) => {
    const lead = await loadMessagingLead(ctx, lead_id);
    const { ic, connectionStatus } = await integrationContext(ctx, "sms_voice");
    // No `fetch` is passed: even a wrongly chosen real provider could not make a request.
    const provider = getSmsProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    const sent = await sendLeadSms(ctx.supabase, provider, lead, body);
    await afterHumanContact(ctx, lead_id);
    revalidatePath(leadPath(lead_id));
    return sent;
  },
});

export const sendEmail = defineAction({
  name: "leads.send_email",
  permissions: ["messages:send"],
  schema: sendEmailSchema,
  handler: async ({ lead_id, subject, body }, ctx) => {
    const lead = await loadMessagingLead(ctx, lead_id);
    const { ic, connectionStatus } = await integrationContext(ctx, "email");
    const provider = getEmailProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
    });
    const sent = await sendLeadEmail(ctx.supabase, provider, lead, { subject, body });
    await afterHumanContact(ctx, lead_id);
    revalidatePath(leadPath(lead_id));
    return sent;
  },
});

export const logCall = defineAction({
  name: "leads.log_call",
  permissions: ["messages:send"],
  schema: logCallSchema,
  handler: async ({ lead_id, outcome, duration_minutes, notes }, ctx) => {
    const lead = await loadMessagingLead(ctx, lead_id);
    const logged = await logLeadCall(ctx.supabase, lead, {
      outcome,
      durationSeconds: duration_minutes,
      notes,
    });
    await afterHumanContact(ctx, lead_id, outcome);
    revalidatePath(leadPath(lead_id));
    return logged;
  },
});

// --- Notes ---------------------------------------------------------------------------

export const addNote = defineAction({
  name: "notes.create",
  permissions: ["notes:write"],
  schema: noteSchema,
  handler: async ({ lead_id, body, priority, pinned }, { supabase, viewer }) => {
    check(
      await supabase.from("notes").insert({
        org_id: viewer.orgId,
        subject_type: "lead",
        subject_id: lead_id,
        body,
        priority,
        pinned,
      }),
    );
    revalidatePath(leadPath(lead_id));
    return { ok: true };
  },
});

const notYours = (what: string) =>
  new ActionFailure({ code: "forbidden", message: `You can only change your own ${what}.` });

export const updateNote = defineAction({
  name: "notes.update",
  permissions: ["notes:write"],
  schema: noteUpdateSchema,
  handler: async ({ id, lead_id, body, priority, pinned }, { supabase }) => {
    const rows = check(
      await supabase
        .from("notes")
        .update({ body, priority, pinned })
        .eq("id", id)
        .eq("subject_type", "lead")
        .eq("subject_id", lead_id)
        .select("id"),
    );
    if (!rows?.length) throw notYours("notes");
    revalidatePath(leadPath(lead_id));
    return { id };
  },
});

export const deleteNote = defineAction({
  name: "notes.delete",
  permissions: ["notes:write"],
  schema: recordRefSchema,
  handler: async ({ id, lead_id }, { supabase, viewer }) => {
    const note = check(
      await supabase
        .from("notes")
        .select("created_by")
        .eq("id", id)
        .eq("subject_type", "lead")
        .eq("subject_id", lead_id)
        .maybeSingle(),
    );
    if (!note) throw new ActionFailure({ code: "not_found", message: "That note is gone." });
    if (note.created_by !== viewer.real.id) throw notYours("notes");
    // A plain update can't pass row security (the deleted row leaves the SELECT
    // policy); soft_delete_post() checks author, permission and View as itself.
    check(await supabase.rpc("soft_delete_post", { p_table: "notes", p_id: id }));
    revalidatePath(leadPath(lead_id));
    return { id };
  },
});

// --- Comments ------------------------------------------------------------------------

export const addComment = defineAction({
  name: "comments.create",
  permissions: ["notes:write"],
  schema: commentSchema,
  handler: async ({ lead_id, body, category, mentions }, { supabase, viewer }) => {
    check(
      await supabase.from("comments").insert({
        org_id: viewer.orgId,
        subject_type: "lead",
        subject_id: lead_id,
        body,
        category,
        mentions: [...new Set(mentions)],
      }),
    );
    revalidatePath(leadPath(lead_id));
    return { ok: true };
  },
});

export const updateComment = defineAction({
  name: "comments.update",
  permissions: ["notes:write"],
  schema: commentUpdateSchema,
  handler: async ({ id, lead_id, body, category, mentions }, { supabase }) => {
    const rows = check(
      await supabase
        .from("comments")
        .update({ body, category, mentions: [...new Set(mentions)] })
        .eq("id", id)
        .eq("subject_type", "lead")
        .eq("subject_id", lead_id)
        .select("id"),
    );
    if (!rows?.length) throw notYours("comments");
    revalidatePath(leadPath(lead_id));
    return { id };
  },
});

// --- Tasks ------------------------------------------------------------------------------

export const addTask = defineAction({
  name: "tasks.create",
  permissions: ["tasks:manage"],
  schema: taskSchema,
  handler: async (
    { lead_id, title, due_date, due_time, assignee_id, priority },
    { supabase, viewer },
  ) => {
    check(
      await supabase.from("tasks").insert({
        org_id: viewer.orgId,
        subject_type: "lead",
        subject_id: lead_id,
        title,
        // A date without a time is due at the end of the business day (5 PM Pacific).
        due_at: due_date ? pacificToUtcIso(due_date, due_time ?? "17:00") : null,
        assignee_id,
        priority,
      }),
    );
    revalidatePath(leadPath(lead_id));
    return { ok: true };
  },
});

export const setTaskStatus = defineAction({
  name: "tasks.set_status",
  permissions: ["tasks:manage"],
  schema: taskStatusSchema,
  handler: async ({ id, lead_id, done }, { supabase }) => {
    const rows = check(
      await supabase
        .from("tasks")
        .update({ status: done ? "done" : "open" })
        .eq("id", id)
        .eq("subject_type", "lead")
        .eq("subject_id", lead_id)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({ code: "forbidden", message: "You can't change that task." });
    }
    revalidatePath(leadPath(lead_id));
    return { id };
  },
});
