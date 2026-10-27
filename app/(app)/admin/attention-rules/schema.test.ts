import { describe, expect, it } from "vitest";
import { ATTENTION_RULES, type AttentionRuleKey } from "@/lib/domain/attention/rules";
import {
  RULE_SOURCES,
  THRESHOLD_SPECS,
  ruleErrors,
  saveAttentionRulesSchema,
  thresholdError,
} from "./schema";

const keys = Object.keys(ATTENTION_RULES) as AttentionRuleKey[];

describe("attention rule specs", () => {
  it("label every threshold and explain every rule without one", () => {
    for (const k of keys) {
      const t = Object.keys(ATTENTION_RULES[k].thresholds);
      if (t.length === 0) expect(RULE_SOURCES[k], k).toBeTruthy();
      for (const name of t) expect(THRESHOLD_SPECS[k]?.[name]?.label, `${k}.${name}`).toBeTruthy();
    }
  });

  it("defaults sit inside their allowed ranges", () => {
    for (const k of keys) {
      const t = ATTENTION_RULES[k].thresholds as Record<string, number>;
      expect(ruleErrors(k, t), k).toEqual({});
    }
  });
});

describe("thresholdError", () => {
  it("checks numbers, whole numbers and ranges", () => {
    expect(thresholdError("walkthrough_unconfirmed", "cutoff_hour", 17)).toBeNull();
    expect(thresholdError("walkthrough_unconfirmed", "cutoff_hour", 24)).toBe("Use 0 to 23.");
    expect(thresholdError("onboarding_stalled", "days", 0)).toBe("Use 1 to 365.");
    expect(thresholdError("onboarding_stalled", "days", 2.5)).toBe("Use a whole number.");
    expect(thresholdError("onboarding_stalled", "days", null)).toBe("Enter a number.");
  });
});

describe("ruleErrors", () => {
  it("keeps aging steps in order", () => {
    expect(ruleErrors("aging_lead", { medium_days: 8, high_days: 7, stale_days: 14 })).toEqual({
      high_days: "High must be the same as Medium or later.",
    });
    expect(ruleErrors("aging_lead", { medium_days: 3, high_days: 20, stale_days: 14 })).toEqual({
      stale_days: "Stale must be the same as High or later.",
    });
  });
});

describe("saveAttentionRulesSchema", () => {
  it("accepts a valid save", () => {
    const r = saveAttentionRulesSchema.safeParse({
      rules: [
        { rule_key: "onboarding_stalled", enabled: false, thresholds: { days: 10 } },
        { rule_key: "untouched_lead", enabled: true, thresholds: {} },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("refuses unknown rules, extra thresholds, duplicates and out-of-range values", () => {
    const bad = [
      [{ rule_key: "nope", enabled: true, thresholds: {} }],
      [{ rule_key: "onboarding_stalled", enabled: true, thresholds: { days: 7, hours: 1 } }],
      [
        { rule_key: "onboarding_stalled", enabled: true, thresholds: { days: 7 } },
        { rule_key: "onboarding_stalled", enabled: false, thresholds: { days: 7 } },
      ],
      [{ rule_key: "approval_pending", enabled: true, thresholds: { hours: 721 } }],
    ];
    for (const rules of bad)
      expect(saveAttentionRulesSchema.safeParse({ rules }).success).toBe(false);
  });
});
