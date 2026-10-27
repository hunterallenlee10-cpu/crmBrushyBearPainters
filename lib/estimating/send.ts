import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import type { Database } from "@/lib/db/types";
import {
  buildProposalSnapshot,
  discountLimitFor,
  expiresAt as computeExpiry,
  parseDiscountLimits,
  needsDiscountApproval,
  type PricedVersion,
} from "@/lib/estimating/engine";
import { serverEnv } from "@/lib/env";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getEmailProvider } from "@/lib/integrations/email";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import type { IntegrationContext } from "@/lib/integrations/core";
import { getStage, isJobStageId, type JobStageId } from "@/lib/domain/stages";
import { stageOrder } from "@/lib/domain/jobs/gates";
import { recomputeJobHealth } from "@/lib/jobs/health";
import {
  jobContactBlockReason,
  sendJobEmail,
  sendJobSms,
  type JobRecipient,
  type MessagingJob,
  type SentJobMessage,
} from "@/lib/jobs/messaging";
import { advanceIfGatePasses } from "@/lib/jobs/stage";
import { logError } from "@/lib/log";
import { repriceVersion } from "./load";
import { withLink } from "./messages";
import { generateProposalToken, proposalUrl } from "./tokens";

type Db = SupabaseClient<Database>;

/**
 * Sending a proposal (SPEC §7.5, §8.5 "Send"): re-price the draft, check it's
 * complete and within the sender's discount limit (otherwise it needs an
 * owner's approval first), freeze the customer snapshot, create a fresh link,
 * text and/or email it to the job's primary contact through the outbox
 * (simulated, never sent), and move the job to Estimate Sent.
 */

export type Channel = "sms" | "email";

export type SendMessages = {
  channels: readonly Channel[];
  smsBody?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
};

export type SendResult = {
  url: string;
  expiresAt: string;
  messages: Partial<Record<Channel, SentJobMessage>>;
  stage: JobStageId | null;
};

const fail = (message: string, fieldErrors?: Record<string, string[]>) =>
  new ActionFailure(actionError("validation", message, fieldErrors));

