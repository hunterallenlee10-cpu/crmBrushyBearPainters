"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { GradeBadge } from "@/components/leads/lead-badges";
import { cn } from "@/lib/utils";
import {
  BASE_SCORE,
  scoreLead,
  scoreSummary,
  type LeadScoreInput,
  type ScoringFactor,
} from "@/lib/domain/leads/scoring";
import {
  SERVICES,
  SERVICE_LABELS,
  TIMELINES,
  TIMELINE_LABELS,
  type Service,
  type Timeline,
} from "@/lib/domain/leads/constants";
import { POINTS_MAX, POINTS_MIN, RECALCULATE_LIMIT, scoringPointsSchema } from "./schema";
import { recalculateOpenLeads, saveScoringRules } from "./actions";

export type EditableRule = {
  id: string;
  factor: ScoringFactor;
  label: string;
  points: number;
  active: boolean;
};

type Row = EditableRule & { pointsText: string };

function parsePoints(text: string): { value: number | null; error?: string } {
  if (text.trim() === "") return { value: null, error: "Enter a number." };
  const parsed = scoringPointsSchema.safeParse(Number(text));
  return parsed.success
    ? { value: parsed.data }
    : { value: null, error: parsed.error.issues[0]?.message ?? "Enter a number." };
}

const toRows = (rules: readonly EditableRule[]): Row[] =>
  rules.map((r) => ({ ...r, pointsText: String(r.points) }));

