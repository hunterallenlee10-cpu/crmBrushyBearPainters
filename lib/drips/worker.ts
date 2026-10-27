import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { dripExitReason, nextDripStep, validateDripSteps } from "@/lib/domain/drips";
import { planSend, renderSend } from "@/lib/domain/workflows/plan";
import type { SendAction } from "@/lib/domain/workflows/types";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/log";
import {
  appUrl,
  loadMessagingSettings,
  loadTemplateLookup,
  recordOutbound,
} from "@/lib/messaging/core";
import { linkSecret, unsubscribeToken } from "@/lib/messaging/links";
import { loadRunContext } from "@/lib/workflows/context";

type Db = SupabaseClient<Database>;
type Enrollment = Database["public"]["Tables"]["drip_enrollments"]["Row"];

/**
 * Drip worker (SPEC §8.11, §11.2 #16): every minute, enrollments whose next
 * step is due are checked against the drip's exit conditions, then the step is
 * sent (simulated) under the same consent and quiet-hours rules as workflows;
 * marketing steps get the STOP line or the unsubscribe footer. A step that
 * can't reach the person is logged and the drip moves on.
 */

type StepLog = {
  step: number;
  at: string;
  outcome: "sent" | "blocked" | "deferred";
  detail: string;
};

async function exitFacts(service: Db, e: Enrollment) {
  const facts = {
    repliedSinceEnrolled: false,
    walkthroughBooked: false,
    converted: false,
    sold: false,
    lost: false,
    optedOut: false,
  };
  let leadId: string | null = null;
  let jobId: string | null = null;
  if (e.subject_type === "lead") {
    const { data: l } = await service
      .from("leads")
      .select(
        "id, status, converted_job_id, disposition, sms_opted_out_at, email_opted_out_at, deleted_at",
      )
      .eq("id", e.subject_id)
      .maybeSingle();
    if (!l || l.deleted_at) return { ...facts, lost: true };
    leadId = l.id;
    jobId = l.converted_job_id;
    facts.converted = l.status === "converted" || !!l.converted_job_id;
    facts.lost = l.status === "lost" || l.status === "unqualified";
    facts.walkthroughBooked = l.status === "walkthrough_scheduled";
    facts.optedOut =
      l.disposition === "do_not_contact" || (!!l.sms_opted_out_at && !!l.email_opted_out_at);
  } else if (e.subject_type === "job") {
    jobId = e.subject_id;
  }
  if (jobId) {
    const { data: j } = await service
      .from("jobs")
      .select("stage, estimate_accepted_at, deleted_at")
      .eq("id", jobId)
      .maybeSingle();
    if (j) {
      facts.sold = facts.sold || !!j.estimate_accepted_at;
      facts.lost = facts.lost || j.stage === "closed_lost" || !!j.deleted_at;
    }
  }
  const subjects = [leadId ? `lead:${leadId}` : null, jobId ? `job:${jobId}` : null].filter(
    (x): x is string => !!x,
  );
  for (const s of subjects) {
    const [type, id] = s.split(":") as [string, string];
    const { count } = await service
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", type)
      .eq("subject_id", id)
      .eq("direction", "inbound")
      .gte("created_at", e.enrolled_at);
    if ((count ?? 0) > 0) facts.repliedSinceEnrolled = true;
  }
  if (leadId && !facts.walkthroughBooked) {
    const { count } = await service
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("type", "walkthrough")
      .gte("created_at", e.enrolled_at);
    facts.walkthroughBooked = (count ?? 0) > 0;
  }
  return facts;
}

export async function sweepDrips(service: Db, now = new Date(), limit = 100) {
  const { data, error } = await service.rpc("claim_drip_enrollments", { p_limit: limit });
  if (error) throw error;
  let sent = 0;
  let exited = 0;
  let completed = 0;
  for (const e of data ?? []) {
    try {
      const r = await runEnrollment(service, e, now);
      if (r === "sent") sent++;
      else if (r === "exited") exited++;
      else if (r === "completed") completed++;
    } catch (err) {
      logError("drips.enrollment", err);
      await service.from("drip_enrollments").update({ locked_at: null }).eq("id", e.id);
    }
  }
  return { claimed: (data ?? []).length, sent, exited, completed };
}

async function end(
  service: Db,
  e: Enrollment,
  status: "completed" | "exited",
  reason: string | null,
  now: Date,
  log: StepLog[],
) {
  await service
    .from("drip_enrollments")
    .update({
      status,
      exit_reason: reason,
      ended_at: now.toISOString(),
      next_run_at: null,
      locked_at: null,
      steps_log: log as unknown as NonNullable<Json>,
    })
    .eq("id", e.id);
}

