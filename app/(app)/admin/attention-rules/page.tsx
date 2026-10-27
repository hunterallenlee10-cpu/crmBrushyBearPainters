import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  ATTENTION_RULES,
  CATEGORY_LABELS,
  type AttentionRuleKey,
} from "@/lib/domain/attention/rules";
import { AttentionRulesEditor, type EditableAttentionRule } from "./attention-rules-editor";
import { RULE_SOURCES, thresholdKeys, thresholdSpec } from "./schema";

export const metadata: Metadata = { title: "Attention Rules" };

/** Admin → Attention Rules (SPEC §9, §8.19): turn rules on or off and set thresholds. */
export default async function AttentionRulesPage() {
  const viewer = await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const [rulesRes, settingsRes] = await Promise.all([
    supabase.from("attention_rules").select("rule_key, enabled, thresholds"),
    supabase
      .from("company_settings")
      .select("text_back_sla_minutes, estimate_sla_hours, estimate_sla_warn_hours")
      .maybeSingle(),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  const saved = new Map((rulesRes.data ?? []).map((r) => [r.rule_key, r]));
  const s = settingsRes.data;

  const sourceNote = (key: AttentionRuleKey): string | null => {
    const base = RULE_SOURCES[key];
    if (!base) return null;
    if (key === "untouched_lead" && s) {
      return `${base} (now ${s.text_back_sla_minutes} business minutes).`;
    }
    if (key === "estimate_sla" && s) {
      return `${base} (now a warning at ${s.estimate_sla_warn_hours} h and a breach at ${s.estimate_sla_hours} h).`;
    }
    return base.endsWith(".") ? base : `${base}.`;
  };

  const rules: EditableAttentionRule[] = (Object.keys(ATTENTION_RULES) as AttentionRuleKey[]).map(
    (key) => {
      const def = ATTENTION_RULES[key];
      const row = saved.get(key);
      const stored =
        row?.thresholds && typeof row.thresholds === "object" && !Array.isArray(row.thresholds)
          ? (row.thresholds as Record<string, unknown>)
          : {};
      const defaults = def.thresholds as Record<string, number>;
      return {
        key,
        label: def.label,
        category: CATEGORY_LABELS[def.category],
        description: def.description,
        configured: row !== undefined,
        enabled: row?.enabled ?? true,
        source: sourceNote(key),
        linksToCompany: key === "untouched_lead" || key === "estimate_sla",
        thresholds: thresholdKeys(key).map((name) => {
          const v = stored[name];
          const spec = thresholdSpec(key, name);
          return {
            name,
            label: spec.label,
            help: spec.help ?? null,
            min: spec.min,
            max: spec.max,
            value: typeof v === "number" && Number.isFinite(v) ? v : (defaults[name] ?? 0),
            defaultValue: defaults[name] ?? 0,
          };
        }),
      };
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attention Rules"
        description="What puts an item in the Attention queue, and when. Changes apply on the next check (every minute) and are saved to the audit log."
      />
      <AttentionRulesEditor rules={rules} readOnly={viewer.impersonating} />
    </div>
  );
}
