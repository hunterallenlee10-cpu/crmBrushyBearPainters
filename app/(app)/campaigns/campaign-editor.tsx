"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Info,
  Save,
  Send,
  TriangleAlert,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { SmsCounter } from "@/components/leads/sms-counter";
import { AdvancedFilter } from "@/components/lists/advanced-filter";
import {
  AUDIENCE_MODULES,
  AUDIENCE_MODULE_LABELS,
  type AudienceModule,
  type CampaignCheck,
} from "@/lib/domain/campaigns";
import { OPERATOR_LABELS, type FieldDef, type FilterSpec } from "@/lib/lists/filters";
import { saveCampaignSchema } from "@/lib/validation/campaigns";
import { cn } from "@/lib/utils";
import { previewCampaign, saveCampaign, scheduleCampaign, sendCampaignTest } from "./actions";

export type CampaignTemplate = {
  id: string;
  key: string;
  name: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  status: "draft" | "approved";
  marketing: boolean;
};

export type CampaignDraft = {
  id?: string;
  name: string;
  channel: "sms" | "email";
  audience: { module: AudienceModule } & FilterSpec;
  templateId: string | null;
  subject: string;
  body: string;
};

type PreviewResult = {
  total: number;
  reachable: number;
  capped: boolean;
  sample: { name: string; address: string | null }[];
  excluded: { reason: string; count: number }[];
  checks: CampaignCheck[];
};

const CHECK_ICON = { error: XCircle, warning: TriangleAlert, info: Info } as const;
const CHECK_TONE = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-muted-foreground",
} as const;

function describeRules(spec: FilterSpec, fields: readonly FieldDef[]): string {
  if (!spec.rules.length) return "Everyone in this list";
  const parts = spec.rules.map((r) => {
    const f = fields.find((x) => x.key === r.field);
    const value = Array.isArray(r.value)
      ? r.value.map((v) => f?.options?.find((o) => o.value === v)?.label ?? v).join(", ")
      : (f?.options?.find((o) => o.value === r.value)?.label ?? r.value ?? "");
    return `${f?.label ?? r.field} ${OPERATOR_LABELS[r.op].toLowerCase()} ${value}`.trim();
  });
  return parts.join(spec.match === "all" ? " and " : " or ");
}

