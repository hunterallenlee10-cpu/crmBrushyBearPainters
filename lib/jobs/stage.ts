import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import type { Viewer } from "@/lib/auth/viewer";
import {
  OVERRIDE_REASON_MIN,
  checkTransition,
  type GateContext,
  type TransitionCheck,
} from "@/lib/domain/jobs/gates";
import { getStage, isJobStageId, type JobStageId } from "@/lib/domain/stages";
import { checklistSummary, shortLabel } from "@/lib/domain/onboarding/checklist";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { pacificToday } from "@/lib/domain/scheduling/dates";

type Db = SupabaseClient<Database>;

/**
 * advanceJobStage(): the only code path that changes a job's stage (SPEC §6.2).
 * Checks permission and the gate here (for clear messages), then calls the
 * service-role-only database function, which enforces the same rules again,
 * writes stage_history and emits job.stage_changed.
 */

/** Facts the gates read, loaded with the service client after a visibility check. */
export async function loadGateContext(service: Db, jobId: string): Promise<GateContext> {
  const [
    walk,
    holds,
    labels,
    estimates,
    deposit,
    signatures,
    onboarding,
    entries,
    paint,
    workOrders,
    punch,
    finalWalk,
    signoff,
  ] = await Promise.all([
    service
      .from("appointments")
      .select("id")
      .eq("job_id", jobId)
      .eq("type", "walkthrough")
      .eq("status", "completed")
      .eq("result", "measured")
      .is("deleted_at", null)
      .limit(1),
    service
      .from("job_holds")
      .select("hold_type")
      .eq("job_id", jobId)
      .is("released_at", null)
      .eq("blocks_scheduling", true),
    service
      .from("picklist_values")
      .select("value, label, picklists!inner(key)")
      .eq("picklists.key", "hold_type"),
    service
      .from("estimates")
      .select(
        "id, status, accepted_version_id, versions:estimate_versions!estimate_versions_estimate_id_fkey(id, sent_at, accepted_totals)",
      )
      .eq("job_id", jobId)
      .is("deleted_at", null),
    service
      .from("invoices")
      .select("id")
      .eq("job_id", jobId)
      .eq("invoice_type", "deposit")
      .neq("status", "void")
      .limit(1),
    service
      .from("signatures")
      .select("estimate_version_id")
      .eq("job_id", jobId)
      .not("estimate_version_id", "is", null),
    service
      .from("onboarding_requirements")
      .select("key, label, group_key, required, status, verified_auto")
      .eq("job_id", jobId),
    service
      .from("schedule_entries")
      .select("starts_on")
      .eq("job_id", jobId)
      .eq("status", "published")
      .order("starts_on", { ascending: true })
      .limit(1),
    service
      .from("paint_orders")
      .select("po_number, status")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .not("status", "in", "(picked_up,delivered,canceled)"),
    service
      .from("work_orders")
      .select("status")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .neq("status", "canceled"),
    service
      .from("punch_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "open")
      .is("deleted_at", null),
    service
      .from("appointments")
      .select("id")
      .eq("job_id", jobId)
      .eq("type", "final_walkthrough")
      .eq("status", "completed")
      .is("deleted_at", null)
      .limit(1),
    service.from("punch_signoffs").select("id").eq("job_id", jobId).limit(1),
  ]);
  const label = new Map((labels.data ?? []).map((v) => [v.value, v.label]));
  const ests = estimates.data ?? [];
  const accepted = ests.filter((e) => e.status === "accepted" && e.accepted_version_id);
  const signedVersions = new Set((signatures.data ?? []).map((s) => s.estimate_version_id));
  const signed = accepted.some((e) => signedVersions.has(e.accepted_version_id));
  const noDeposit = accepted.some((e) => {
    const v = (e.versions ?? []).find((x) => x.id === e.accepted_version_id);
    const totals = v?.accepted_totals;
    const deposit =
      totals && typeof totals === "object" && !Array.isArray(totals) ? totals.depositCents : null;
    return typeof deposit === "number" ? deposit === 0 : deposit == null;
  });
  return {
    walkthroughMeasured: (walk.data ?? []).length > 0,
    estimateSent: ests.some((e) => (e.versions ?? []).some((v) => v.sent_at !== null)),
    estimateSigned: signed,
    depositInvoiceReady: (deposit.data ?? []).length > 0 || noDeposit,
    blockingHolds: (holds.data ?? []).map((h) => label.get(h.hold_type) ?? h.hold_type),
    schedulePublished: (entries.data ?? []).length > 0,
    firstPublishedStart: entries.data?.[0]?.starts_on ?? null,
    today: pacificToday(new Date()),
    materialsOpen: (paint.data ?? []).map((p) => p.po_number),
    workOrders: {
      total: (workOrders.data ?? []).length,
      open: (workOrders.data ?? []).filter((w) => w.status !== "completed").length,
    },
    punch: {
      open: punch.count ?? 0,
      finalWalkthroughDone: (finalWalk.data ?? []).length > 0,
      signedOff: (signoff.data ?? []).length > 0,
    },
    onboardingOpen: onboarding.data?.length
      ? checklistSummary(
          onboarding.data.map((r) => ({
            key: r.key,
            label: r.label,
            group: r.group_key,
            required: r.required,
            status: r.status,
            verifiedAuto: r.verified_auto,
          })),
        ).open.map((o) => shortLabel(o.key, o.label))
      : null,
  };
}

export type AdvanceInput = {
  jobId: string;
  toStage: JobStageId;
  /** Owner override: allowed only with job_admin:override and a reason. */
  override?: boolean;
  reason?: string | null;
  lostReason?: string | null;
  approvalRequestId?: string | null;
};

export type AdvanceResult = {
  historyId: string;
  from: JobStageId;
  to: JobStageId;
  overridden: boolean;
};

/** Explains whether `viewer` can move the job (for the Advance button / dialog). */
export async function previewTransition(
  supabase: Db,
  service: Db,
  jobId: string,
  toStage: JobStageId,
  lostReason?: string | null,
): Promise<{ from: JobStageId; check: TransitionCheck; context: GateContext } | null> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, stage")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !isJobStageId(job.stage)) return null;
  const context = await loadGateContext(service, jobId);
  return {
    from: job.stage,
    check: checkTransition(job.stage, toStage, context, { lostReason }),
    context,
  };
}

