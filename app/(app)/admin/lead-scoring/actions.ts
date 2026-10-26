"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { OPEN_LEAD_STATUSES } from "@/lib/domain/leads/constants";
import { rescoreLead } from "@/lib/leads/service";
import { logError } from "@/lib/log";
import { RECALCULATE_LIMIT, recalculateSchema, saveScoringRulesSchema } from "./schema";

/**
 * Saves changed lead-scoring weights. Only rows whose points or active flag
 * changed are written; audit rows and `lead_scoring_rule.*` events come from
 * the table's database triggers. RLS allows updates only with settings:manage.
 */
export const saveScoringRules = defineAction({
  name: "lead_scoring.save",
  schema: saveScoringRulesSchema,
  permissions: ["settings:manage"],
  handler: async ({ rules }, { supabase }) => {
    const current = check(
      await supabase
        .from("lead_scoring_rules")
        .select("id, factor, points, active")
        .in(
          "id",
          rules.map((r) => r.id),
        ),
    );
    const byId = new Map((current ?? []).map((r) => [r.id, r]));
    const changed = rules.filter((r) => {
      const now = byId.get(r.id);
      if (!now || now.factor !== r.factor) {
        throw new ActionFailure({
          code: "not_found",
          message: "One of these rules no longer exists. Reload the page and try again.",
        });
      }
      return now.points !== r.points || now.active !== r.active;
    });

    for (const r of changed) {
      const rows = check(
        await supabase
          .from("lead_scoring_rules")
          .update({ points: r.points, active: r.active })
          .eq("id", r.id)
          .select("id"),
      );
      if (!rows || rows.length === 0) {
        throw new ActionFailure({
          code: "forbidden",
          message: "You don't have permission to change lead scoring.",
        });
      }
    }
    revalidatePath("/admin/lead-scoring");
    return { updated: changed.length };
  },
});

const CONCURRENCY = 8;

/**
 * Rescores open leads with the saved weights (newest first, at most
 * RECALCULATE_LIMIT). Uses the user client, so RLS decides which leads the
 * owner may read and update; each update is audited like any other edit.
 */
export const recalculateOpenLeads = defineAction({
  name: "lead_scoring.recalculate",
  schema: recalculateSchema,
  permissions: ["settings:manage", "leads:update"],
  handler: async (_input, { supabase }) => {
    const leads = check(
      await supabase
        .from("leads")
        .select("id")
        .in("status", [...OPEN_LEAD_STATUSES])
        .order("created_at", { ascending: false })
        .limit(RECALCULATE_LIMIT),
    );
    const ids = (leads ?? []).map((l) => l.id);
    const now = new Date();
    let rescored = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const results = await Promise.allSettled(
        ids.slice(i, i + CONCURRENCY).map((id) => rescoreLead(supabase, id, now)),
      );
      for (const r of results) {
        if (r.status === "fulfilled") rescored++;
        else {
          failed++;
          if (failed <= 3) logError("lead_scoring.recalculate.lead", r.reason);
        }
      }
    }
    revalidatePath("/leads");
    revalidatePath("/leads/list");
    return { rescored, failed, capped: ids.length >= RECALCULATE_LIMIT };
  },
});
