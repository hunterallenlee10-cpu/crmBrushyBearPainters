import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { nextDripStep, validateDripSteps } from "@/lib/domain/drips";
import { allHold, describeCondition, firstFailing } from "@/lib/domain/workflows/conditions";
import { getWorkflow, workflowsForEvent } from "@/lib/domain/workflows/catalog";
import {
  matchTrigger,
  planNotify,
  planSend,
  planTask,
  renderSend,
  shouldExit,
  simulateWorkflow,
  waitUntil,
  type SendPlan,
  type Simulation,
} from "@/lib/domain/workflows/plan";
import {
  SETTABLE_FIELDS,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowTrigger,
} from "@/lib/domain/workflows/types";
import { serverEnv } from "@/lib/env";
import { generateProposalToken, proposalUrl } from "@/lib/estimating/tokens";
import { getCalendarProvider } from "@/lib/integrations/calendar";
import { createSupabaseOutboxSink, toJsonObject } from "@/lib/integrations/outbox-sink";
import { logError } from "@/lib/log";
import {
  appUrl,
  loadMessagingSettings,
  loadTemplateLookup,
  recordOutbound,
  type MessagingSettings,
} from "@/lib/messaging/core";
import { jobIdForAggregate, loadRunContext, type LoadedContext } from "./context";

type Db = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["events"]["Row"];
type RunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];

/**
 * The workflow engine (SPEC §11.1), server side. Pure decisions come from
 * lib/domain/workflows; this file performs them.
 *
 * - One run per (workflow, event): the run row is inserted first with a
 *   unique idempotency key, so the inline dispatch (right after Publish, a
 *   daily log, a rain delay) and the worker can't both send.
 * - Waits and quiet-hours deferrals park the run (`waiting`, `resume_at`);
 *   the worker resumes it. Exit rules are checked on every resume.
 * - A turned-off workflow records a skipped run, so turning it back on later
 *   never replays old events.
 * - A failed step stops the run (no automatic retry, which could send twice);
 *   Admin → Workflows can retry it from the failed step.
 */

export type StepLog = {
  index: number;
  id: string;
  kind: WorkflowAction["kind"];
  label: string;
  at: string;
  outcome: "done" | "skipped" | "blocked" | "failed" | "waiting" | "deferred";
  detail: string;
  messageIds?: string[];
  outboxIds?: string[];
  until?: string;
};

export type RunOutcome = {
  workflowKey: string;
  runId: string | null;
  status: RunRow["status"] | "not_matched" | "duplicate";
  sent: number;
  deferredUntil: string | null;
  detail: string;
};

const asSteps = (v: Json): StepLog[] => (Array.isArray(v) ? (v as unknown as StepLog[]) : []);

function payloadOf(e: Pick<EventRow, "payload">): Record<string, Json | undefined> {
  return e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
    ? (e.payload as Record<string, Json | undefined>)
    : {};
}

async function subjectIdFor(
  service: Db,
  def: WorkflowDefinition,
  trigger: WorkflowTrigger,
  event: Pick<EventRow, "aggregate_type" | "aggregate_id" | "payload">,
): Promise<string | null> {
  const payload = payloadOf(event);
  if (trigger.subjectFrom && trigger.subjectFrom !== "aggregate") {
    const v = payload[trigger.subjectFrom.payload];
    if (typeof v === "string") return v;
  }
  if (!event.aggregate_id) return null;
  if (def.subject === "job" && event.aggregate_type !== "job") {
    return jobIdForAggregate(service, event.aggregate_type, event.aggregate_id);
  }
  return event.aggregate_id;
}

type Engine = {
  service: Db;
  settings: MessagingSettings;
  templates: Awaited<ReturnType<typeof loadTemplateLookup>>;
};

async function engineFor(service: Db, orgId: string): Promise<Engine> {
  const [settings, templates] = await Promise.all([
    loadMessagingSettings(service, orgId),
    loadTemplateLookup(service, orgId),
  ]);
  return { service, settings, templates };
}

async function switches(service: Db, orgId: string) {
  const { data } = await service.from("workflows").select("id, key, enabled").eq("org_id", orgId);
  return new Map((data ?? []).map((w) => [w.key, w]));
}