export function CampaignEditor({
  initial,
  fieldsByModule,
  templates,
  readOnly,
}: {
  initial: CampaignDraft;
  fieldsByModule: Record<AudienceModule, FieldDef[]>;
  templates: CampaignTemplate[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [when, setWhen] = React.useState("");
  const fields = fieldsByModule[v.audience.module];
  const disabled = pending || readOnly;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const options = templates.filter((t) => t.channel === v.channel);

  const set = (patch: Partial<CampaignDraft>) => {
    setV((x) => ({ ...x, ...patch }));
    setPreview(null);
  };

  const check = () =>
    run(
      () =>
        previewCampaign({
          channel: v.channel,
          audience: v.audience,
          subject: v.subject,
          body: v.body,
          templateId: v.templateId,
        }),
      { onOk: (r) => setPreview(r) },
    );

  const save = () => {
    const parsed = saveCampaignSchema.safeParse(v);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0] ?? "_form")] ??= i.message;
      setErrors(out);
      return;
    }
    setErrors({});
    run(() => saveCampaign(parsed.data), {
      success: "Draft saved.",
      onOk: (r) => {
        if (!v.id) router.push(`/campaigns/${r.id}`);
        else router.refresh();
      },
      onError: (e) => setErrors(firstErrors(e)),
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex flex-col gap-4">
        <section
          aria-labelledby="c-basics"
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <h2 id="c-basics" className="text-base font-semibold">
            Campaign
          </h2>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field id="c-name" label="Name (only the team sees it)" error={errors.name}>
              <Input
                id="c-name"
                value={v.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={120}
                disabled={disabled}
              />
            </Field>
            <Field id="c-channel" label="Channel">
              <NativeSelect
                id="c-channel"
                value={v.channel}
                onChange={(e) =>
                  set({ channel: e.target.value as "sms" | "email", templateId: null })
                }
                disabled={disabled}
              >
                <option value="email">Email</option>
                <option value="sms">Text (SMS)</option>
              </NativeSelect>
            </Field>
          </div>
        </section>

        <section
          aria-labelledby="c-audience"
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <h2 id="c-audience" className="text-base font-semibold">
            Audience
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field id="c-module" label="Who" className="min-w-56">
              <NativeSelect
                id="c-module"
                value={v.audience.module}
                onChange={(e) =>
                  set({
                    audience: { module: e.target.value as AudienceModule, match: "all", rules: [] },
                  })
                }
                disabled={disabled}
              >
                {AUDIENCE_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {AUDIENCE_MODULE_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!readOnly && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Rules</span>
                <AdvancedFilter
                  fields={fields}
                  filter={{ match: v.audience.match, rules: v.audience.rules }}
                  onApply={(f) => set({ audience: { module: v.audience.module, ...f } })}
                />
              </div>
            )}
            <Button type="button" variant="outline" onClick={check} disabled={pending}>
              <Users className="size-4" aria-hidden /> Check audience
            </Button>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">Matches: </span>
            {describeRules(v.audience, fields)}
          </p>
          <p className="text-xs text-muted-foreground">
            Campaigns are marketing: texts only go to people who opted in to texts; email goes to
            contacts who opted in and to leads who haven&apos;t unsubscribed. Do Not Contact and
            opt-outs are always left out, and each phone or email gets one message.
          </p>
        </section>

        <section
          aria-labelledby="c-message"
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <h2 id="c-message" className="text-base font-semibold">
            Message
          </h2>
          <Field id="c-template" label="Start from a template (optional)">
            <NativeSelect
              id="c-template"
              value={v.templateId ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                set(
                  t
                    ? { templateId: t.id, body: t.body, subject: t.subject ?? v.subject }
                    : { templateId: null },
                );
              }}
            >
              <option value="">None</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.marketing ? "" : " (transactional)"}
                  {t.status === "draft" ? " · Draft" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {v.channel === "email" && (
            <Field id="c-subject" label="Subject" error={errors.subject}>
              <Input
                id="c-subject"
                value={v.subject}
                onChange={(e) => set({ subject: e.target.value })}
                maxLength={200}
                disabled={disabled}
              />
            </Field>
          )}
          <Field
            id="c-body"
            label={v.channel === "sms" ? "Text" : "Email"}
            description="Fields you can use: {{contact.first_name}}, {{contact.full_name}}, {{company.name}}, {{company.phone}}, {{company.website}}."
            error={errors.body}
          >
            <Textarea
              id="c-body"
              value={v.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={v.channel === "sms" ? 4 : 10}
              maxLength={5000}
              disabled={disabled}
            />
          </Field>
          {v.channel === "sms" && (
            <SmsCounter text={`${v.body} Reply STOP to opt out.`} id="c-body-count" />
          )}
          {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={disabled || (!!v.id && !dirty)}>
              <Save className="size-4" aria-hidden /> {v.id ? "Save draft" : "Create draft"}
            </Button>
            <Button type="button" variant="outline" onClick={check} disabled={pending}>
              <CheckCircle2 className="size-4" aria-hidden /> Run checks
            </Button>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section
          aria-labelledby="c-checks"
          className="rounded-2xl border bg-card p-5"
          aria-live="polite"
        >
          <h2 id="c-checks" className="mb-2 text-base font-semibold">
            Audience &amp; checks
          </h2>
          {!preview ? (
            <p className="text-sm text-muted-foreground">
              Run the checks to see who it reaches and anything to fix before sending.
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                <span className="text-2xl font-bold tabular-nums">{preview.reachable}</span> of{" "}
                {preview.total}
                {preview.capped ? "+" : ""} can get it.
              </p>
              {preview.excluded.length > 0 && (
                <ul className="text-xs text-muted-foreground">
                  {preview.excluded.map((x) => (
                    <li key={x.reason}>
                      {x.count} · {x.reason}
                    </li>
                  ))}
                </ul>
              )}
              {preview.sample.length > 0 && (
                <div>
                  <p className="text-xs font-medium">For example</p>
                  <ul className="text-xs text-muted-foreground">
                    {preview.sample.map((s, i) => (
                      <li key={i}>
                        {s.name}
                        {s.address ? ` · ${s.address}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="flex flex-col gap-1.5" aria-label="Compliance checks">
                {preview.checks.map((c, i) => {
                  const Icon = CHECK_ICON[c.level];
                  return (
                    <li key={i} className={cn("flex items-start gap-1.5", CHECK_TONE[c.level])}>
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{c.message}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {v.id && (
          <section
            aria-labelledby="c-send"
            className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
          >
            <h2 id="c-send" className="text-base font-semibold">
              Test &amp; schedule
            </h2>
            {dirty && <p className="text-sm text-warning">Save the draft first.</p>}
            <Button
              type="button"
              variant="outline"
              disabled={disabled || dirty}
              onClick={() =>
                run(() => sendCampaignTest({ id: v.id! }), {
                  success: (r) => `Test recorded for ${r.to} (Simulated – not sent).`,
                })
              }
            >
              <Send className="size-4" aria-hidden /> Send a test to me
            </Button>
            <Field id="c-when" label="Send at (Pacific)">
              <Input
                id="c-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                disabled={disabled || dirty}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={disabled || dirty || !when}
                onClick={() =>
                  run(() => scheduleCampaign({ id: v.id!, when }), {
                    success: (r) => `Scheduled for ${r.reachable} people.`,
                    onOk: () => router.refresh(),
                  })
                }
              >
                <CalendarClock className="size-4" aria-hidden /> Schedule
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={disabled || dirty}
                onClick={() =>
                  run(() => scheduleCampaign({ id: v.id!, when: "now" }), {
                    success: (r) => `Sending to ${r.reachable} people (Simulated – not sent).`,
                    onOk: () => {
                      toast.message("The worker sends in batches every minute.");
                      router.refresh();
                    },
                  })
                }
              >
                Send now
              </Button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