async function runEnrollment(service: Db, e: Enrollment, now: Date) {
  const log: StepLog[] = Array.isArray(e.steps_log) ? (e.steps_log as unknown as StepLog[]) : [];
  const { data: drip } = await service.from("drips").select("*").eq("id", e.drip_id).maybeSingle();
  if (!drip || !drip.active || drip.archived_at) {
    await end(service, e, "exited", "The drip was turned off.", now, log);
    return "exited";
  }
  if (e.subject_type === "contact") {
    await end(service, e, "exited", "Drips run on leads and jobs.", now, log);
    return "exited";
  }
  const reason = dripExitReason(drip.exit_conditions, await exitFacts(service, e));
  if (reason) {
    await end(service, e, "exited", reason, now, log);
    return "exited";
  }
  const { steps } = validateDripSteps(drip.steps);
  const step = steps[e.current_step];
  if (!step) {
    await end(service, e, "completed", null, now, log);
    return "completed";
  }
  const [settings, templates] = await Promise.all([
    loadMessagingSettings(service, e.org_id),
    loadTemplateLookup(service, e.org_id),
  ]);
  const ctx = await loadRunContext(
    service,
    e.org_id,
    { type: e.subject_type === "job" ? "job" : "lead", id: e.subject_id },
    { type: "drip.step", payload: { drip: drip.key ?? drip.id } },
    { now, customerThreadHours: settings.customerThreadHours, dryRun: false },
  );
  if (!ctx) {
    await end(service, e, "exited", "The record is gone.", now, log);
    return "exited";
  }
  const action: SendAction = {
    id: `drip_${e.current_step}`,
    kind: "send",
    label: drip.name,
    template: step.template_key,
    channel: step.channel,
    to: "customer",
  };
  const plans = planSend(action, ctx, templates, now, settings.engine);
  const defer = plans.find((p) => !p.blocked && p.deferUntil)?.deferUntil;
  if (defer) {
    log.push({
      step: e.current_step,
      at: now.toISOString(),
      outcome: "deferred",
      detail: "Quiet hours.",
    });
    await service
      .from("drip_enrollments")
      .update({
        next_run_at: defer.toISOString(),
        locked_at: null,
        steps_log: log as unknown as NonNullable<Json>,
      })
      .eq("id", e.id);
    return "deferred";
  }
  const secret = linkSecret(serverEnv());
  const customer = ctx.recipients.customer;
  if (secret && customer?.id && (customer.kind === "contact" || customer.kind === "lead")) {
    ctx.merge.unsubscribe = {
      link: appUrl(
        `/u/${unsubscribeToken({ kind: customer.kind, id: customer.id, orgId: e.org_id }, secret)}`,
      ),
    };
  }
  const lines: string[] = [];
  let ok = false;
  for (const p of plans) {
    if (p.blocked) {
      lines.push(p.blocked);
      continue;
    }
    const rendered = renderSend(p, ctx.merge, settings.footer);
    if (rendered.missing.length) {
      lines.push(`Missing ${rendered.missing.join(", ")}.`);
      continue;
    }
    await recordOutbound(service, {
      orgId: e.org_id,
      channel: p.channel,
      to: (p.channel === "sms" ? p.recipient?.mobile : p.recipient?.email) as string,
      subject: rendered.subject,
      body: rendered.body,
      messageType: p.messageType,
      related: ctx.thread
        ? { type: ctx.thread.subjectType, id: ctx.thread.subjectId }
        : { type: e.subject_type, id: e.subject_id },
      thread: ctx.thread ?? undefined,
      templateKey: step.template_key,
      templateStatus: p.template?.status ?? null,
    });
    ok = true;
    lines.push(`${p.channel === "sms" ? "Text" : "Email"} recorded (simulated).`);
  }
  log.push({
    step: e.current_step,
    at: now.toISOString(),
    outcome: ok ? "sent" : "blocked",
    detail: lines.join(" "),
  });
  const next = nextDripStep(steps, e.current_step + 1, now);
  if (!next) {
    await end(service, e, "completed", null, now, log);
    return ok ? "sent" : "completed";
  }
  await service
    .from("drip_enrollments")
    .update({
      current_step: next.index,
      next_run_at: next.at.toISOString(),
      last_step_at: now.toISOString(),
      locked_at: null,
      steps_log: log as unknown as NonNullable<Json>,
    })
    .eq("id", e.id);
  return ok ? "sent" : "blocked";
}