/** The job's primary contact and lead Do-Not-Contact, as messaging needs them. */
export async function loadRecipient(
  supabase: Db,
  service: Db,
  job: { id: string; org_id: string; primary_contact_id: string | null; lead_id: string | null },
): Promise<MessagingJob> {
  let contact: JobRecipient | null = null;
  if (job.primary_contact_id) {
    const c = check(
      await supabase
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
  let leadDisposition: string | null = null;
  if (job.lead_id) {
    const { data } = await service
      .from("leads")
      .select("disposition")
      .eq("id", job.lead_id)
      .maybeSingle();
    leadDisposition = data?.disposition ?? null;
  }
  return { id: job.id, orgId: job.org_id, contact, leadDisposition };
}

async function integration(ctx: ActionContext, domain: "sms_voice" | "email") {
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

/** Texts and/or emails a link to the job's customer (outbox only). */
export async function deliverLink(
  ctx: ActionContext,
  recipient: MessagingJob,
  url: string,
  m: SendMessages,
): Promise<Partial<Record<Channel, SentJobMessage>>> {
  const out: Partial<Record<Channel, SentJobMessage>> = {};
  if (m.channels.includes("sms")) {
    const { ic, connectionStatus } = await integration(ctx, "sms_voice");
    const provider = getSmsProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    out.sms = await sendJobSms(ctx.supabase, provider, recipient, withLink(m.smsBody ?? "", url));
  }
  if (m.channels.includes("email")) {
    const { ic, connectionStatus } = await integration(ctx, "email");
    const provider = getEmailProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
    });
    out.email = await sendJobEmail(ctx.supabase, provider, recipient, {
      subject: m.emailSubject?.trim() || "Your estimate",
      body: withLink(m.emailBody ?? "", url),
    });
  }
  return out;
}

/** Checks the chosen channels can reach the customer before anything is frozen. */
export function checkChannels(recipient: MessagingJob, channels: readonly Channel[]): void {
  if (channels.length === 0) throw fail("Pick text, email or both.");
  for (const ch of channels) {
    const reason = jobContactBlockReason(recipient.contact, ch, {
      leadDisposition: recipient.leadDisposition,
    });
    if (reason) throw fail(reason, { channels: [reason] });
  }
}

/** Why a priced version can't go out yet, in plain words (empty when it can). */
export function sendProblems(priced: PricedVersion): string[] {
  return [...new Set(priced.issues.filter((i) => i.severity === "error").map((i) => i.message))];
}

/** The discount (as % of the computed price) this person may send without approval. */
export async function senderDiscountLimit(ctx: ActionContext, orgId: string): Promise<number> {
  const service = await ctx.service();
  const { data } = await service
    .from("estimate_settings")
    .select("discount_limits")
    .eq("org_id", orgId)
    .maybeSingle();
  return discountLimitFor(parseDiscountLimits(data?.discount_limits), {
    userId: ctx.viewer.id,
    roleKey: ctx.viewer.role.key,
    canApprove: ctx.viewer.can("estimates:approve_discount"),
  });
}

/** Moves a job to Estimate Sent after a send (through the gates; never overrides). */
export async function advanceAfterSend(service: Db, jobId: string): Promise<JobStageId | null> {
  const { data: job } = await service.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  if (!job || !isJobStageId(job.stage)) return null;
  let stage: JobStageId = job.stage;
  if (stage === "walkthrough_scheduled") {
    if (await advanceIfGatePasses(service, jobId, stage, "walkthrough_complete")) {
      stage = "walkthrough_complete";
    }
  }
  if (stage === "walkthrough_complete") {
    if (await advanceIfGatePasses(service, jobId, stage, "estimate_sent")) stage = "estimate_sent";
  }
  return stage;
}

export async function sendEstimateVersion(
  input: { versionId: string } & SendMessages,
  ctx: ActionContext,
): Promise<SendResult> {
  // Visibility and edit rights: the person must be able to open and edit the estimate.
  const version = check(
    await ctx.supabase
      .from("estimate_versions")
      .select("id, status, estimate_id, discount_approved_percent")
      .eq("id", input.versionId)
      .maybeSingle(),
  );
  if (!version) throw new ActionFailure(actionError("not_found", "That estimate isn't available."));
  if (version.status !== "draft") {
    throw fail("This version was already sent. Start a new version to send changes.");
  }
  const estimate = check(
    await ctx.supabase
      .from("estimates")
      .select("id, org_id, job_id, estimate_number, status")
      .eq("id", version.estimate_id)
      .maybeSingle(),
  );
  if (!estimate)
    throw new ActionFailure(actionError("not_found", "That estimate isn't available."));
  const job = check(
    await ctx.supabase
      .from("jobs")
      .select("id, org_id, stage, primary_contact_id, lead_id")
      .eq("id", estimate.job_id)
      .maybeSingle(),
  );
  if (!job || !isJobStageId(job.stage)) {
    throw new ActionFailure(actionError("not_found", "That job isn't available."));
  }
  if (job.stage === "closed_won" || job.stage === "closed_lost") {
    throw fail("This job is closed. Reopen it before sending an estimate.");
  }
  if (stageOrder(job.stage) > stageOrder("estimate_sent")) {
    throw fail(
      `This job is already ${getStage(job.stage).label}. Use a change order to change the scope.`,
    );
  }

  const service = await ctx.service();
  const recipient = await loadRecipient(ctx.supabase, service, job);
  checkChannels(recipient, input.channels);

  const repriced = await repriceVersion(service, version.id);
  if (!repriced)
    throw new ActionFailure(actionError("not_found", "That estimate isn't available."));
  const problems = sendProblems(repriced.priced);
  if (problems.length) throw fail(`Fix these first: ${problems.join(" ")}`);

  const limit = await senderDiscountLimit(ctx, estimate.org_id);
  const approved =
    version.discount_approved_percent === null ? null : Number(version.discount_approved_percent);
  if (needsDiscountApproval(repriced.priced.maxEffectiveDiscountPercent, limit, approved)) {
    throw new ActionFailure(
      actionError(
        "forbidden",
        `This estimate is ${repriced.priced.maxEffectiveDiscountPercent}% below the computed price, over your ${limit}% limit. Ask an owner to approve it in Approvals first.`,
      ),
    );
  }

  // Walkthrough first: a job still at Walkthrough Scheduled moves on if its walkthrough is measured.
  if (job.stage === "walkthrough_scheduled") {
    await advanceIfGatePasses(service, job.id, "walkthrough_scheduled", "walkthrough_complete");
    const { data: now } = await service.from("jobs").select("stage").eq("id", job.id).single();
    if (now?.stage === "walkthrough_scheduled") {
      throw fail(
        "Mark the walkthrough completed with the result “Measured” before sending the estimate.",
      );
    }
  }

  const snapshot = buildProposalSnapshot(repriced.input, repriced.priced);
  const recommended =
    repriced.priced.options.find((o) => o.option.isRecommended) ?? repriced.priced.options[0];
  const { token, hash } = generateProposalToken();
  const expires = computeExpiry(new Date(), repriced.context.settings.expiryDays);
  const { error } = await service.rpc("mark_estimate_sent", {
    p_version: version.id,
    p_token_hash: hash,
    p_expires_at: expires.toISOString(),
    p_proposal: JSON.parse(JSON.stringify(snapshot)),
    p_total_cents: recommended?.summary.totalCents ?? 0,
    p_channels: [...input.channels],
  });
  if (error) throw new ActionFailure(mapDbError(error));

  const url = proposalUrl(serverEnv().APP_URL, token);
  const messages = await deliverLink(ctx, recipient, url, input);
  const stage = await advanceAfterSend(service, job.id);
  await recomputeJobHealth(service, [job.id]).catch((e: unknown) =>
    logError("estimates.send.health", e),
  );
  return { url, expiresAt: expires.toISOString(), messages, stage };
}
