"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import type { Database } from "@/lib/db/types";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { sendCaseMessage } from "@/lib/cases/service";
import { caseSlaDue } from "@/lib/domain/cases";
import { toBusinessHours } from "@/lib/domain/company-settings";
import { loadMessagingSettings } from "@/lib/messaging/core";
import {
  caseMessageSchema,
  caseVisitSchema,
  createCaseSchema,
  updateCaseSchema,
} from "@/lib/validation/cases";
import { pacificToUtcIso } from "@/app/(app)/jobs/[id]/utils";

/**
 * Warranty & service cases (SPEC §5.7, §8.16, §9). Row security decides who
 * can open and change a case; the database numbers it, stamps resolution
 * times, writes the job's activity line, the audit log and the change event.
 */

const NOT_FOUND = new ActionFailure(actionError("not_found", "That case isn't available."));

function refresh(caseId: string | null, jobId: string | null) {
  revalidatePath("/cases");
  if (caseId) revalidatePath(`/cases/${caseId}`);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule/onboarding");
}

export const createCase = defineAction({
  name: "cases.create",
  schema: createCaseSchema,
  permissions: ["cases:manage"],
  handler: async (v, ctx) => {
    let accountId = v.accountId ?? null;
    let contactId = v.contactId ?? null;
    if (v.jobId) {
      const job = check(
        await ctx.supabase
          .from("jobs")
          .select("id, account_id, primary_contact_id")
          .eq("id", v.jobId)
          .maybeSingle(),
      );
      if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
      accountId = job.account_id;
      contactId ??= job.primary_contact_id;
    } else if (accountId) {
      const account = check(
        await ctx.supabase
          .from("accounts")
          .select("id, primary_contact_id")
          .eq("id", accountId)
          .maybeSingle(),
      );
      if (!account) {
        throw new ActionFailure(actionError("not_found", "That customer isn't available."));
      }
      contactId ??= account.primary_contact_id;
    }
    const service = await ctx.service();
    const [settings, company] = await Promise.all([
      loadMessagingSettings(service, ctx.viewer.orgId),
      service
        .from("company_settings")
        .select("business_hours")
        .eq("org_id", ctx.viewer.orgId)
        .maybeSingle(),
    ]);
    const sla = caseSlaDue(
      new Date(),
      settings.caseSlaBusinessDays,
      toBusinessHours(company.data?.business_hours),
    );
    const { data, error } = await ctx.supabase
      .from("cases")
      .insert({
        org_id: ctx.viewer.orgId,
        job_id: v.jobId ?? null,
        account_id: accountId,
        contact_id: contactId,
        type: v.type,
        priority: v.priority,
        source: v.source,
        title: v.title,
        description: v.description,
        owner_id: v.ownerId ?? ctx.viewer.id,
        sla_due_at: sla.toISOString(),
        case_number: "",
      })
      .select("id, case_number")
      .single();
    if (error) throw new ActionFailure(mapDbError(error));
    let acknowledged: string | null = null;
    if (v.acknowledge !== "none" && ctx.viewer.can("messages:send")) {
      const r = await sendCaseMessage(service, {
        orgId: ctx.viewer.orgId,
        caseId: data.id,
        key: "case_received",
        channel: v.acknowledge,
        actor: { id: ctx.viewer.id, name: ctx.viewer.name },
      });
      acknowledged = r.sent ? null : r.reason;
    }
    refresh(data.id, v.jobId ?? null);
    return { id: data.id, caseNumber: data.case_number, ackProblem: acknowledged };
  },
});

export const updateCase = defineAction({
  name: "cases.update",
  schema: updateCaseSchema,
  permissions: ["cases:manage"],
  handler: async (v, ctx) => {
    const patch: Database["public"]["Tables"]["cases"]["Update"] = {};
    if (v.status) patch.status = v.status;
    if (v.priority) patch.priority = v.priority;
    if (v.type) patch.type = v.type;
    if (v.ownerId !== undefined) patch.owner_id = v.ownerId;
    if (v.jobId) patch.job_id = v.jobId;
    if (v.resolution !== null) patch.resolution = v.resolution;
    if (!Object.keys(patch).length) {
      throw new ActionFailure(actionError("validation", "Nothing to change."));
    }
    const rows = check(
      await ctx.supabase.from("cases").update(patch).eq("id", v.id).select("id, job_id, status"),
    );
    const row = rows?.[0];
    if (!row) throw NOT_FOUND;
    refresh(row.id, row.job_id);
    return { status: row.status };
  },
});