export function LeadScoringEditor({
  rules,
  canRecalculate,
  readOnly,
}: {
  rules: readonly EditableRule[];
  canRecalculate: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<readonly EditableRule[]>(rules);
  const [rows, setRows] = useState<Row[]>(() => toRows(rules));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [recalcPending, startRecalc] = useTransition();
  const [recalcStatus, setRecalcStatus] = useState<string>("");

  const parsed = rows.map((r) => parsePoints(r.pointsText));
  const invalid = parsed.some((p) => p.error);
  const dirty = rows.some((r, i) => {
    const b = baseline.find((x) => x.id === r.id);
    return !b || b.active !== r.active || parsed[i]?.value !== b.points;
  });

  /** Weights for the live example: what is on screen, saved or not. */
  const liveRules = rows.map((r, i) => ({
    factor: r.factor,
    label: r.label,
    points: parsed[i]?.value ?? 0,
    active: r.active,
  }));

  const update = (id: string, patch: Partial<Row>) => {
    setStatus("");
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || !dirty || readOnly) return;
    setSaving(true);
    setStatus("");
    const payload = rows.map((r, i) => ({
      id: r.id,
      factor: r.factor,
      points: parsed[i]?.value ?? 0,
      active: r.active,
    }));
    const result = await saveScoringRules({ rules: payload });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      setStatus(result.error.message);
      return;
    }
    const next = rows.map((r, i) => ({
      id: r.id,
      factor: r.factor,
      label: r.label,
      points: parsed[i]?.value ?? 0,
      active: r.active,
    }));
    setBaseline(next);
    setRows(toRows(next));
    const n = result.data.updated;
    const msg = `Lead scoring saved. ${n} ${n === 1 ? "rule" : "rules"} changed.`;
    toast.success(msg);
    setStatus(msg);
    router.refresh();
  }

  function onReset() {
    setRows(toRows(baseline));
    setStatus("");
  }

  function onRecalculate() {
    setRecalcStatus("");
    startRecalc(async () => {
      const result = await recalculateOpenLeads({});
      if (!result.ok) {
        toast.error(result.error.message);
        setRecalcStatus(result.error.message);
        return;
      }
      const { rescored, failed, capped } = result.data;
      const parts = [
        `Rescored ${rescored.toLocaleString("en-US")} open ${rescored === 1 ? "lead" : "leads"}.`,
        failed > 0 ? `${failed} could not be rescored; they update the next time they change.` : "",
        capped
          ? `Only the newest ${RECALCULATE_LIMIT.toLocaleString("en-US")} were rescored; run it again for older ones.`
          : "",
      ].filter(Boolean);
      const msg = parts.join(" ");
      toast.success(msg);
      setRecalcStatus(msg);
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <form onSubmit={onSave} className="rounded-2xl border bg-card p-5" noValidate>
          <div className="mb-3">
            <h2 className="text-base font-semibold">Rules</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Points from {POINTS_MIN} to {POINTS_MAX}. Negative points lower the score.
            </p>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Lead scoring rules</caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="py-2 pr-2 text-left font-medium">
                  Rule
                </th>
                <th scope="col" className="w-24 px-2 py-2 text-left font-medium">
                  Points
                </th>
                <th scope="col" className="w-16 py-2 pl-2 text-left font-medium">
                  Active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => {
                const err = parsed[i]?.error;
                const inputId = `points-${r.factor}`;
                return (
                  <tr key={r.id} className={cn(!r.active && "text-muted-foreground")}>
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      <label htmlFor={inputId}>{r.label}</label>
                      {err && (
                        <p id={`${inputId}-error`} className="text-xs text-danger" role="alert">
                          {err}
                        </p>
                      )}
                    </th>
                    <td className="px-2 py-2">
                      <Input
                        id={inputId}
                        type="number"
                        inputMode="numeric"
                        min={POINTS_MIN}
                        max={POINTS_MAX}
                        step={1}
                        value={r.pointsText}
                        disabled={readOnly}
                        onChange={(e) => update(r.id, { pointsText: e.target.value })}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${inputId}-error` : undefined}
                        className="h-8 w-20 tabular-nums"
                      />
                    </td>
                    <td className="py-2 pl-2">
                      <Switch
                        checked={r.active}
                        disabled={readOnly}
                        onCheckedChange={(v) => update(r.id, { active: v })}
                        aria-label={`Use rule: ${r.label}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!dirty || invalid || saving || readOnly}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              Save changes
            </Button>
            <Button type="button" variant="outline" onClick={onReset} disabled={!dirty || saving}>
              <RotateCcw aria-hidden />
              Undo changes
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {status || (dirty ? "You have unsaved changes." : "")}
            </p>
          </div>
        </form>

        <section
          aria-labelledby="recalc-title"
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <div>
            <h2 id="recalc-title" className="text-base font-semibold">
              Recalculate open leads
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Existing scores don&apos;t change on their own when you save. Each lead picks up the
              new weights the next time it changes (a new note, text, edit…). To apply them to every
              open lead now, recalculate: up to {RECALCULATE_LIMIT.toLocaleString("en-US")} of the
              newest New, Contacted, Walkthrough Scheduled and Nurture leads.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRecalculate}
              disabled={!canRecalculate || recalcPending || dirty}
            >
              {recalcPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              Recalculate open leads
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {recalcPending
                ? "Rescoring…"
                : recalcStatus ||
                  (dirty
                    ? "Save your changes first."
                    : !canRecalculate
                      ? "You need permission to edit leads to recalculate."
                      : "")}
            </p>
          </div>
        </section>
      </div>

      <ScorePreview rules={liveRules} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live example
// ---------------------------------------------------------------------------

type Profile = {
  area: "in" | "out" | "unknown";
  hasMobile: boolean;
  hasEmail: boolean;
  hasFullAddress: boolean;
  timeline: Timeline | "none";
  services: Service[];
  photos: boolean;
  referral: boolean;
  respondedToText: boolean;
  unansweredAttempts: number;
};

const PRESETS: { id: string; label: string; profile: Profile }[] = [
  {
    id: "website",
    label: "Website request",
    profile: {
      area: "in",
      hasMobile: true,
      hasEmail: true,
      hasFullAddress: true,
      timeline: "1_3_months",
      services: ["interior"],
      photos: false,
      referral: false,
      respondedToText: false,
      unansweredAttempts: 0,
    },
  },
  {
    id: "referral",
    label: "Referral, ready now",
    profile: {
      area: "in",
      hasMobile: true,
      hasEmail: true,
      hasFullAddress: true,
      timeline: "asap",
      services: ["exterior"],
      photos: true,
      referral: true,
      respondedToText: true,
      unansweredAttempts: 0,
    },
  },
  {
    id: "cold",
    label: "Just planning, no reply",
    profile: {
      area: "out",
      hasMobile: false,
      hasEmail: true,
      hasFullAddress: false,
      timeline: "just_planning",
      services: ["interior"],
      photos: false,
      referral: false,
      respondedToText: false,
      unansweredAttempts: 3,
    },
  },
];

function toInput(p: Profile): LeadScoreInput {
  return {
    inServiceArea: p.area === "in" ? true : p.area === "out" ? false : null,
    hasMobile: p.hasMobile,
    hasEmail: p.hasEmail,
    hasFullAddress: p.hasFullAddress,
    timeline: p.timeline === "none" ? null : p.timeline,
    services: p.services,
    photoCount: p.photos ? 1 : 0,
    leadSource: p.referral ? "customer_referral" : "website",
    respondedToText: p.respondedToText,
    unansweredAttempts: p.unansweredAttempts,
  };
}

function ScorePreview({
  rules,
}: {
  rules: readonly { factor: string; label: string; points: number; active: boolean }[];
}) {
  const uid = useId();
  const [profile, setProfile] = useState<Profile>(PRESETS[0]!.profile);
  const set = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));
  const result = useMemo(() => scoreLead(toInput(profile), rules), [profile, rules]);

  const check = (
    key: "hasMobile" | "hasEmail" | "hasFullAddress" | "photos" | "referral" | "respondedToText",
    label: string,
  ) => (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`${uid}-${key}`}
        checked={profile[key]}
        onCheckedChange={(v) => set({ [key]: v === true })}
      />
      <Label htmlFor={`${uid}-${key}`} className="font-normal">
        {label}
      </Label>
    </div>
  );

  return (
    <aside
      aria-labelledby={`${uid}-title`}
      className="flex h-fit flex-col gap-4 rounded-2xl border bg-card p-5 xl:sticky xl:top-20"
    >
      <div>
        <h2 id={`${uid}-title`} className="text-base font-semibold">
          Try it on an example lead
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Uses the weights on screen, saved or not. Nothing here is stored.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Example leads">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setProfile(p.profile)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div
        className="rounded-xl bg-bb-cream-light p-4 text-center"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-4xl font-bold text-bb-ink tabular-nums" data-testid="example-score">
          {result.score}
        </p>
        <div className="mt-1 flex items-center justify-center gap-2 text-sm">
          <GradeBadge grade={result.grade} score={result.score} />
          <span className="font-medium">{scoreSummary(result.score, result.temperature)}</span>
        </div>
      </div>

      <div className="text-sm">
        <p className="mb-1 font-medium">Why</p>
        <ul className="flex flex-col gap-0.5 tabular-nums">
          <li className="flex justify-between gap-2 text-muted-foreground">
            <span>Starting score</span>
            <span>{BASE_SCORE}</span>
          </li>
          {result.factors.map((f) => (
            <li key={f.factor} className="flex justify-between gap-2">
              <span>{f.label}</span>
              <span className={f.points < 0 ? "text-danger" : "text-success"}>
                {f.points > 0 ? `+${f.points}` : f.points}
              </span>
            </li>
          ))}
          {result.factors.length === 0 && (
            <li className="text-muted-foreground">No rules apply to this lead.</li>
          )}
        </ul>
      </div>

      <fieldset className="flex flex-col gap-2 border-t pt-3 text-sm">
        <legend className="sr-only">Example lead details</legend>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-area`}>Service area</Label>
          <select
            id={`${uid}-area`}
            value={profile.area}
            onChange={(e) => set({ area: e.target.value as Profile["area"] })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="in">In our service area</option>
            <option value="out">Outside our service area</option>
            <option value="unknown">No ZIP yet</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-timeline`}>Timeline</Label>
          <select
            id={`${uid}-timeline`}
            value={profile.timeline}
            onChange={(e) => set({ timeline: e.target.value as Profile["timeline"] })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TIMELINES.map((t) => (
              <option key={t} value={t}>
                {TIMELINE_LABELS[t]}
              </option>
            ))}
            <option value="none">Not given</option>
          </select>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Services</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {SERVICES.filter((s) => s !== "other").map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Checkbox
                  id={`${uid}-svc-${s}`}
                  checked={profile.services.includes(s)}
                  onCheckedChange={(v) =>
                    set({
                      services:
                        v === true
                          ? [...profile.services, s]
                          : profile.services.filter((x) => x !== s),
                    })
                  }
                />
                <Label htmlFor={`${uid}-svc-${s}`} className="font-normal">
                  {SERVICE_LABELS[s]}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="mt-1 grid gap-2.5">
          {check("hasMobile", "Has a mobile number")}
          {check("hasEmail", "Has an email address")}
          {check("hasFullAddress", "Full street address")}
          {check("photos", "Sent photos")}
          {check("referral", "Referral or past customer")}
          {check("respondedToText", "Replied to a text")}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${uid}-attempts`} className="font-normal">
            Calls/texts with no reply
          </Label>
          <Input
            id={`${uid}-attempts`}
            type="number"
            min={0}
            max={20}
            value={profile.unansweredAttempts}
            onChange={(e) =>
              set({
                unansweredAttempts: Math.max(
                  0,
                  Math.min(20, Math.trunc(Number(e.target.value) || 0)),
                ),
              })
            }
            className="h-8 w-20 tabular-nums"
          />
        </div>
      </fieldset>
    </aside>
  );
}
