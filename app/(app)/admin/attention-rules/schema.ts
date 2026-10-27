import { z } from "zod";
import {
  ATTENTION_RULES,
  isAttentionRuleKey,
  type AttentionRuleKey,
} from "@/lib/domain/attention/rules";

/**
 * Admin → Attention Rules (SPEC §9: thresholds are editable). Plain labels,
 * units and allowed ranges for every threshold, shared by the form and the
 * Server Action. Pure, unit-tested.
 */

export type ThresholdSpec = {
  label: string;
  unit: "days" | "hours" | "hour";
  min: number;
  max: number;
  help?: string;
};

const DAYS = { unit: "days", min: 1, max: 365 } as const;

/** Per rule, per threshold key. Every key in ATTENTION_RULES[rule].thresholds has an entry. */
export const THRESHOLD_SPECS: Partial<Record<AttentionRuleKey, Record<string, ThresholdSpec>>> = {
  aging_lead: {
    medium_days: { ...DAYS, label: "Medium after (days)" },
    high_days: { ...DAYS, label: "High after (days)" },
    stale_days: { ...DAYS, label: "Stale after (days)", help: "Shown as “N+ days” in the title." },
  },
  walkthrough_unconfirmed: {
    cutoff_hour: {
      label: "Cutoff hour (Pacific, 0–23)",
      unit: "hour",
      min: 0,
      max: 23,
      help: "The day before the walkthrough. 17 = 5 PM.",
    },
  },
  approval_pending: {
    hours: { label: "Waiting longer than (hours)", unit: "hours", min: 0, max: 720 },
  },
  sold_no_deposit: {
    days: { label: "Days after sold", unit: "days", min: 0, max: 365 },
  },
  onboarding_stalled: {
    days: { ...DAYS, label: "Days in Onboarding" },
  },
  ready_not_scheduled: {
    days: { ...DAYS, label: "Days in Ready to Schedule" },
  },
};

/** Where the numbers come from for rules without editable thresholds. */
export const RULE_SOURCES: Partial<Record<AttentionRuleKey, string>> = {
  untouched_lead: "Uses the text-back SLA in Company Settings",
  estimate_sla: "Uses the estimate SLA warning and breach hours in Company Settings",
  start_date_missed:
    "No threshold: it counts as soon as a promised start date passes with no actual start.",
};

export function thresholdSpec(rule: AttentionRuleKey, key: string): ThresholdSpec {
  return (
    THRESHOLD_SPECS[rule]?.[key] ?? {
      label: key.replace(/_/g, " "),
      unit: "days",
      min: 0,
      max: 365,
    }
  );
}

export function thresholdKeys(rule: AttentionRuleKey): string[] {
  return Object.keys(ATTENTION_RULES[rule].thresholds);
}

/** Validates one threshold value; returns an error message or null. */
export function thresholdError(
  rule: AttentionRuleKey,
  key: string,
  value: number | null,
): string | null {
  const spec = thresholdSpec(rule, key);
  if (value === null || !Number.isFinite(value)) return "Enter a number.";
  if (!Number.isInteger(value)) return "Use a whole number.";
  if (value < spec.min || value > spec.max) return `Use ${spec.min} to ${spec.max}.`;
  return null;
}

/** Cross-field rules: aging steps must go up (medium ≤ high ≤ stale). */
export function ruleErrors(
  rule: AttentionRuleKey,
  thresholds: Record<string, number | null>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of thresholdKeys(rule)) {
    const e = thresholdError(rule, key, thresholds[key] ?? null);
    if (e) errors[key] = e;
  }
  if (rule === "aging_lead" && Object.keys(errors).length === 0) {
    const { medium_days: m, high_days: h, stale_days: s } = thresholds as Record<string, number>;
    if (m! > h!) errors.high_days = "High must be the same as Medium or later.";
    else if (h! > s!) errors.stale_days = "Stale must be the same as High or later.";
  }
  return errors;
}

export const saveAttentionRulesSchema = z
  .object({
    rules: z
      .array(
        z.object({
          rule_key: z.string().refine(isAttentionRuleKey, "Unknown rule."),
          enabled: z.boolean(),
          thresholds: z.record(z.string(), z.number()),
        }),
      )
      .min(1)
      .max(Object.keys(ATTENTION_RULES).length),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rules.forEach((r, i) => {
      if (seen.has(r.rule_key)) {
        ctx.addIssue({
          code: "custom",
          message: "Each rule can only appear once.",
          path: ["rules", i],
        });
      }
      seen.add(r.rule_key);
      if (!isAttentionRuleKey(r.rule_key)) return;
      const expected = thresholdKeys(r.rule_key).sort();
      const given = Object.keys(r.thresholds).sort();
      if (expected.join(",") !== given.join(",")) {
        ctx.addIssue({
          code: "custom",
          message: "Thresholds don't match this rule. Reload the page.",
          path: ["rules", i, "thresholds"],
        });
        return;
      }
      for (const [key, msg] of Object.entries(ruleErrors(r.rule_key, r.thresholds))) {
        ctx.addIssue({ code: "custom", message: msg, path: ["rules", i, "thresholds", key] });
      }
    });
  });
export type SaveAttentionRulesInput = z.input<typeof saveAttentionRulesSchema>;
