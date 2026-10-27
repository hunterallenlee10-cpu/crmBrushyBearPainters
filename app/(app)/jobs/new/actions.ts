"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { jobCreateSchema } from "@/lib/validation/jobs";
import { logError } from "@/lib/log";
import { accountRefSchema, accountSearchSchema, searchTerm, type AccountHit } from "./schema";
import { loadAccountChoice } from "./account-choice";

/**
 * New Job (SPEC §8.5): a job without a lead (repeat customers, referrals).
 * Reads and the insert use the person's own session, so row security decides
 * which customers they can pick and whether they may create the job. The
 * database starts every new job at Walkthrough Scheduled, numbers it, writes
 * the first stage history row, the audit row and the `job.created` event.
 */

const SEARCH_LIMIT = 20;

export const searchAccounts = defineAction({
  name: "jobs.new.search_accounts",
  schema: accountSearchSchema,
  permissions: ["jobs:create"],
  handler: async ({ q }, { supabase }): Promise<AccountHit[]> => {
    const term = searchTerm(q);
    if (term.length < 2) return [];
    const rows = check(
      await supabase
        .from("accounts")
        .select("id, display_name, properties(city, is_primary)")
        .ilike("display_name", `%${term}%`)
        .is("deleted_at", null)
        .order("display_name")
        .limit(SEARCH_LIMIT),
    );
    return (rows ?? []).map((a) => {
      const props = a.properties ?? [];
      const primary = props.find((p) => p.is_primary) ?? props[0];
      return { id: a.id, name: a.display_name, city: primary?.city ?? null };
    });
  },
});

export const getAccountChoice = defineAction({
  name: "jobs.new.account",
  schema: accountRefSchema,
  permissions: ["jobs:create"],
  handler: async ({ id }, { supabase }) => {
    const choice = await loadAccountChoice(supabase, id);
    if (!choice)
      throw new ActionFailure(actionError("not_found", "That customer isn't available."));
    return choice;
  },
});

export const createJob = defineAction({
  name: "jobs.create",
  schema: jobCreateSchema,
  permissions: ["jobs:create"],
  handler: async (input, ctx) => {
    const { supabase, viewer } = ctx;
    const canAssign = viewer.can("jobs:assign");
    const ownerId = canAssign ? (input.owner_id ?? viewer.id) : viewer.id;
    if (input.owner_id && input.owner_id !== viewer.id && !canAssign) {
      throw new ActionFailure(
        actionError(
          "forbidden",
          "Only people who can assign jobs can create a job for someone else.",
        ),
      );
    }
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        org_id: viewer.orgId,
        // The database assigns the next BB-YYYY-NNNN number (jobs_guard).
        job_number: "",
        name: input.name,
        account_id: input.account_id,
        property_id: input.property_id,
        primary_contact_id: input.primary_contact_id,
        work_types: input.work_types,
        owner_id: ownerId,
        point_of_contact_id: input.point_of_contact_id,
        lead_source: input.lead_source ?? null,
        priority: input.priority,
        target_season: input.target_season ?? null,
      })
      .select("id, job_number")
      .single();
    // Guard messages (owner, property, contact, picklists) are written for people.
    if (error || !job) throw new ActionFailure(mapDbError(error));

    if (input.notes && viewer.can("notes:write")) {
      const { error: noteError } = await supabase.from("notes").insert({
        org_id: viewer.orgId,
        subject_type: "job",
        subject_id: job.id,
        body: input.notes,
      });
      if (noteError) logError("jobs.create.note", noteError);
    }
    try {
      await recomputeJobHealth(await ctx.service(), [job.id]);
    } catch (e) {
      logError("jobs.create.health", e);
    }
    revalidatePath("/jobs");
    revalidatePath("/jobs/list");
    revalidatePath(`/accounts/${input.account_id}`);
    return { id: job.id, jobNumber: job.job_number };
  },
});