/** A warranty visit: an appointment on the case's job, linked to the case. */
export const scheduleCaseVisit = defineAction({
  name: "cases.schedule_visit",
  schema: caseVisitSchema,
  permissions: ["cases:manage", "appointments:manage"],
  handler: async (v, ctx) => {
    const c = check(
      await ctx.supabase
        .from("cases")
        .select("id, org_id, job_id, title, case_number, status")
        .eq("id", v.caseId)
        .maybeSingle(),
    );
    if (!c) throw NOT_FOUND;
    if (!c.job_id) {
      throw new ActionFailure(
        actionError("validation", "Link the case to a job first; visits are booked on a job.", {
          date: ["Link the case to a job first."],
        }),
      );
    }
    const startsAt = pacificToUtcIso(v.date, v.time);
    if (new Date(startsAt).getTime() < Date.now() - 60_000) {
      throw new ActionFailure(
        actionError("validation", "Pick a time that hasn't passed yet.", {
          date: ["Pick a time that hasn't passed yet."],
        }),
      );
    }
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, owner_id, property:properties(street, unit, city, state, zip)")
        .eq("id", c.job_id)
        .maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const p = job.property;
    const location = p
      ? [
          [p.street, p.unit].filter(Boolean).join(" "),
          p.city,
          [p.state, p.zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ") || null
      : null;
    const assignees = v.assignedUserIds.length
      ? [...new Set(v.assignedUserIds)]
      : [job.owner_id ?? ctx.viewer.id];
    const { data: appt, error } = await ctx.supabase
      .from("appointments")
      .insert({
        org_id: c.org_id,
        job_id: c.job_id,
        case_id: c.id,
        type: "warranty_visit",
        title: `Warranty visit · ${c.case_number}`,
        starts_at: startsAt,
        ends_at: new Date(new Date(startsAt).getTime() + v.durationMinutes * 60_000).toISOString(),
        assigned_user_ids: assignees,
        location,
        notes: v.notes,
      })
      .select("id")
      .single();
    if (error) throw new ActionFailure(mapDbError(error));
    if (c.status === "new" || c.status === "in_progress") {
      const { error: upErr } = await ctx.supabase
        .from("cases")
        .update({ status: "scheduled" })
        .eq("id", c.id);
      if (upErr) throw new ActionFailure(mapDbError(upErr));
    }
    let confirmProblem: string | null = null;
    if (v.confirm !== "none" && ctx.viewer.can("messages:send")) {
      const r = await sendCaseMessage(await ctx.service(), {
        orgId: ctx.viewer.orgId,
        caseId: c.id,
        key: "case_visit_booked",
        channel: v.confirm,
        actor: { id: ctx.viewer.id, name: ctx.viewer.name },
        appointmentId: appt.id,
      });
      confirmProblem = r.sent ? null : r.reason;
    }
    refresh(c.id, c.job_id);
    return { appointmentId: appt.id, startsAt, confirmProblem };
  },
});

export const sendCaseMessageAction = defineAction({
  name: "cases.message",
  schema: caseMessageSchema,
  permissions: ["cases:read", "messages:send"],
  handler: async (v, ctx) => {
    const visible = check(
      await ctx.supabase.from("cases").select("id, job_id").eq("id", v.caseId).maybeSingle(),
    );
    if (!visible) throw NOT_FOUND;
    const r = await sendCaseMessage(await ctx.service(), {
      orgId: ctx.viewer.orgId,
      caseId: v.caseId,
      key: v.key,
      channel: v.channel,
      actor: { id: ctx.viewer.id, name: ctx.viewer.name },
    });
    if (!r.sent) throw new ActionFailure(actionError("validation", r.reason));
    refresh(v.caseId, visible.job_id);
    return r;
  },
});
