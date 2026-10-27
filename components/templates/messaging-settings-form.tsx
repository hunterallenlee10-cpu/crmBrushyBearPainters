"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/forms/use-run-action";
import { saveMessagingSettings } from "@/app/(app)/admin/templates/actions";

export type MessagingSettingsValues = {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  customerThreadHours: number;
  smsOptOutText: string;
  emailFooter: string;
  reviewDelayDays: number;
  referralInviteDelayDays: number;
  caseSlaBusinessDays: number;
};

function NumberField({
  id,
  label,
  help,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  onChange: (n: number) => void;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={`${id}-help`}
        aria-invalid={!!error}
        disabled={disabled}
        className="w-32"
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Admin → Messaging settings (SPEC §11.1, §13.2): quiet hours, footers, delays, case SLA. */
export function MessagingSettingsForm({ initial, readOnly }: { initial: MessagingSettingsValues; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof MessagingSettingsValues>(k: K, val: MessagingSettingsValues[K]) =>
    setV((x) => ({ ...x, [k]: val }));

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMessagingSettings(v), {
          success: "Messaging settings saved.",
          onOk: () => {
            setErrors({});
            router.refresh();
          },
          onError: (err) =>
            setErrors(Object.fromEntries(Object.entries(err.fieldErrors ?? {}).map(([k, m]) => [k, m[0] ?? ""]))),
        });
      }}
    >
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4" aria-labelledby="quiet-heading">
        <div>
          <h2 id="quiet-heading" className="font-semibold">Quiet hours</h2>
          <p className="text-sm text-muted-foreground">
            Automatic texts written during quiet hours wait until they end (Pacific time). Replies
            to a customer who texted us recently go right away. Email isn't held.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="quiet-on" checked={v.quietHoursEnabled} onCheckedChange={(c) => set("quietHoursEnabled", c)} disabled={readOnly} />
          <Label htmlFor="quiet-on">Hold texts during quiet hours</Label>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quiet-start">From</Label>
            <Input id="quiet-start" type="time" value={v.quietHoursStart} onChange={(e) => set("quietHoursStart", e.target.value)} disabled={readOnly} className="w-36" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quiet-end">Until</Label>
            <Input id="quiet-end" type="time" value={v.quietHoursEnd} onChange={(e) => set("quietHoursEnd", e.target.value)} aria-invalid={!!errors.quietHoursEnd} disabled={readOnly} className="w-36" />
            {errors.quietHoursEnd && <p className="text-sm text-destructive">{errors.quietHoursEnd}</p>}
          </div>
          <NumberField
            id="thread-hours"
            label="Customer texted us within (hours)"
            help="Then our replies aren't held."
            value={v.customerThreadHours}
            onChange={(n) => set("customerThreadHours", n)}
            error={errors.customerThreadHours}
            disabled={readOnly}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4" aria-labelledby="footer-heading">
        <div>
          <h2 id="footer-heading" className="font-semibold">Marketing footers</h2>
          <p className="text-sm text-muted-foreground">
            Added to campaign and drip messages marked Marketing. Messages about a customer's own project don't get them.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sms-stop">Text line</Label>
          <Input id="sms-stop" value={v.smsOptOutText} onChange={(e) => set("smsOptOutText", e.target.value)} aria-invalid={!!errors.smsOptOutText} disabled={readOnly} />
          {errors.smsOptOutText && <p className="text-sm text-destructive">{errors.smsOptOutText}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-footer">Email footer</Label>
          <Textarea id="email-footer" value={v.emailFooter} onChange={(e) => set("emailFooter", e.target.value)} aria-describedby="email-footer-help" disabled={readOnly} />
          <p id="email-footer-help" className="text-xs text-muted-foreground">
            The unsubscribe link is added under it. Marketing email must show a mailing address: replace [MAILING_ADDRESS] when the owners decide which one.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4" aria-labelledby="delays-heading">
        <h2 id="delays-heading" className="font-semibold">Delays and SLAs</h2>
        <div className="flex flex-wrap gap-6">
          <NumberField id="review-days" label="Review request after (days)" help="Days after Paid in Full (workflow 15)." value={v.reviewDelayDays} onChange={(n) => set("reviewDelayDays", n)} error={errors.reviewDelayDays} disabled={readOnly} />
          <NumberField id="referral-days" label="Referral invite after (days)" help="Days after Paid in Full (workflow 15)." value={v.referralInviteDelayDays} onChange={(n) => set("referralInviteDelayDays", n)} error={errors.referralInviteDelayDays} disabled={readOnly} />
          <NumberField id="case-sla" label="Case SLA (business days)" help="Due time for new warranty and service cases." value={v.caseSlaBusinessDays} onChange={(n) => set("caseSlaBusinessDays", n)} error={errors.caseSlaBusinessDays} disabled={readOnly} />
        </div>
      </section>

      <div>
        <Button type="submit" disabled={pending || readOnly}>
          <Save className="size-4" aria-hidden /> Save settings
        </Button>
      </div>
    </form>
  );
}
