"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Check, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  COMMISSION_STATUS_LABELS,
  simulate,
  type CommissionPlan,
  type CommissionSettings,
  type CommissionStatus,
  type PayableLine,
} from "@/lib/domain/commissions";
import {
  addCommissionAdjustment,
  deleteCommissionPlan,
  recalculate,
  saveCommissionPlan,
  saveCommissionSettings,
  updateCommissionAdjustment,
  updateCommissionEntry,
} from "./actions";

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
type Opt = { value: string; label: string };
type Entry = {
  id: string;
  jobId: string;
  job: string;
  userId: string;
  sourceKind: "company" | "self";
  basisCents: number;
  overheadCents: number;
  ratePercent: number;
  amountCents: number;
  status: string;
  reasons: string[];
  paidOn: string | null;
};
type Adjustment = {
  id: string;
  userId: string;
  kind: string;
  amountCents: number;
  reason: string;
  status: string;
  paidOn: string | null;
};

export function CommissionsAdmin(props: {
  settings: CommissionSettings;
  plans: CommissionPlan[];
  roles: Opt[];
  users: Opt[];
  sources: Opt[];
  entries: Entry[];
  adjustments: Adjustment[];
  payroll: PayableLine[];
  names: Record<string, string>;
  readOnly: boolean;
}) {
  return (
    <Tabs defaultValue={props.settings.enabled ? "payroll" : "settings"} className="gap-4">
      <TabsList aria-label="Commissions sections" className="h-auto! w-full flex-wrap sm:w-fit">
        {[
          ["settings", "Settings"],
          ["plans", `Plans (${props.plans.length})`],
          ["payroll", "Payroll & exceptions"],
          ["simulator", "Simulator"],
        ].map(([v, l]) => (
          <TabsTrigger key={v} value={v!} className="min-h-11 sm:min-h-8">
            {l}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="settings">
        <SettingsTab {...props} />
      </TabsContent>
      <TabsContent value="plans">
        <PlansTab {...props} />
      </TabsContent>
      <TabsContent value="payroll">
        <PayrollTab {...props} />
      </TabsContent>
      <TabsContent value="simulator">
        <SimulatorTab plans={props.plans} settings={props.settings} />
      </TabsContent>
    </Tabs>
  );
}

function SettingsTab({
  settings,
  sources,
  readOnly,
}: {
  settings: CommissionSettings;
  sources: Opt[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [s, setS] = React.useState({
    enabled: settings.enabled,
    basis: settings.basis,
    overhead: String(settings.overheadDeductionPercent),
    threshold:
      settings.reviewThresholdCents === null ? "" : String(settings.reviewThresholdCents / 100),
    selfSources: [...settings.selfGeneratedSources],
    cleared: settings.requireClearedFunds,
  });
  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveCommissionSettings({
              enabled: s.enabled,
              basis: s.basis,
              overhead_deduction_percent: s.overhead,
              review_threshold: s.threshold,
              self_generated_sources: s.selfSources,
              require_cleared_funds: s.cleared,
            }),
          { success: "Commission settings saved.", onOk: () => router.refresh() },
        );
      }}
    >
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <Switch
          checked={s.enabled}
          onCheckedChange={(v) => setS({ ...s, enabled: v })}
          aria-label="Commissions on"
        />
        {s.enabled ? "Commissions are on" : "Commissions are off"}
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="c-basis" label="Pay commission on">
          <NativeSelect
            id="c-basis"
            value={s.basis}
            onChange={(e) => setS({ ...s, basis: e.target.value as "contract" | "collected" })}
          >
            <option value="contract">The contract (sold price after credits)</option>
            <option value="collected">What was collected</option>
          </NativeSelect>
        </Field>
        <Field
          id="c-overhead"
          label="Overhead deduction (%)"
          description="Taken off before the rate. 0 = none."
        >
          <Input
            id="c-overhead"
            inputMode="decimal"
            value={s.overhead}
            onChange={(e) => setS({ ...s, overhead: e.target.value })}
          />
        </Field>
        <Field
          id="c-threshold"
          label="Owner review at or above ($)"
          description="Leave empty for no review step."
        >
          <Input
            id="c-threshold"
            inputMode="decimal"
            value={s.threshold}
            onChange={(e) => setS({ ...s, threshold: e.target.value })}
          />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox
          checked={s.cleared}
          onCheckedChange={(v) => setS({ ...s, cleared: v === true })}
        />
        Pay only after every payment has cleared the bank (and the job is paid in full)
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">
          Lead sources that count as self-generated
        </legend>
        <p className="mb-2 text-xs text-muted-foreground">
          A lead the rep set themselves always counts as self-generated.
        </p>
        <div className="grid gap-1 sm:grid-cols-3">
          {sources.map((o) => (
            <label key={o.value} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <Checkbox
                checked={s.selfSources.includes(o.value)}
                onCheckedChange={(v) =>
                  setS({
                    ...s,
                    selfSources:
                      v === true
                        ? [...s.selfSources, o.value]
                        : s.selfSources.filter((x) => x !== o.value),
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

function PlansTab({
  plans,
  roles,
  users,
  readOnly,
}: {
  plans: CommissionPlan[];
  roles: Opt[];
  users: Opt[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const empty = {
    id: "",
    name: "",
    role: "",
    user: "",
    company: "0",
    self: "0",
    overhead: "",
    active: true,
  };
  const [form, setForm] = React.useState<typeof empty | null>(null);
  const label = (p: CommissionPlan) =>
    p.userId
      ? (users.find((u) => u.value === p.userId)?.label ?? "A person")
      : (roles.find((r) => r.value === p.roleTemplateId)?.label ?? "A role");
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A person&apos;s own plan beats their role&apos;s plan. Rates are a % of the basis after
          overhead.
        </p>
        {!readOnly && (
          <Button size="sm" onClick={() => setForm(empty)}>
            <Plus aria-hidden /> Add plan
          </Button>
        )}
      </div>
      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No plans yet. Without a plan nobody earns a commission.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {label(p)} · company leads {p.companyRatePercent}% · self-generated{" "}
                  {p.selfRatePercent}%
                  {p.overheadDeductionPercent !== null
                    ? ` · overhead ${p.overheadDeductionPercent}%`
                    : ""}
                </p>
              </div>
              {!p.active && <Badge variant="warning">Off</Badge>}
              {!readOnly && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: p.id,
                        name: p.name,
                        role: p.roleTemplateId ?? "",
                        user: p.userId ?? "",
                        company: String(p.companyRatePercent),
                        self: String(p.selfRatePercent),
                        overhead:
                          p.overheadDeductionPercent === null
                            ? ""
                            : String(p.overheadDeductionPercent),
                        active: p.active,
                      })
                    }
                  >
                    <Pencil aria-hidden /> Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${p.name}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteCommissionPlan({ id: p.id }), {
                        success: "Plan removed.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form
          className="mt-4 grid gap-3 rounded-xl border bg-bb-cream-light p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveCommissionPlan({
                  id: form.id || undefined,
                  name: form.name,
                  role_template_id: form.role,
                  user_id: form.user,
                  company_rate_percent: form.company,
                  self_rate_percent: form.self,
                  overhead_deduction_percent: form.overhead,
                  active: form.active,
                }),
              { success: "Plan saved.", onOk: () => (setForm(null), router.refresh()) },
            );
          }}
        >
          <Field id="p-name" label="Plan name">
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field id="p-role" label="For everyone on this role">
            <NativeSelect
              id="p-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="p-user" label="Or just this person">
            <NativeSelect
              id="p-user"
              value={form.user}
              onChange={(e) => setForm({ ...form, user: e.target.value })}
            >
              <option value="">—</option>
              {users.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="p-company" label="Rate on company leads (%)">
            <Input
              id="p-company"
              inputMode="decimal"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </Field>
          <Field id="p-self" label="Rate on self-generated leads (%)">
            <Input
              id="p-self"
              inputMode="decimal"
              value={form.self}
              onChange={(e) => setForm({ ...form, self: e.target.value })}
            />
          </Field>
          <Field id="p-overhead" label="Overhead % for this plan (optional)">
            <Input
              id="p-overhead"
              inputMode="decimal"
              value={form.overhead}
              onChange={(e) => setForm({ ...form, overhead: e.target.value })}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm({ ...form, active: v })}
              aria-label="Plan is on"
            />{" "}
            {form.active ? "On" : "Off"}
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save plan
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

const STATUS_VARIANT: Record<string, "info" | "success" | "warning" | "neutral" | "danger"> = {
  pending: "neutral",
  eligible: "info",
  needs_review: "warning",
  approved: "success",
  paid: "success",
  void: "neutral",
};

function PayrollTab({
  settings,
  entries,
  adjustments,
  payroll,
  names,
  users,
  readOnly,
}: {
  settings: CommissionSettings;
  entries: Entry[];
  adjustments: Adjustment[];
  payroll: PayableLine[];
  names: Record<string, string>;
  users: Opt[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [show, setShow] = React.useState<"open" | "all">("open");
  const [adj, setAdj] = React.useState({
    user: users[0]?.value ?? "",
    kind: "bonus",
    amount: "",
    reason: "",
  });
  const visible = entries.filter(
    (e) => show === "all" || ["eligible", "needs_review", "approved"].includes(e.status),
  );
  const exceptions = entries.filter((e) => e.status === "needs_review");
  return (
    <div className="flex flex-col gap-5">
      {!settings.enabled && (
        <p className="rounded-2xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
          Commissions are off. Turn them on in Settings to calculate.
        </p>
      )}
      <section className="rounded-2xl border bg-card p-5" aria-labelledby="payroll-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="payroll-heading" className="text-base font-semibold">
            Payroll preview
          </h2>
          {!readOnly && settings.enabled && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => recalculate({}), {
                  success: (d) =>
                    `Recalculated: ${d.inserted} new, ${d.updated} updated, ${d.voided} voided.`,
                  onOk: () => router.refresh(),
                })
              }
            >
              <RefreshCw aria-hidden /> Recalculate
            </Button>
          )}
        </div>
        {payroll.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing approved and unpaid.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-medium">
                  Person
                </th>
                <th scope="col" className="py-2 font-medium">
                  Commissions
                </th>
                <th scope="col" className="py-2 font-medium">
                  Adjustments
                </th>
                <th scope="col" className="py-2 font-medium">
                  Total owed
                </th>
              </tr>
            </thead>
            <tbody>
              {payroll.map((p) => (
                <tr key={p.userId} className="border-b last:border-0">
                  <td className="py-2">{names[p.userId] ?? "Someone"}</td>
                  <td className="py-2 tabular-nums">
                    {money(p.commissionsCents)} ({p.entries})
                  </td>
                  <td className="py-2 tabular-nums">
                    {money(p.adjustmentsCents)} ({p.adjustments})
                  </td>
                  <td className="py-2 font-semibold tabular-nums">{money(p.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {exceptions.length > 0 && (
        <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">
          {exceptions.length} commission{exceptions.length === 1 ? "" : "s"} at or above the review
          threshold wait for an owner.
        </p>
      )}

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="entries-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="entries-heading" className="text-base font-semibold">
            Commissions by job
          </h2>
          <NativeSelect
            aria-label="Show"
            value={show}
            onChange={(e) => setShow(e.target.value as "open" | "all")}
            className="w-48"
          >
            <option value="open">To approve or pay</option>
            <option value="all">Everything</option>
          </NativeSelect>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here. Jobs earn a commission once they&apos;re paid in full.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {visible.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  <Link
                    href={`/jobs/${e.jobId}`}
                    className="font-medium text-bb-forest hover:underline"
                  >
                    {e.job}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {names[e.userId] ?? "Someone"} ·{" "}
                    {e.sourceKind === "self" ? "self-generated" : "company lead"} ·{" "}
                    {money(e.basisCents)}
                    {e.overheadCents ? ` − ${money(e.overheadCents)} overhead` : ""} ×{" "}
                    {e.ratePercent}% = <strong>{money(e.amountCents)}</strong>
                  </p>
                  {e.reasons.length > 0 && (
                    <p className="text-xs text-muted-foreground">{e.reasons.join(" ")}</p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[e.status] ?? "neutral"}>
                  {COMMISSION_STATUS_LABELS[e.status as CommissionStatus] ?? e.status}
                </Badge>
                {!readOnly && (e.status === "eligible" || e.status === "needs_review") && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateCommissionEntry({ id: e.id, action: "approve" }), {
                        success: "Approved.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    <Check aria-hidden /> Approve
                  </Button>
                )}
                {!readOnly && e.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateCommissionEntry({ id: e.id, action: "pay" }), {
                        success: "Marked paid.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    Mark paid
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="adj-heading">
        <h2 id="adj-heading" className="mb-3 text-base font-semibold">
          Adjustments (bonuses, clawbacks, corrections)
        </h2>
        {!readOnly && (
          <form
            className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_2fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  addCommissionAdjustment({
                    user_id: adj.user,
                    kind: adj.kind as "bonus",
                    amount: adj.amount,
                    reason: adj.reason,
                  }),
                {
                  success: "Adjustment added (waiting for approval).",
                  onOk: () => (setAdj({ ...adj, amount: "", reason: "" }), router.refresh()),
                },
              );
            }}
          >
            <Field id="adj-user" label="Person">
              <NativeSelect
                id="adj-user"
                value={adj.user}
                onChange={(e) => setAdj({ ...adj, user: e.target.value })}
              >
                {users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="adj-kind" label="Type">
              <NativeSelect
                id="adj-kind"
                value={adj.kind}
                onChange={(e) => setAdj({ ...adj, kind: e.target.value })}
              >
                <option value="bonus">Bonus</option>
                <option value="clawback">Clawback</option>
                <option value="correction">Correction</option>
                <option value="other">Other</option>
              </NativeSelect>
            </Field>
            <Field id="adj-amount" label="Amount ($, negative to take off)">
              <Input
                id="adj-amount"
                inputMode="decimal"
                value={adj.amount}
                onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
              />
            </Field>
            <Field id="adj-reason" label="Reason">
              <Input
                id="adj-reason"
                value={adj.reason}
                onChange={(e) => setAdj({ ...adj, reason: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </form>
        )}
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adjustments.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <strong>{names[a.userId] ?? "Someone"}</strong> · {a.kind} {money(a.amountCents)}{" "}
                  — {a.reason}
                </span>
                <Badge
                  variant={a.status === "approved" || a.status === "paid" ? "success" : "neutral"}
                >
                  {a.status}
                </Badge>
                {!readOnly && a.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateCommissionAdjustment({ id: a.id, action: "approve" }), {
                        success: "Approved.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    Approve
                  </Button>
                )}
                {!readOnly && a.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateCommissionAdjustment({ id: a.id, action: "pay" }), {
                        success: "Marked paid.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    Mark paid
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SimulatorTab({
  plans,
  settings,
}: {
  plans: CommissionPlan[];
  settings: CommissionSettings;
}) {
  const [plan, setPlan] = React.useState(plans[0]?.id ?? "");
  const p = plans.find((x) => x.id === plan);
  const [v, setV] = React.useState({
    contract: "10000",
    collected: "10000",
    source: "company" as "company" | "self",
    company: String(p?.companyRatePercent ?? 0),
    self: String(p?.selfRatePercent ?? 0),
    overhead: String(p?.overheadDeductionPercent ?? settings.overheadDeductionPercent),
    basis: settings.basis,
    threshold:
      settings.reviewThresholdCents === null ? "" : String(settings.reviewThresholdCents / 100),
  });
  React.useEffect(() => {
    if (!p) return;
    setV((s) => ({
      ...s,
      company: String(p.companyRatePercent),
      self: String(p.selfRatePercent),
      overhead: String(p.overheadDeductionPercent ?? settings.overheadDeductionPercent),
    }));
  }, [p, settings.overheadDeductionPercent]);
  const n = (x: string) => Number(x.replace(/[$,\s]/g, "")) || 0;
  const r = simulate({
    contractCents: Math.round(n(v.contract) * 100),
    collectedCents: Math.round(n(v.collected) * 100),
    source: v.source,
    companyRatePercent: n(v.company),
    selfRatePercent: n(v.self),
    overheadDeductionPercent: n(v.overhead),
    basis: v.basis,
    reviewThresholdCents: v.threshold.trim() === "" ? null : Math.round(n(v.threshold) * 100),
  });
  const input = (id: keyof typeof v, label: string) => (
    <Field id={`sim-${id}`} label={label}>
      <Input
        id={`sim-${id}`}
        inputMode="decimal"
        value={String(v[id])}
        onChange={(e) => setV({ ...v, [id]: e.target.value })}
      />
    </Field>
  );
  return (
    <section className="grid gap-5 rounded-2xl border bg-card p-5 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.length > 0 && (
          <Field id="sim-plan" label="Start from a plan" className="sm:col-span-2">
            <NativeSelect id="sim-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {input("contract", "Contract ($)")}
        {input("collected", "Collected ($)")}
        <Field id="sim-source" label="Lead">
          <NativeSelect
            id="sim-source"
            value={v.source}
            onChange={(e) => setV({ ...v, source: e.target.value as "company" | "self" })}
          >
            <option value="company">Company lead</option>
            <option value="self">Self-generated</option>
          </NativeSelect>
        </Field>
        <Field id="sim-basis" label="Pay on">
          <NativeSelect
            id="sim-basis"
            value={v.basis}
            onChange={(e) => setV({ ...v, basis: e.target.value as "contract" | "collected" })}
          >
            <option value="contract">Contract</option>
            <option value="collected">Collected</option>
          </NativeSelect>
        </Field>
        {input("company", "Company-lead rate (%)")}
        {input("self", "Self-generated rate (%)")}
        {input("overhead", "Overhead deduction (%)")}
        {input("threshold", "Review threshold ($)")}
      </div>
      <div className="rounded-xl bg-bb-cream-light p-4" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="size-4" aria-hidden /> Result
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
          <dt>Basis</dt>
          <dd className="text-right tabular-nums">{money(r.basisCents)}</dd>
          <dt>− Overhead</dt>
          <dd className="text-right tabular-nums">{money(r.overheadCents)}</dd>
          <dt>= Net</dt>
          <dd className="text-right tabular-nums">{money(r.netCents)}</dd>
          <dt>× Rate</dt>
          <dd className="text-right tabular-nums">{r.ratePercent}%</dd>
          <dt className="font-semibold">Commission</dt>
          <dd className="text-right text-lg font-bold tabular-nums">{money(r.amountCents)}</dd>
        </dl>
        {r.needsReview && (
          <p className="mt-2 text-sm text-warning">
            At or above the review threshold: an owner approves it first.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Only paid once the job is paid in full
          {settings.requireClearedFunds ? " and the payments have cleared" : ""}.
        </p>
      </div>
    </section>
  );
}