/** Runs every workflow listening to this event (idempotent per workflow and event). */
export async function runWorkflowsForEvent(
  service: Db,
  event: EventRow,
  now = new Date(),
): Promise<RunOutcome[]> {
  if (!event.org_id) return [];
  const defs = workflowsForEvent(event.type);
  if (!defs.length) return [];
  const orgId = event.org_id;
  const sw = await switches(service, orgId);
  const engine = await engineFor(service, orgId);
  const out: RunOutcome[] = [];
  for (const def of defs) {
    try {
      out.push(await startRun(engine, def, sw.get(def.key) ?? null, event, now));
    } catch (e) {
      logError(`workflow.${def.key}`, e);
      out.push({
        workflowKey: def.key,
        runId: null,
        status: "failed",
        sent: 0,
        deferredUntil: null,
        detail: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
  return out;
}

async function startRun(
  engine: Engine,
  def: WorkflowDefinition,
  sw: { id: string; enabled: boolean } | null,
  event: EventRow,
  now: Date,
): Promise<RunOutcome> {
  const { service } = engine;
  const orgId = event.org_id as string;
  const notMatched = (detail: string): RunOutcome => ({
    workflowKey: def.key,
    runId: null,
    status: "not_matched",
    sent: 0,
    deferredUntil: null,
    detail,
  });
  if (!sw) return notMatched("The workflow isn't set up for this company.");
  const candidates = def.triggers.filter((t) => t.event === event.type);
  const trigger = candidates[0];
  if (!trigger) return notMatched("Not listening.");
  const subjectId = await subjectIdFor(service, def, trigger, event);
  if (!subjectId) return notMatched("No record for this event.");
  const ctx = await loadRunContext(
    service,
    orgId,
    { type: def.subject, id: subjectId },
    { type: event.type, payload: payloadOf(event) },
    { now, customerThreadHours: engine.settings.customerThreadHours, dryRun: false },
  );
  if (!ctx) return notMatched("The record is gone.");
  const match = matchTrigger(def, event.type, ctx.facts);
  if (!match.matched) return notMatched(match.reason);

  const insert = {
    org_id: orgId,
    workflow_id: sw.id,
    workflow_key: def.key,
    event_id: event.id,
    event_type: event.type,
    idempotency_key: `${def.key}:${event.id}`,
    subject_type: def.subject,
    subject_id: subjectId,
    input: toJsonObject({
      event: {
        id: event.id,
        type: event.type,
        aggregate_id: event.aggregate_id,
        payload: payloadOf(event),
      },
      subject: { type: def.subject, id: subjectId },
    }),
    status: (sw.enabled ? "running" : "skipped") as RunRow["status"],
    locked_at: sw.enabled ? now.toISOString() : null,
    result: sw.enabled ? null : "The workflow is turned off, so nothing was sent.",
    finished_at: sw.enabled ? null : now.toISOString(),
  };
  const { data: run, error } = await service
    .from("workflow_runs")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return {
        workflowKey: def.key,
        runId: null,
        status: "duplicate",
        sent: 0,
        deferredUntil: null,
        detail: "Already ran for this event.",
      };
    }
    throw error;
  }
  if (!sw.enabled) {
    return {
      workflowKey: def.key,
      runId: run.id,
      status: "skipped",
      sent: 0,
      deferredUntil: null,
      detail: insert.result ?? "",
    };
  }
  return continueRun(engine, def, run, ctx, now);
}

/** Worker: resume runs whose wait is over. */
export async function resumeDueRuns(service: Db, now = new Date(), limit = 100) {
  const { data, error } = await service.rpc("claim_workflow_runs", { p_limit: limit });
  if (error) throw error;
  let resumed = 0;
  let failed = 0;
  const engines = new Map<string, Engine>();
  for (const run of data ?? []) {
    try {
      const def = getWorkflow(run.workflow_key);
      if (!def) {
        await finish(
          service,
          run.id,
          asSteps(run.steps),
          "canceled",
          "This workflow no longer exists.",
          now,
        );
        continue;
      }
      const sw = (await switches(service, run.org_id)).get(def.key);
      if (!sw?.enabled) {
        await finish(
          service,
          run.id,
          asSteps(run.steps),
          "canceled",
          "The workflow was turned off before this step.",
          now,
        );
        continue;
      }
      let engine = engines.get(run.org_id);
      if (!engine) {
        engine = await engineFor(service, run.org_id);
        engines.set(run.org_id, engine);
      }
      const input = run.input as { event?: { type?: string; payload?: Record<string, Json> } };
      const ctx = await loadRunContext(
        service,
        run.org_id,
        { type: def.subject, id: run.subject_id ?? "" },
        { type: input.event?.type ?? run.event_type, payload: input.event?.payload ?? {} },
        { now, customerThreadHours: engine.settings.customerThreadHours, dryRun: false },
      );
      if (!ctx) {
        await finish(service, run.id, asSteps(run.steps), "canceled", "The record is gone.", now);
        continue;
      }
      await continueRun(engine, def, run, ctx, now);
      resumed++;
    } catch (e) {
      failed++;
      logError(`workflow.resume.${run.workflow_key}`, e);
      await service
        .from("workflow_runs")
        .update({
          status: "failed",
          locked_at: null,
          error: e instanceof Error ? e.message.slice(0, 1000) : "Unknown error",
          finished_at: now.toISOString(),
        })
        .eq("id", run.id);
    }
  }
  return { claimed: (data ?? []).length, resumed, failed };
}

async function finish(
  service: Db,
  runId: string,
  steps: StepLog[],
  status: "completed" | "failed" | "canceled",
  result: string | null,
  now: Date,
  error?: string,
) {
  const { error: e } = await service
    .from("workflow_runs")
    .update({
      status,
      steps: steps as unknown as NonNullable<Json>,
      result: result?.slice(0, 1000) ?? null,
      error: error?.slice(0, 1000) ?? null,
      locked_at: null,
      resume_at: null,
      wait_reason: null,
      finished_at: now.toISOString(),
    })
    .eq("id", runId);
  if (e) throw e;
}

async function park(
  service: Db,
  runId: string,
  steps: StepLog[],
  nextStep: number,
  until: Date,
  reason: string,
) {
  const { error } = await service
    .from("workflow_runs")
    .update({
      status: "waiting",
      steps: steps as unknown as NonNullable<Json>,
      next_step: nextStep,
      resume_at: until.toISOString(),
      wait_reason: reason.slice(0, 300),
      locked_at: null,
    })
    .eq("id", runId);
  if (error) throw error;
}

async function save(service: Db, runId: string, steps: StepLog[], nextStep: number) {
  const { error } = await service
    .from("workflow_runs")
    .update({ steps: steps as unknown as NonNullable<Json>, next_step: nextStep })
    .eq("id", runId);
  if (error) throw error;
}

async function continueRun(
  engine: Engine,
  def: WorkflowDefinition,
  run: RunRow,
  ctx: LoadedContext,
  now: Date,
): Promise<RunOutcome> {
  const { service } = engine;
  const steps = asSteps(run.steps);
  let i = run.next_step;
  let sent = 0;
  const outcome = (
    status: RunOutcome["status"],
    detail: string,
    deferredUntil: string | null = null,
  ): RunOutcome => ({
    workflowKey: def.key,
    runId: run.id,
    status,
    sent,
    deferredUntil,
    detail,
  });

  if (i > 0) {
    const exit = shouldExit(def, ctx.facts);
    if (exit) {
      await finish(service, run.id, steps, "completed", exit, now);
      return outcome("completed", exit);
    }
  }

  let skipNext = false;
  while (i < def.actions.length) {
    const action = def.actions[i] as WorkflowAction;
    const base = {
      index: i,
      id: action.id,
      kind: action.kind,
      label: action.label,
      at: now.toISOString(),
    };
    const prev = steps.findIndex((s) => s.index === i);
    const record = (s: StepLog) => {
      if (prev >= 0) steps[prev] = s;
      else steps.push(s);
    };

    if (skipNext) {
      skipNext = false;
      record({ ...base, outcome: "skipped", detail: "Skipped: its time had already passed." });
      i++;
      continue;
    }
    if (!allHold(action.when, ctx.facts)) {
      const f = firstFailing(action.when, ctx.facts);
      record({
        ...base,
        outcome: "skipped",
        detail: `Skipped: ${f ? describeCondition(f) : "a condition"} is not true.`,
      });
      i++;
      continue;
    }

    try {
      if (action.kind === "wait") {
        const started =
          prev >= 0 && steps[prev]?.outcome === "waiting" && steps[prev]?.until
            ? steps[prev]
            : null;
        let until: Date | null = null;
        if (action.until) {
          const w = waitUntil(action, ctx.facts, now, engine.settings.engine);
          if (w.kind === "missing") {
            record({ ...base, outcome: "skipped", detail: `Can't wait: ${w.description}` });
            if (action.ifPast === "skip_next") skipNext = true;
            i++;
            continue;
          }
          until = w.until;
        } else if (started?.until) {
          until = new Date(started.until);
        } else {
          const w = waitUntil(action, ctx.facts, now, engine.settings.engine);
          until = w.kind === "until" ? w.until : now;
        }
        if (until.getTime() > now.getTime()) {
          record({
            ...base,
            outcome: "waiting",
            detail: `Waiting until ${until.toISOString()}.`,
            until: until.toISOString(),
          });
          await park(service, run.id, steps, i, until, action.label);
          return outcome("waiting", action.label, until.toISOString());
        }
        if (!started) {
          record({ ...base, outcome: "skipped", detail: "That time had already passed." });
          if (action.ifPast === "skip_next") skipNext = true;
        } else {
          record({
            ...base,
            outcome: "done",
            detail: `Waited until ${until.toISOString()}.`,
            until: until.toISOString(),
          });
          // The record may have changed while we waited.
          const exit = shouldExit(def, ctx.facts);
          if (exit) {
            await finish(service, run.id, steps, "completed", exit, now);
            return outcome("completed", exit);
          }
        }
        i++;
        continue;
      }

      if (action.kind === "send") {
        const plans = planSend(action, ctx, engine.templates, now, engine.settings.engine);
        const defer = plans.find((p) => !p.blocked && p.deferUntil)?.deferUntil;
        if (defer) {
          record({
            ...base,
            outcome: "deferred",
            detail: `Quiet hours: waits until ${defer.toISOString()}.`,
            until: defer.toISOString(),
          });
          await park(service, run.id, steps, i, defer, "Quiet hours");
          return outcome("waiting", "Quiet hours", defer.toISOString());
        }
        const r = await executeSend(engine, def, run.id, action, plans, ctx, now);
        sent += r.messageIds.length + r.staffOutbox;
        record({
          ...base,
          outcome: r.sentAny ? "done" : "blocked",
          detail: r.detail,
          messageIds: r.messageIds,
          outboxIds: r.outboxIds,
        });
        await save(service, run.id, steps, i + 1);
        i++;
        continue;
      }

      const detail = await executeOther(engine, def, action, ctx, now);
      record({ ...base, outcome: detail.ok ? "done" : "blocked", detail: detail.detail });
      await save(service, run.id, steps, i + 1);
      i++;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      record({ ...base, outcome: "failed", detail: message });
      await service
        .from("workflow_runs")
        .update({
          status: "failed",
          steps: steps as unknown as NonNullable<Json>,
          next_step: i,
          error: message.slice(0, 1000),
          locked_at: null,
          finished_at: now.toISOString(),
        })
        .eq("id", run.id);
      logError(`workflow.${def.key}.${action.id}`, e);
      return outcome("failed", message);
    }
  }
  const blocked = steps.filter((s) => s.outcome === "blocked").length;
  const summary = blocked
    ? `Done; ${blocked} step${blocked === 1 ? "" : "s"} couldn't run.`
    : "Done.";
  await finish(service, run.id, steps, "completed", summary, now);
  const why = steps
    .filter((s) => s.outcome === "blocked")
    .map((s) => s.detail)
    .join(" · ");
  return outcome("completed", why || summary);
}

// --- Sends -----------------------------------------------------------------------------

function hashToken(t: string) {
  return createHash("sha256").update(t).digest("hex");
}

/** A fresh proposal link for the estimate's current version (the stored token is only a hash). */
async function mintEstimateLink(service: Db, ctx: LoadedContext): Promise<string | null> {
  const e = ctx.estimate;
  if (!e?.versionId) return null;
  const { token, hash } = generateProposalToken();
  const { error } = await service.from("proposal_tokens").insert({
    org_id: ctx.orgId,
    job_id: e.jobId,
    estimate_version_id: e.versionId,
    token_hash: hash,
    expires_at: e.expiresAt ?? new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
  });
  if (error) throw error;
  return proposalUrl(serverEnv().APP_URL, token);
}

/** The review request for the job (one per job) with a fresh tracked link. */
async function prepareReview(
  service: Db,
  ctx: LoadedContext,
  runId: string,
): Promise<{ id: string; link: string } | null> {
  if (!ctx.jobId) return null;
  const token = randomBytes(24).toString("base64url");
  const { data, error } = await service
    .from("review_requests")
    .upsert(
      {
        org_id: ctx.orgId,
        job_id: ctx.jobId,
        contact_id: ctx.recipients.customer?.kind === "contact" ? ctx.recipients.customer.id : null,
        workflow_run_id: runId,
        token_hash: hashToken(token),
        status: "sent",
      },
      { onConflict: "job_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, link: appUrl(`/r/${token}`) };
}

/** The customer's Bear Champion code (made on first invite). */
async function ensureChampion(service: Db, ctx: LoadedContext): Promise<string | null> {
  const c = ctx.recipients.customer;
  if (c?.kind !== "contact" || !c.id) return null;
  const { data: existing } = await service
    .from("referral_champions")
    .select("code, status")
    .eq("org_id", ctx.orgId)
    .eq("contact_id", c.id)
    .maybeSingle();
  if (existing) return existing.status === "active" ? existing.code : null;
  const { data, error } = await service
    .from("referral_champions")
    .insert({ org_id: ctx.orgId, contact_id: c.id, invited_at: new Date().toISOString() })
    .select("code")
    .single();
  if (error) throw error;
  return data.code;
}

async function executeSend(
  engine: Engine,
  def: WorkflowDefinition,
  runId: string,
  action: Extract<WorkflowAction, { kind: "send" }>,
  plans: SendPlan[],
  ctx: LoadedContext,
  now: Date,
) {
  const { service } = engine;
  const messageIds: string[] = [];
  const outboxIds: string[] = [];
  let staffOutbox = 0;
  const lines: string[] = [];
  const usable = plans.filter((p) => !p.blocked);
  let reviewId: string | null = null;

  if (usable.length && action.prepare) {
    if (action.prepare === "estimate_link") {
      const link = await mintEstimateLink(service, ctx);
      if (link) (ctx.merge.estimate as Record<string, Json>).link = link;
    } else if (action.prepare === "review_link") {
      const r = await prepareReview(service, ctx, runId);
      if (r) {
        reviewId = r.id;
        ctx.merge.review = { link: r.link };
      }
    } else if (action.prepare === "referral_code") {
      const code = await ensureChampion(service, ctx);
      if (code) ctx.merge.referral = { ...(ctx.merge.referral as Record<string, Json>), code };
    }
  }

  for (const p of plans) {
    const ch = p.channel === "sms" ? "Text" : "Email";
    if (p.blocked) {
      lines.push(`${ch} not sent: ${p.blocked}`);
      continue;
    }
    const rendered = renderSend(p, ctx.merge, engine.settings.footer);
    if (rendered.missing.length) {
      lines.push(`${ch} not sent: missing ${rendered.missing.map((m) => `{{${m}}}`).join(", ")}.`);
      continue;
    }
    const to = (p.channel === "sms" ? p.recipient?.mobile : p.recipient?.email) as string;
    const customer = action.to === "customer";
    const r = await recordOutbound(service, {
      orgId: ctx.orgId,
      channel: p.channel,
      to,
      subject: rendered.subject,
      body: rendered.body,
      messageType: p.messageType,
      related:
        customer && ctx.thread
          ? { type: ctx.thread.subjectType, id: ctx.thread.subjectId }
          : {
              type: def.subject,
              id: String(
                (ctx.merge.subcontractor as { id?: string } | undefined)?.id ??
                  ctx.jobId ??
                  ctx.leadId ??
                  "",
              ),
            },
      thread: customer && ctx.thread ? ctx.thread : undefined,
      templateKey: action.template,
      templateStatus: p.template?.status ?? null,
      workflowRunId: runId,
    });
    outboxIds.push(r.outboxId);
    if (r.messageId) messageIds.push(r.messageId);
    else staffOutbox++;
    lines.push(`${ch} recorded (simulated) to ${p.recipient?.name ?? to}.`);
  }
  const sentAny = outboxIds.length > 0;

  // Record the send on the record that caused it.
  if (action.record === "daily_log_update") {
    const logId = (ctx.merge.daily_log as { id?: string } | undefined)?.id;
    if (logId) {
      const patch = sentAny
        ? {
            customer_update_status: "simulated",
            customer_message_id: messageIds[0] ?? null,
            sent_at: now.toISOString(),
            customer_update_note: null,
          }
        : {
            customer_update_status: "skipped",
            customer_update_note: lines.join(" ").slice(0, 500),
          };
      await service
        .from("daily_logs")
        .update(patch)
        .eq("id", logId)
        .eq("customer_update_status", "draft");
    }
  }
  if (action.record === "rain_delay_message" && messageIds[0]) {
    const id = (ctx.merge.rain_delay as { id?: string } | undefined)?.id;
    if (id)
      await service.from("rain_delays").update({ customer_message_id: messageIds[0] }).eq("id", id);
  }
  if (reviewId) {
    await service
      .from("review_requests")
      .update(
        sentAny
          ? {
              status: "sent",
              sent_at: now.toISOString(),
              message_id: messageIds[0] ?? null,
              channel: plans.find((p) => !p.blocked)?.channel ?? null,
              skipped_reason: null,
            }
          : { status: "skipped", skipped_reason: lines.join(" ").slice(0, 500) },
      )
      .eq("id", reviewId);
  }
  return { sentAny, messageIds, outboxIds, staffOutbox, detail: lines.join(" · ") };
}

// --- Other actions ---------------------------------------------------------------------

function linkFor(def: WorkflowDefinition, ctx: LoadedContext): string {
  if (ctx.jobId) return `/jobs/${ctx.jobId}`;
  if (ctx.leadId) return `/leads/${ctx.leadId}`;
  const sub = (ctx.merge.subcontractor as { id?: string } | undefined)?.id;
  if (sub) return `/admin/subcontractors?id=${sub}`;
  return `/admin/workflows/${def.key}`;
}

async function executeOther(
  engine: Engine,
  def: WorkflowDefinition,
  action: Exclude<WorkflowAction, { kind: "send" | "wait" }>,
  ctx: LoadedContext,
  now: Date,
): Promise<{ ok: boolean; detail: string }> {
  const { service } = engine;
  switch (action.kind) {
    case "notify": {
      const n = planNotify(action, ctx, engine.templates);
      if ("blocked" in n) return { ok: false, detail: n.blocked };
      const { error } = await service.from("notifications").insert(
        n.to.map((p) => ({
          org_id: ctx.orgId,
          user_id: p.id,
          type: action.notificationType,
          title: n.title || action.label,
          body: n.body || null,
          link: linkFor(def, ctx),
        })),
      );
      if (error) throw error;
      return { ok: true, detail: `Told ${n.to.map((p) => p.name).join(", ")}.` };
    }
    case "task": {
      const t = planTask(action, ctx, now);
      if (!t.assignee) return { ok: false, detail: "Nobody to give the task to." };
      const subject = ctx.jobId
        ? { subject_type: "job", subject_id: ctx.jobId }
        : ctx.leadId
          ? { subject_type: "lead", subject_id: ctx.leadId }
          : {};
      const { error } = await service.from("tasks").insert({
        org_id: ctx.orgId,
        ...subject,
        title: t.title,
        due_at: t.dueAt.toISOString(),
        assignee_id: t.assignee.id,
        priority: t.priority,
        created_by_workflow: def.key,
      });
      if (error) throw error;
      return { ok: true, detail: `Task for ${t.assignee.name}: “${t.title}”.` };
    }
    case "attention": {
      const subjectType = ctx.jobId ? "job" : ctx.leadId ? "lead" : null;
      const subjectId = ctx.jobId ?? ctx.leadId;
      if (!subjectType || !subjectId)
        return { ok: false, detail: "No lead or job to attach it to." };
      const { error } = await service.from("attention_items").insert({
        org_id: ctx.orgId,
        rule_key: "workflow",
        category: action.category,
        priority: action.priority,
        title: action.title.slice(0, 200),
        subject_type: subjectType,
        subject_id: subjectId,
        dedupe_key: `workflow:${def.key}:${action.id}:${subjectId}`,
      });
      if (error && error.code !== "23505") throw error;
      return { ok: true, detail: "Attention item opened." };
    }
    case "hold": {
      if (!ctx.jobId) return { ok: false, detail: "Holds are on jobs." };
      if (action.mode === "add") {
        const { error } = await service.from("job_holds").insert({
          org_id: ctx.orgId,
          job_id: ctx.jobId,
          hold_type: action.holdType,
          reason: action.reason,
        });
        if (error) throw error;
        return { ok: true, detail: `${action.holdType} hold placed.` };
      }
      const { error } = await service
        .from("job_holds")
        .update({ released_at: now.toISOString(), release_note: action.reason })
        .eq("job_id", ctx.jobId)
        .eq("hold_type", action.holdType)
        .is("released_at", null);
      if (error) throw error;
      return { ok: true, detail: `${action.holdType} hold released.` };
    }
    case "set_field": {
      const spec = SETTABLE_FIELDS[action.field];
      const value =
        typeof action.value === "string"
          ? action.value
          : new Date(now.getTime() + action.value.days * 24 * 3_600_000).toISOString().slice(0, 10);
      if (spec.values && !(spec.values as readonly string[]).includes(value)) {
        return { ok: false, detail: `${value} isn't allowed for ${action.field}.` };
      }
      const id = spec.table === "jobs" ? ctx.jobId : ctx.leadId;
      if (!id) return { ok: false, detail: "No record to change." };
      const { error } =
        action.field === "job.priority"
          ? await service.from("jobs").update({ priority: value }).eq("id", id)
          : action.field === "lead.status"
            ? await service.from("leads").update({ status: value }).eq("id", id)
            : await service.from("leads").update({ nurture_until: value }).eq("id", id);
      if (error) throw error;
      return { ok: true, detail: `${action.field} set to ${value}.` };
    }
    case "enroll_drip": {
      const subjectId =
        action.subject === "lead"
          ? ctx.leadId
          : action.subject === "job"
            ? ctx.jobId
            : ctx.recipients.customer?.kind === "contact"
              ? ctx.recipients.customer.id
              : null;
      if (!subjectId) return { ok: false, detail: `No ${action.subject} to enroll.` };
      const { data: drip } = await service
        .from("drips")
        .select("id, name, steps, active, archived_at")
        .eq("org_id", ctx.orgId)
        .eq("key", action.drip)
        .maybeSingle();
      if (!drip || !drip.active || drip.archived_at)
        return { ok: false, detail: `The drip “${action.drip}” is off.` };
      const { steps } = validateDripSteps(drip.steps);
      const next = nextDripStep(steps, 0, now);
      if (!next) return { ok: false, detail: "The drip has no steps." };
      const { error } = await service.from("drip_enrollments").insert({
        org_id: ctx.orgId,
        drip_id: drip.id,
        subject_type: action.subject,
        subject_id: subjectId,
        current_step: next.index,
        next_run_at: next.at.toISOString(),
        source: "workflow",
      });
      if (error) {
        if (error.code === "23505") return { ok: true, detail: `Already in “${drip.name}”.` };
        throw error;
      }
      return {
        ok: true,
        detail: `Enrolled in “${drip.name}” (first step ${next.at.toISOString()}).`,
      };
    }
    case "assign_owner": {
      if (!ctx.leadId) return { ok: false, detail: "Only leads are assigned this way." };
      const { data: lead } = await service
        .from("leads")
        .select("owner_id, territory_id")
        .eq("id", ctx.leadId)
        .maybeSingle();
      if (!lead || lead.owner_id) return { ok: true, detail: "Already has an owner." };
      const { data: people } = await service.rpc("users_with_permission", {
        p_org: ctx.orgId,
        p_permission: "estimates:send",
      });
      const ids = (people ?? []).map((p) => p.id);
      if (!ids.length) return { ok: false, detail: "Nobody can take leads yet." };
      const { data: profs } = await service
        .from("profiles")
        .select("id, full_name, default_territory_id")
        .in("id", ids);
      const inTerritory = (profs ?? []).filter(
        (p) => lead.territory_id && p.default_territory_id === lead.territory_id,
      );
      const pool = inTerritory.length ? inTerritory : (profs ?? []);
      const since = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();
      const { data: recent } = await service
        .from("leads")
        .select("owner_id")
        .eq("org_id", ctx.orgId)
        .gte("created_at", since)
        .in(
          "owner_id",
          pool.map((p) => p.id),
        );
      const load = new Map(pool.map((p) => [p.id, 0]));
      for (const r of recent ?? [])
        if (r.owner_id) load.set(r.owner_id, (load.get(r.owner_id) ?? 0) + 1);
      const pick = [...pool].sort(
        (a, b) =>
          (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.full_name.localeCompare(b.full_name),
      )[0];
      if (!pick) return { ok: false, detail: "Nobody to assign." };
      const { error } = await service
        .from("leads")
        .update({ owner_id: pick.id })
        .eq("id", ctx.leadId)
        .is("owner_id", null);
      if (error) throw error;
      (ctx.merge.lead as Record<string, Json>).owner_id = pick.id;
      ctx.people.lead_owner = [{ id: pick.id, name: pick.full_name }];
      return {
        ok: true,
        detail: `Assigned to ${pick.full_name}${inTerritory.length ? " (territory)" : ""}.`,
      };
    }
    case "calendar": {
      const a = ctx.merge.appointment as
        | { id?: string; start?: string; end?: string; location?: string | null; type?: string }
        | undefined;
      if (!a?.id || !a.start || !a.end) return { ok: false, detail: "No appointment." };
      const provider = getCalendarProvider({
        orgId: ctx.orgId,
        actorId: null,
        sink: createSupabaseOutboxSink(service),
      });
      const r = await provider.upsertEvent({
        calendarId: "primary",
        title: `Walkthrough: ${String((ctx.merge.contact as { full_name?: string } | undefined)?.full_name ?? "customer")}`,
        start: a.start,
        end: a.end,
        location: a.location ?? undefined,
        related: { type: "appointment", id: a.id },
      });
      return { ok: true, detail: `Calendar event recorded in the outbox (${r.status}).` };
    }
    case "webhook":
      return { ok: false, detail: "Webhooks are turned off in this build." };
  }
}

// --- Dry run and retry -----------------------------------------------------------------

export type DryRunResult = Simulation & { contextFound: boolean };

/**
 * Admin → Workflows → Test: what this workflow would do for a record, at a
 * chosen time, without sending anything. The test is logged as a dry-run row.
 */
export async function dryRunWorkflow(
  service: Db,
  input: { orgId: string; key: string; subjectId: string; at?: Date; actorId: string | null },
): Promise<DryRunResult> {
  const def = getWorkflow(input.key);
  if (!def) throw new Error("Unknown workflow.");
  const now = input.at ?? new Date();
  const engine = await engineFor(service, input.orgId);
  const trigger = def.triggers[0] as WorkflowTrigger;
  const payload: Record<string, Json> = { ...(trigger.testPayload ?? {}) };
  if (def.key === "rain_delay") {
    const { data: rd } = await service
      .from("rain_delays")
      .select("id, delay_date, notify_customer")
      .eq("job_id", input.subjectId)
      .order("delay_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    payload.rain_delay_id = rd?.id ?? null;
    payload.date = rd?.delay_date ?? now.toISOString().slice(0, 10);
    payload.notify_customer = true;
  }
  if (def.key === "schedule_published") {
    const { data: e } = await service
      .from("schedule_entries")
      .select("starts_on, ends_on, crew_id")
      .eq("job_id", input.subjectId)
      .order("starts_on")
      .limit(1)
      .maybeSingle();
    payload.starts_on = e?.starts_on ?? null;
    payload.ends_on = e?.ends_on ?? null;
    payload.crew_id = e?.crew_id ?? null;
    payload.crew_changes = e?.starts_on ? `- ${e.starts_on} to ${e.ends_on}` : null;
  }
  const ctx = await loadRunContext(
    service,
    input.orgId,
    { type: def.subject, id: input.subjectId },
    { type: trigger.event, payload },
    { now, customerThreadHours: engine.settings.customerThreadHours, dryRun: true },
  );
  if (!ctx) {
    return {
      matched: false,
      reason: "That record isn't available.",
      steps: [],
      endsAt: now.toISOString(),
      contextFound: false,
    };
  }
  if (def.key === "rain_delay" && !payload.rain_delay_id) {
    ctx.merge.rain_delay = { date: payload.date as string, notify_customer: true };
  }
  const sim = simulateWorkflow(def, ctx, {
    now,
    settings: engine.settings.engine,
    templates: engine.templates,
    footer: engine.settings.footer,
    eventType: trigger.event,
  });
  const { data: sw } = await service
    .from("workflows")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("key", def.key)
    .maybeSingle();
  if (sw) {
    await service.from("workflow_runs").insert({
      org_id: input.orgId,
      workflow_id: sw.id,
      workflow_key: def.key,
      event_type: trigger.event,
      idempotency_key: `dry:${def.key}:${randomBytes(8).toString("hex")}`,
      subject_type: def.subject,
      subject_id: input.subjectId,
      status: "dry_run",
      dry_run: true,
      input: toJsonObject({ at: now.toISOString(), payload }),
      steps: sim.steps as unknown as NonNullable<Json>,
      result: sim.matched ? `Dry run: ${sim.steps.length} steps.` : sim.reason,
      finished_at: new Date().toISOString(),
      created_by: input.actorId,
    });
  }
  return { ...sim, contextFound: true };
}

/** Retry a failed run from the step that failed (Admin → Workflows → run). */
export async function retryRun(service: Db, runId: string) {
  const { data: run } = await service
    .from("workflow_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();
  if (!run || run.status !== "failed") return false;
  const { error } = await service
    .from("workflow_runs")
    .update({
      status: "waiting",
      resume_at: new Date().toISOString(),
      wait_reason: "Retry",
      error: null,
      finished_at: null,
    })
    .eq("id", runId);
  if (error) throw error;
  return true;
}

/** Find a just-emitted event (for inline dispatch right after the database wrote it). */
export async function findEvent(
  service: Db,
  type: string,
  aggregateId: string,
  match?: (payload: Record<string, Json | undefined>) => boolean,
): Promise<EventRow | null> {
  const { data } = await service
    .from("events")
    .select("*")
    .eq("type", type)
    .eq("aggregate_id", aggregateId)
    .order("id", { ascending: false })
    .limit(5);
  return (data ?? []).find((e) => !match || match(payloadOf(e))) ?? null;
}

/** Run the workflows for one event right away (the worker would get to it within a minute). */
export async function dispatchNow(
  service: Db,
  event: EventRow | null,
  now = new Date(),
): Promise<RunOutcome[]> {
  if (!event) return [];
  return runWorkflowsForEvent(service, event, now);
}

/** Plain words for what a customer-notice workflow did (for toasts after Publish, rain delays, daily logs). */
export function noticeOutcome(run: RunOutcome | undefined): {
  sent: boolean;
  queued: boolean;
  note: string | null;
} {
  if (!run) return { sent: false, queued: false, note: "No workflow handled it." };
  if (run.status === "skipped")
    return { sent: false, queued: false, note: "The workflow is turned off, so nothing was sent." };
  if (run.status === "duplicate") return { sent: true, queued: false, note: null };
  if (run.status === "waiting" && run.deferredUntil) {
    const when = new Date(run.deferredUntil).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    return run.sent > 0
      ? { sent: true, queued: false, note: null }
      : { sent: false, queued: true, note: `Queued until ${when} (quiet hours).` };
  }
  if (run.status === "failed") return { sent: false, queued: false, note: run.detail };
  if (run.status === "not_matched") return { sent: false, queued: false, note: run.detail };
  return run.sent > 0
    ? { sent: true, queued: false, note: null }
    : { sent: false, queued: false, note: run.detail };
}
