"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { repriceChangeOrder, sendChangeOrder as sendCo } from "@/lib/estimating/change-orders";
import {
  changeOrderCreateSchema,
  changeOrderUpdateSchema,
  fieldChangeOrderSchema,
  sendSchema,
} from "@/lib/validation/estimates";

/**
 * Change orders (SPEC §7.7). Estimators and owners create, price and send them;
 * crew leads start a draft from the field (what they found, no prices). Lines
 * use the builder's addLine/updateLine/deleteLine actions.
 */

const refresh = (jobId: string) => {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/change-orders`, "layout");
};

export const createChangeOrder = defineAction({
  name: "change_orders.create",
  permissions: ["estimates:create"],
  schema: changeOrderCreateSchema,
  handler: async ({ job_id, title, reason }, ctx) => {
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, org_id, accepted_estimate_id")
        .eq("id", job_id)
        .maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const data = checkOne(
      await ctx.supabase
        .from("change_orders")
        .insert({
          org_id: job.org_id,
          job_id,
          title,
          reason,
          estimate_id: job.accepted_estimate_id,
          change_order_number: "", // numbered by the database
        })
        .select("id")
        .single(),
    );
    refresh(job_id);
    return { id: data.id };
  },
});

export const updateChangeOrder = defineAction({
  name: "change_orders.update",
  permissions: ["estimates:create"],
  schema: changeOrderUpdateSchema,
  handler: async ({ id, ...patch }, ctx) => {
    const rows = check(
      await ctx.supabase.from("change_orders").update(patch).eq("id", id).select("id, job_id"),
    );
    const row = rows?.[0];
    if (!row)
      throw new ActionFailure(actionError("not_found", "That change order isn't available."));
    await repriceChangeOrder(await ctx.service(), id);
    refresh(row.job_id);
    return { id };
  },
});

export const sendChangeOrder = defineAction({
  name: "change_orders.send",
  permissions: ["estimates:send", "messages:send"],
  schema: sendSchema,
  handler: async ({ id, channels, sms_body, email_subject, email_body }, ctx) => {
    const result = await sendCo(
      { id, channels, smsBody: sms_body, emailSubject: email_subject, emailBody: email_body },
      ctx,
    );
    const co = checkOne(
      await ctx.supabase.from("change_orders").select("job_id").eq("id", id).single(),
    );
    refresh(co.job_id);
    return result;
  },
});

/**
 * A crew lead found hidden rot (the classic case): they record a draft with
 * what they saw; an owner or estimator prices and sends it. Crew roles can't
 * read change orders (prices), so this is written with the service client
 * after checking they can see the job.
 */
export const createFieldChangeOrder = defineAction({
  name: "change_orders.field_draft",
  permissions: ["change_orders:draft"],
  schema: fieldChangeOrderSchema,
  handler: async ({ job_id, title, field_notes }, ctx) => {
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, org_id, accepted_estimate_id, name")
        .eq("id", job_id)
        .maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const service = await ctx.service();
    const { data, error } = await service
      .from("change_orders")
      .insert({
        org_id: job.org_id,
        job_id,
        title,
        field_notes,
        reason: field_notes,
        created_from_field: true,
        estimate_id: job.accepted_estimate_id,
        change_order_number: "", // numbered by the database
      })
      .select("id, change_order_number")
      .single();
    if (error || !data) throw new ActionFailure(actionError("server"));
    const { data: owners } = await service
      .from("profiles")
      .select("id, role_templates!inner(grants_all)")
      .eq("org_id", job.org_id)
      .eq("is_active", true)
      .eq("role_templates.grants_all", true);
    const notify = (owners ?? []).filter((o) => o.id !== ctx.viewer.id);
    if (notify.length) {
      await service.from("notifications").insert(
        notify.map((o) => ({
          org_id: job.org_id,
          user_id: o.id,
          type: "change_order",
          title: `Field change order to price: ${job.name}`.slice(0, 200),
          body: `${ctx.viewer.name}: ${title}`.slice(0, 1000),
          link: `/jobs/${job_id}?section=estimate`,
        })),
      );
    }
    refresh(job_id);
    return { id: data.id, number: data.change_order_number };
  },
});
