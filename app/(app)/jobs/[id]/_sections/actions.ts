"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { TEAM_ROLE_LABELS, type TeamRole } from "@/lib/domain/jobs/constants";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import {
  logJobCall,
  sendJobEmail,
  sendJobSms,
  type JobRecipient,
  type MessagingJob,
} from "@/lib/jobs/messaging";
import { logError } from "@/lib/log";
import { teamMemberSchema } from "@/lib/validation/jobs";
import { pacificToUtcIso } from "@/app/(app)/leads/[id]/utils";
import {
  jobCallSchema,
  jobCommentSchema,
  jobCommentUpdateSchema,
  jobEmailSchema,
  jobNotePinSchema,
  jobNoteSchema,
  jobNoteUpdateSchema,
  jobRecordRefSchema,
  jobSmsSchema,
  jobTaskSchema,
  jobTaskStatusSchema,
} from "./schemas";

/**
 * Job Detail section mutations (SPEC §8.5 #10–15). Each one: zod-validated,
 * permission-checked by defineAction (which also refuses while viewing as
 * someone else), runs through the user's own Supabase client so row security
 * decides, and is audit-logged and turned into a domain event by database
 * triggers. Sends only reach the integrations outbox (simulated).
 */

const NOT_FOUND = new ActionFailure({ code: "not_found", message: "That job isn't available." });

const jobPath = (id: string) => `/jobs/${id}`;

const notYours = (what: string) =>
  new ActionFailure({ code: "forbidden", message: `You can only change your own ${what}.` });

async function requireJob(ctx: ActionContext, jobId: string) {
  const job = check(
    await ctx.supabase
      .from("jobs")
      .select("id, org_id, primary_contact_id, lead_id")
      .eq("id", jobId)
      .maybeSingle(),
  );
  if (!job) throw NOT_FOUND;
  return job;
}

/**
 * Timeline entry on the job. People can't write activity rows directly, so
 * this uses the service client after the action's own checks. Best effort: a
 * failed timeline write never undoes the change itself.
 */
async function logJobActivity(
  ctx: ActionContext,
  jobId: string,
  type: string,
  summary: string,
  payload: Record<string, string | null> = {},
): Promise<void> {
  try {
    const svc = await ctx.service();
    const { error } = await svc.from("activity").insert({
      org_id: ctx.viewer.orgId,
      subject_type: "job",
      subject_id: jobId,
      type,
      summary,
      payload,
      actor_id: ctx.viewer.real.id,
    });
    if (error) throw error;
  } catch (error) {
    logError("jobs.activity", error);
  }
}

// --- Messages ----------------------------------------------------------------------

async function loadMessagingJob(ctx: ActionContext, jobId: string): Promise<MessagingJob> {
  const job = await requireJob(ctx, jobId);
  let contact: JobRecipient | null = null;
  if (job.primary_contact_id) {
    // Row security: a contact the person can't see can't be messaged either.
    const c = check(
      await ctx.supabase
        .from("contacts")
        .select("id, first_name, last_name, mobile, phone, email, do_not_contact, opted_out_at")
        .eq("id", job.primary_contact_id)
        .maybeSingle(),
    );
    if (c) {
      contact = {
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        mobile: c.mobile,
        phone: c.phone,
        email: c.email,
        doNotContact: c.do_not_contact,
        optedOutAt: c.opted_out_at,
      };
    }
  }
  // Do Not Contact on the original lead still applies, even to people who
  // can't open the lead (read with the service client after the job check).
  let leadDisposition: string | null = null;
  if (job.lead_id) {
    const svc = await ctx.service();
    const { data } = await svc
      .from("leads")
      .select("disposition")
      .eq("id", job.lead_id)
      .maybeSingle();
    leadDisposition = data?.disposition ?? null;
  }
  return { id: job.id, orgId: job.org_id, contact, leadDisposition };
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

export const sendJobSmsAction = defineAction({
  name: "jobs.send_sms",
  permissions: ["messages:send"],
  schema: jobSmsSchema,
  handler: async ({ job_id, body }, ctx) => {
    const job = await loadMessagingJob(ctx, job_id);
    const { ic, connectionStatus } = await integrationContext(ctx, "sms_voice");
    // No `fetch` is passed: even a wrongly chosen real provider could not make a request.
    const provider = getSmsProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    const sent = await sendJobSms(ctx.supabase, provider, job, body);
    revalidatePath(jobPath(job_id));
    return sent;
  },
});

export const sendJobEmailAction = defineAction({
  name: "jobs.send_email",
  permissions: ["messages:send"],
  schema: jobEmailSchema,
  handler: async ({ job_id, subject, body }, ctx) => {
    const job = await loadMessagingJob(ctx, job_id);
    const { ic, connectionStatus } = await integrationContext(ctx, "email");
    const provider = getEmailProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
    });
    const sent = await sendJobEmail(ctx.supabase, provider, job, { subject, body });
    revalidatePath(jobPath(job_id));
    return sent;
  },
});

