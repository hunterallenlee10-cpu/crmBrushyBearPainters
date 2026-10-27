import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import type { Viewer } from "@/lib/auth/viewer";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Convert lead → job (SPEC §6.1). Checks that the person may edit the lead and
 * create jobs, then runs the atomic database conversion (service role), which
 * reuses a matching contact, account and property and moves notes, comments,
 * tasks and the walkthrough to the new job.
 */
export async function convertLeadToJob(
  leadId: string,
  ctx: { viewer: Viewer; supabase: Db; service: () => Promise<Db> },
  opts: { workTypes?: string[] | null } = {},
): Promise<{ jobId: string }> {
  const { viewer, supabase } = ctx;
  if (!viewer.can("jobs:create")) {
    throw new ActionFailure(actionError("forbidden", "You don't have permission to create jobs."));
  }
  if (!viewer.can("leads:update")) {
    throw new ActionFailure(
      actionError("forbidden", "You don't have permission to convert this lead."),
    );
  }
  // Edit rights on this lead: a no-op update only succeeds when row security allows it.
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, status, converted_job_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new ActionFailure(mapDbError(error));
  if (!lead) throw new ActionFailure(actionError("not_found", "That lead isn't available."));
  if (lead.converted_job_id) {
    throw new ActionFailure(actionError("conflict", "This lead is already a job."));
  }
  const { data: editable, error: editError } = await supabase
    .from("leads")
    .update({ status: lead.status })
    .eq("id", leadId)
    .select("id");
  if (editError) throw new ActionFailure(mapDbError(editError));
  if (!editable?.length) {
    throw new ActionFailure(actionError("forbidden", "You can only convert leads you can edit."));
  }

  const service = await ctx.service();
  const { data: jobId, error: rpcError } = await service.rpc("convert_lead_to_job", {
    p_lead: leadId,
    p_work_types: opts.workTypes ?? undefined,
  });
  if (rpcError || !jobId) throw new ActionFailure(mapDbError(rpcError));
  await recomputeJobHealth(service, [jobId]).catch((e: unknown) =>
    logError("jobs.convert.health", e),
  );
  return { jobId };
}
