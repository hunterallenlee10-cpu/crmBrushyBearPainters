"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { loadJobOptions, labelFor } from "@/lib/jobs/options";
import { isJobStageId, type JobStageId } from "@/lib/domain/stages";
import type { JobPriority, JobStatus } from "@/lib/domain/jobs/constants";

/**
 * Job List: quick preview and bulk assign. Row security limits every read and
 * write; the jobs triggers audit-log the change and emit the domain event.
 * There is deliberately no bulk stage change: stages move only through the
 * job page's Advance flow (advanceJobStage).
 */

export type JobPreview = {
  id: string;
  jobNumber: string;
  name: string;
  stage: JobStageId;
  status: JobStatus;
  priority: JobPriority;
  accountName: string | null;
  contactName: string | null;
  address: string | null;
  workTypes: string[];
  holds: { label: string; reason: string; blocks: boolean }[];
  ownerName: string | null;
  pointOfContactName: string | null;
  projectManagerName: string | null;
  leadSource: string | null;
  startDate: string | null;
  /** undefined = the viewer can't see money. */
  amountCents?: number | null;
  healthScore: number | null;
  createdAt: string;
  stageEnteredAt: string;
};

export const getJobPreview = defineAction({
  name: "jobs.preview",
  permissions: ["jobs:read"],
  schema: z.object({ id: z.uuid() }),
  handler: async ({ id }, { supabase, viewer }): Promise<JobPreview> => {
    const canSeeMoney = viewer.can("financials:read");
    const [jobRes, options, moneyRes] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, job_number, name, stage, status, priority, work_types, lead_source, promised_start_date, health_score, created_at, stage_entered_at, account:accounts!jobs_account_id_fkey(display_name), contact:contacts!jobs_primary_contact_id_fkey(first_name, last_name), property:properties!jobs_property_id_fkey(street, unit, city, state, zip), owner:profiles!jobs_owner_id_fkey(full_name), poc:profiles!jobs_point_of_contact_id_fkey(full_name), pm:profiles!jobs_project_manager_id_fkey(full_name), job_holds(hold_type, reason, blocks_scheduling, released_at)",
        )
        .eq("id", id)
        .is("job_holds.released_at", null)
        .maybeSingle(),
      loadJobOptions(supabase),
      canSeeMoney
        ? supabase
            .from("job_financials")
            .select("contract_baseline_cents")
            .eq("job_id", id)
            .maybeSingle()
        : Promise.resolve(null),
    ]);
    const { data: j, error } = jobRes;
    if (error) throw error;
    if (!j || !isJobStageId(j.stage)) {
      throw new ActionFailure({ code: "not_found", message: "That job isn't available." });
    }
    const p = j.property;
    const address = p
      ? [
          p.street && [p.street, p.unit].filter(Boolean).join(" "),
          p.city,
          [p.state, p.zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      : "";
    return {
      id: j.id,
      jobNumber: j.job_number,
      name: j.name,
      stage: j.stage,
      status: j.status as JobStatus,
      priority: j.priority as JobPriority,
      accountName: j.account?.display_name ?? null,
      contactName: j.contact
        ? [j.contact.first_name, j.contact.last_name].filter(Boolean).join(" ")
        : null,
      address: address || null,
      workTypes: j.work_types.map((w) => labelFor(options.picklists.work_type, w)),
      holds: j.job_holds.map((h) => ({
        label: labelFor(options.picklists.hold_type, h.hold_type),
        reason: h.reason,
        blocks: h.blocks_scheduling,
      })),
      ownerName: j.owner?.full_name ?? null,
      pointOfContactName: j.poc?.full_name ?? null,
      projectManagerName: j.pm?.full_name ?? null,
      leadSource: j.lead_source ? labelFor(options.picklists.lead_source, j.lead_source) : null,
      startDate: j.promised_start_date,
      ...(canSeeMoney ? { amountCents: moneyRes?.data?.contract_baseline_cents ?? null } : {}),
      healthScore: j.health_score,
      createdAt: j.created_at,
      stageEnteredAt: j.stage_entered_at,
    };
  },
});

const bulkAssignJobsSchema = z.object({
  ids: z.array(z.uuid()).min(1, "Select at least one job.").max(200),
  owner_id: z.uuid().nullable(),
});

export const bulkAssignJobs = defineAction({
  name: "jobs.bulk_assign",
  permissions: ["jobs:assign"],
  schema: bulkAssignJobsSchema,
  handler: async ({ ids, owner_id }, { supabase }) => {
    const rows = check(await supabase.from("jobs").update({ owner_id }).in("id", ids).select("id"));
    revalidatePath("/jobs/list");
    revalidatePath("/jobs");
    return { updated: rows?.length ?? 0, skipped: ids.length - (rows?.length ?? 0) };
  },
});
