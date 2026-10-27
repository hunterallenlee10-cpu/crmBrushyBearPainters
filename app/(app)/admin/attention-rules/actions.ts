"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import type { Json } from "@/lib/db/types";
import { saveAttentionRulesSchema } from "./schema";

/**
 * Saves changed attention rules (enabled + thresholds). Only rows that changed
 * are written, with the person's own session (row security allows it only with
 * settings:manage). Audit rows and `attention_rule.updated` events come from
 * the table's triggers. The worker reads the rules on its next run (every minute).
 */
export const saveAttentionRules = defineAction({
  name: "attention_rules.save",
  schema: saveAttentionRulesSchema,
  permissions: ["settings:manage"],
  handler: async ({ rules }, { supabase }) => {
    const current = check(
      await supabase
        .from("attention_rules")
        .select("rule_key, enabled, thresholds")
        .in(
          "rule_key",
          rules.map((r) => r.rule_key),
        ),
    );
    const byKey = new Map((current ?? []).map((r) => [r.rule_key, r]));
    const changed: { rule_key: string; enabled: boolean; thresholds: Record<string, Json> }[] = [];
    for (const r of rules) {
      const now = byKey.get(r.rule_key);
      if (!now) {
        throw new ActionFailure(
          actionError(
            "not_found",
            "One of these rules isn't set up for your company yet. Reload the page and tell an owner.",
          ),
        );
      }
      const existing =
        now.thresholds && typeof now.thresholds === "object" && !Array.isArray(now.thresholds)
          ? (now.thresholds as Record<string, Json>)
          : {};
      const merged: Record<string, Json> = { ...existing, ...r.thresholds };
      const same =
        now.enabled === r.enabled &&
        Object.keys(r.thresholds).every((k) => existing[k] === r.thresholds[k]);
      if (!same) changed.push({ rule_key: r.rule_key, enabled: r.enabled, thresholds: merged });
    }

    for (const r of changed) {
      const rows = check(
        await supabase
          .from("attention_rules")
          .update({ enabled: r.enabled, thresholds: r.thresholds })
          .eq("rule_key", r.rule_key)
          .select("rule_key"),
      );
      if (!rows?.length) {
        throw new ActionFailure(
          actionError("forbidden", "You don't have permission to change attention rules."),
        );
      }
    }
    revalidatePath("/admin/attention-rules");
    return { updated: changed.length };
  },
});
