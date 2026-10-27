"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AttentionRuleKey } from "@/lib/domain/attention/rules";
import { cn } from "@/lib/utils";
import { saveAttentionRules } from "./actions";
import { ruleErrors } from "./schema";

export type EditableAttentionRule = {
  key: AttentionRuleKey;
  label: string;
  category: string;
  description: string;
  configured: boolean;
  enabled: boolean;
  source: string | null;
  linksToCompany: boolean;
  thresholds: {
    name: string;
    label: string;
    help: string | null;
    min: number;
    max: number;
    value: number;
    defaultValue: number;
  }[];
};

type Draft = { enabled: boolean; text: Record<string, string> };

const toDrafts = (rules: readonly EditableAttentionRule[]): Record<string, Draft> =>
  Object.fromEntries(
    rules.map((r) => [
      r.key,
      {
        enabled: r.enabled,
        text: Object.fromEntries(r.thresholds.map((t) => [t.name, String(t.value)])),
      },
    ]),
  );

function num(text: string | undefined): number | null {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const APPLY_NOTE = "Changes apply on the next check (every minute).";

export function AttentionRulesEditor({
  rules,
  readOnly,
}: {
  rules: readonly EditableAttentionRule[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = React.useState(() => toDrafts(rules));
  const [drafts, setDrafts] = React.useState(() => toDrafts(rules));
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState("");

  const errors = Object.fromEntries(
    rules.map((r) => {
      const d = drafts[r.key];
      const values = Object.fromEntries(r.thresholds.map((t) => [t.name, num(d?.text[t.name])]));
      return [r.key, ruleErrors(r.key, values)];
    }),
  ) as Record<string, Record<string, string>>;
  const invalid = Object.values(errors).some((e) => Object.keys(e).length > 0);
  const changedKeys = rules
    .filter((r) => {
      const a = drafts[r.key];
      const b = baseline[r.key];
      if (!a || !b) return false;
      return (
        a.enabled !== b.enabled ||
        r.thresholds.some((t) => num(a.text[t.name]) !== num(b.text[t.name]))
      );
    })
    .map((r) => r.key);
  const dirty = changedKeys.length > 0;

  const patch = (key: string, next: Partial<Draft>) => {
    setStatus("");
    setDrafts((prev) => {
      const cur = prev[key] ?? { enabled: true, text: {} };
      return { ...prev, [key]: { ...cur, ...next, text: { ...cur.text, ...next.text } } };
    });
  };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || invalid || readOnly) return;
    setSaving(true);
    const payload = rules
      .filter((r) => changedKeys.includes(r.key))
      .map((r) => ({
        rule_key: r.key,
        enabled: drafts[r.key]?.enabled ?? true,
        thresholds: Object.fromEntries(
          r.thresholds.map((t) => [t.name, num(drafts[r.key]?.text[t.name]) ?? t.value]),
        ),
      }));
    const result = await saveAttentionRules({ rules: payload });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      setStatus(result.error.message);
      return;
    }
    setBaseline(drafts);
    const n = result.data.updated;
    const msg = `Attention rules saved (${n} ${n === 1 ? "rule" : "rules"} changed). ${APPLY_NOTE}`;
    toast.success(msg);
    setStatus(msg);
    router.refresh();
  }

  return (
    <form onSubmit={onSave} noValidate className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3" aria-label="Attention rules">
        {rules.map((r) => {
          const d = drafts[r.key] ?? { enabled: r.enabled, text: {} };
          const switchId = `rule-${r.key}-enabled`;
          return (
            <li
              key={r.key}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5",
                !d.enabled && "bg-muted/40",
              )}
              data-testid={`rule-${r.key}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold" id={`rule-${r.key}-title`}>
                      {r.label}
                    </h2>
                    <Badge variant="outline">{r.category}</Badge>
                    {!d.enabled && <Badge variant="neutral">Off</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  <label htmlFor={switchId} className="text-sm text-muted-foreground">
                    {d.enabled ? "On" : "Off"}
                  </label>
                  <Switch
                    id={switchId}
                    checked={d.enabled}
                    disabled={readOnly}
                    onCheckedChange={(v) => patch(r.key, { enabled: v })}
                    aria-label={`Use rule: ${r.label}`}
                  />
                </div>
              </div>

              {r.thresholds.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {r.thresholds.map((t) => {
                    const id = `rule-${r.key}-${t.name}`;
                    const err = errors[r.key]?.[t.name];
                    const describedBy = err ? `${id}-error` : t.help ? `${id}-help` : undefined;
                    return (
                      <div key={t.name} className="flex flex-col gap-1">
                        <label htmlFor={id} className="text-sm font-medium">
                          {t.label}
                        </label>
                        <Input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={t.min}
                          max={t.max}
                          step={1}
                          value={d.text[t.name] ?? ""}
                          disabled={readOnly}
                          onChange={(e) => patch(r.key, { text: { [t.name]: e.target.value } })}
                          aria-invalid={err ? true : undefined}
                          aria-describedby={describedBy}
                          className="h-9 w-28 tabular-nums"
                        />
                        {err ? (
                          <p id={`${id}-error`} role="alert" className="text-xs text-danger">
                            {err}
                          </p>
                        ) : (
                          <p id={`${id}-help`} className="text-xs text-muted-foreground">
                            {t.help ? `${t.help} ` : ""}
                            Default {t.defaultValue}. Allowed {t.min}–{t.max}.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                r.source && (
                  <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                    <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                    <span>
                      {r.source}
                      {r.linksToCompany && (
                        <>
                          {" "}
                          <Link
                            href="/admin/company"
                            className="font-medium text-bb-forest underline"
                          >
                            Open Company Settings
                          </Link>
                        </>
                      )}
                    </span>
                  </p>
                )
              )}
              {!r.configured && (
                <p className="text-xs text-warning">
                  Not set up for your company yet; the defaults apply.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border bg-card/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={!dirty || invalid || saving || readOnly}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save changes
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setDrafts(baseline);
            setStatus("");
          }}
        >
          <RotateCcw aria-hidden />
          Undo changes
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status ||
            (readOnly
              ? "You're viewing as another user. Exit View as user to make changes."
              : invalid
                ? "Fix the highlighted numbers to save."
                : dirty
                  ? `You have unsaved changes. ${APPLY_NOTE}`
                  : APPLY_NOTE)}
        </p>
      </div>
    </form>
  );
}