export const logJobCallAction = defineAction({
  name: "jobs.log_call",
  permissions: ["messages:send"],
  schema: jobCallSchema,
  handler: async ({ job_id, outcome, duration_minutes, notes }, ctx) => {
    const job = await loadMessagingJob(ctx, job_id);
    const logged = await logJobCall(ctx.supabase, job, {
      outcome,
      durationSeconds: duration_minutes,
      notes,
    });
    revalidatePath(jobPath(job_id));
    return logged;
  },
});

// --- Notes -----------------------------------------------------------------------------

export const addJobNote = defineAction({
  name: "notes.create",
  permissions: ["notes:write"],
  schema: jobNoteSchema,
  handler: async ({ job_id, body, priority, pinned }, ctx) => {
    const job = await requireJob(ctx, job_id);
    check(
      await ctx.supabase.from("notes").insert({
        org_id: job.org_id,
        subject_type: "job",
        subject_id: job_id,
        body,
        priority,
        pinned,
      }),
    );
    revalidatePath(jobPath(job_id));
    return { ok: true };
  },
});

export const updateJobNote = defineAction({
  name: "notes.update",
  permissions: ["notes:write"],
  schema: jobNoteUpdateSchema,
  handler: async ({ id, job_id, body, priority, pinned }, { supabase }) => {
    const rows = check(
      await supabase
        .from("notes")
        .update({ body, priority, pinned })
        .eq("id", id)
        .eq("subject_type", "job")
        .eq("subject_id", job_id)
        .select("id"),
    );
    if (!rows?.length) throw notYours("notes");
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

export const setJobNotePinned = defineAction({
  name: "notes.pin",
  permissions: ["notes:write"],
  schema: jobNotePinSchema,
  handler: async ({ id, job_id, pinned }, { supabase }) => {
    const rows = check(
      await supabase
        .from("notes")
        .update({ pinned })
        .eq("id", id)
        .eq("subject_type", "job")
        .eq("subject_id", job_id)
        .select("id"),
    );
    if (!rows?.length) throw notYours("notes");
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

/** Soft delete of something the person wrote (author only, like the lead tabs). */
async function softDeleteOwn(
  ctx: ActionContext,
  table: "notes" | "comments",
  id: string,
  jobId: string,
): Promise<void> {
  const what = table === "notes" ? "note" : "comment";
  const row = check(
    await ctx.supabase
      .from(table)
      .select("created_by")
      .eq("id", id)
      .eq("subject_type", "job")
      .eq("subject_id", jobId)
      .maybeSingle(),
  );
  if (!row) throw new ActionFailure({ code: "not_found", message: `That ${what} is gone.` });
  if (row.created_by !== ctx.viewer.real.id) throw notYours(`${what}s`);
  // Row security can't express this update: Postgres also checks the new row
  // against the SELECT policy (deleted_at is null), so a user-client update is
  // always refused. The checks above prove the person can see the post and
  // wrote it (and defineAction refused View as user); the service client
  // records them as the actor for the audit log.
  const svc = await ctx.service();
  check(
    await svc
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("created_by", ctx.viewer.real.id)
      .is("deleted_at", null),
  );
}

export const deleteJobNote = defineAction({
  name: "notes.delete",
  permissions: ["notes:write"],
  schema: jobRecordRefSchema,
  handler: async ({ id, job_id }, ctx) => {
    await softDeleteOwn(ctx, "notes", id, job_id);
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

// --- Comments ----------------------------------------------------------------------------

export const addJobComment = defineAction({
  name: "comments.create",
  permissions: ["notes:write"],
  schema: jobCommentSchema,
  handler: async ({ job_id, body, category, mentions }, ctx) => {
    const job = await requireJob(ctx, job_id);
    // A database trigger notifies the people mentioned.
    check(
      await ctx.supabase.from("comments").insert({
        org_id: job.org_id,
        subject_type: "job",
        subject_id: job_id,
        body,
        category,
        mentions: [...new Set(mentions)],
      }),
    );
    revalidatePath(jobPath(job_id));
    return { ok: true };
  },
});

export const updateJobComment = defineAction({
  name: "comments.update",
  permissions: ["notes:write"],
  schema: jobCommentUpdateSchema,
  handler: async ({ id, job_id, body, category, mentions }, { supabase }) => {
    const rows = check(
      await supabase
        .from("comments")
        .update({ body, category, mentions: [...new Set(mentions)] })
        .eq("id", id)
        .eq("subject_type", "job")
        .eq("subject_id", job_id)
        .select("id"),
    );
    if (!rows?.length) throw notYours("comments");
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

export const deleteJobComment = defineAction({
  name: "comments.delete",
  permissions: ["notes:write"],
  schema: jobRecordRefSchema,
  handler: async ({ id, job_id }, ctx) => {
    await softDeleteOwn(ctx, "comments", id, job_id);
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

// --- Tasks ------------------------------------------------------------------------------

export const addJobTask = defineAction({
  name: "tasks.create",
  permissions: ["tasks:manage"],
  schema: jobTaskSchema,
  handler: async ({ job_id, title, due_date, due_time, assignee_id, priority }, ctx) => {
    const job = await requireJob(ctx, job_id);
    check(
      await ctx.supabase.from("tasks").insert({
        org_id: job.org_id,
        subject_type: "job",
        subject_id: job_id,
        title,
        // A date without a time is due at the end of the business day (5 PM Pacific).
        due_at: due_date ? pacificToUtcIso(due_date, due_time ?? "17:00") : null,
        assignee_id,
        priority,
      }),
    );
    revalidatePath(jobPath(job_id));
    return { ok: true };
  },
});

export const setJobTaskStatus = defineAction({
  name: "tasks.set_status",
  permissions: ["tasks:manage"],
  schema: jobTaskStatusSchema,
  handler: async ({ id, job_id, done }, { supabase }) => {
    const rows = check(
      await supabase
        .from("tasks")
        .update({ status: done ? "done" : "open" })
        .eq("id", id)
        .eq("subject_type", "job")
        .eq("subject_id", job_id)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({ code: "forbidden", message: "You can't change that task." });
    }
    revalidatePath(jobPath(job_id));
    return { id };
  },
});

// --- Internal team ---------------------------------------------------------------------

async function teammateName(ctx: ActionContext, userId: string): Promise<string> {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name ?? "A teammate";
}

export const addTeammate = defineAction({
  name: "jobs.team_add",
  permissions: ["jobs:assign"],
  schema: teamMemberSchema,
  handler: async ({ job_id, user_id, role }, ctx) => {
    const job = await requireJob(ctx, job_id);
    const { error } = await ctx.supabase
      .from("job_team")
      .insert({ org_id: job.org_id, job_id, user_id, role });
    if (error?.code === "23505") {
      throw new ActionFailure({
        code: "conflict",
        message: "That teammate already has that role on this job.",
      });
    }
    check({ data: null, error });
    const label = TEAM_ROLE_LABELS[role as TeamRole];
    await logJobActivity(
      ctx,
      job_id,
      "team_added",
      `${await teammateName(ctx, user_id)} added to the team as ${label.toLowerCase()}`,
      { user_id, role },
    );
    revalidatePath(jobPath(job_id));
    return { ok: true };
  },
});

export const removeTeammate = defineAction({
  name: "jobs.team_remove",
  permissions: ["jobs:assign"],
  schema: teamMemberSchema,
  handler: async ({ job_id, user_id, role }, ctx) => {
    await requireJob(ctx, job_id);
    const rows = check(
      await ctx.supabase
        .from("job_team")
        .delete()
        .eq("job_id", job_id)
        .eq("user_id", user_id)
        .eq("role", role)
        .select("user_id"),
    );
    if (!rows?.length) {
      throw new ActionFailure({
        code: "forbidden",
        message: "You can't change the team on this job.",
      });
    }
    const label = TEAM_ROLE_LABELS[role as TeamRole];
    await logJobActivity(
      ctx,
      job_id,
      "team_removed",
      `${await teammateName(ctx, user_id)} removed from the team (${label.toLowerCase()})`,
      { user_id, role },
    );
    revalidatePath(jobPath(job_id));
    return { ok: true };
  },
});