export async function advanceJobStage(
  input: AdvanceInput,
  ctx: { viewer: Viewer; supabase: Db; service: () => Promise<Db> },
): Promise<AdvanceResult> {
  const { viewer, supabase } = ctx;
  if (!viewer.can("jobs:advance_stage")) {
    throw new ActionFailure(
      actionError("forbidden", "You don't have permission to move job stages."),
    );
  }
  // Visibility: the person must be able to open the job.
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, stage")
    .eq("id", input.jobId)
    .maybeSingle();
  if (error) throw new ActionFailure(mapDbError(error));
  if (!job || !isJobStageId(job.stage))
    throw new ActionFailure(actionError("not_found", "That job isn't available."));
  const from = job.stage;

  const service = await ctx.service();
  if (from === "onboarding" && input.toStage === "ready_to_schedule") {
    // Fresh onboarding results before the gate reads them (imported lazily:
    // the checks module moves jobs forward through this one).
    const { reverifyJob } = await import("@/lib/onboarding/checks");
    await reverifyJob(service, input.jobId, { advance: false }).catch((e: unknown) =>
      logError("jobs.advance.reverify", e),
    );
  }
  const context = await loadGateContext(service, input.jobId);
  const check = checkTransition(from, input.toStage, context, { lostReason: input.lostReason });
  const wantsOverride = input.override === true;

  if (check.blockedByHolds || check.needsLostReason || (!check.allowed && !check.overridable)) {
    throw new ActionFailure(actionError("validation", check.reasons.join(" ")));
  }
  if (!check.allowed) {
    if (!wantsOverride) {
      throw new ActionFailure(actionError("validation", check.reasons.join(" ")));
    }
    if (!viewer.can("job_admin:override")) {
      throw new ActionFailure(
        actionError(
          "forbidden",
          "Only owners can override a stage gate. Ask for approval instead.",
        ),
      );
    }
    if ((input.reason ?? "").trim().length < OVERRIDE_REASON_MIN) {
      throw new ActionFailure(
        actionError("validation", "Say why you're overriding (at least 10 characters).", {
          reason: ["Say why you're overriding (at least 10 characters)."],
        }),
      );
    }
  }
  const overridden = !check.allowed;

  const { data: historyId, error: rpcError } = await service.rpc("apply_job_stage_change", {
    p_job: input.jobId,
    p_from: from,
    p_to: input.toStage,
    p_override: overridden,
    p_reason: input.reason?.trim() || undefined,
    p_lost_reason: input.lostReason ?? undefined,
    p_gate: {
      kind: check.kind,
      passed: check.allowed,
      reasons: check.reasons,
      context,
    } as unknown as Json,
    p_approval_request: input.approvalRequestId ?? undefined,
  });
  if (rpcError || !historyId) throw new ActionFailure(mapDbError(rpcError));

  try {
    await recomputeJobHealth(service, [input.jobId]);
  } catch (e) {
    logError("jobs.advance.health", e);
  }
  return { historyId, from, to: input.toStage, overridden };
}

/**
 * Moves a job forward on behalf of the system or a person when its gate
 * passes on its own (walkthrough measured; auto-close after Paid in Full).
 * Never overrides. Returns false (without throwing) when the move isn't allowed.
 */
export async function advanceIfGatePasses(
  service: Db,
  jobId: string,
  from: JobStageId,
  to: JobStageId,
): Promise<boolean> {
  const context = await loadGateContext(service, jobId);
  const check = checkTransition(from, to, context);
  if (!check.allowed) return false;
  const { error } = await service.rpc("apply_job_stage_change", {
    p_job: jobId,
    p_from: from,
    p_to: to,
    p_gate: { kind: check.kind, passed: true, reasons: [], context, auto: true } as unknown as Json,
  });
  if (error) {
    logError(`jobs.auto_advance.${getStage(to).id}`, error);
    return false;
  }
  await recomputeJobHealth(service, [jobId]).catch((e: unknown) =>
    logError("jobs.auto_advance.health", e),
  );
  return true;
}
