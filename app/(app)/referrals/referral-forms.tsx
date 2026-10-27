"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, HandCoins, Plus, Save, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  PAYOUT_METHODS,
  PAYOUT_METHOD_LABELS,
  manualReferralSchema,
  referralSettingsSchema,
} from "@/lib/validation/referrals";
import {
  addChampion,
  addManualReferral,
  markIneligible,
  recordPayout,
  saveReferralSettings,
  setChampionStatus,
} from "./actions";

type Opt = { value: string; label: string };

function issues(list: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of list) out[String(i.path[0] ?? "_form")] ??= i.message;
  return out;
}

export function AddChampionForm({ contacts, readOnly }: { contacts: Opt[]; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [contactId, setContactId] = React.useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        id="champion-contact"
        label="Make a customer a Bear Champion"
        className="min-w-64 flex-1"
      >
        <NativeSelect
          id="champion-contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          disabled={pending || readOnly}
        >
          <option value="">Choose a contact…</option>
          {contacts.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button
        type="button"
        disabled={!contactId || pending || readOnly}
        onClick={() =>
          run(() => addChampion({ contactId }), {
            success: (r) => `Bear Champion added with code ${r.code}.`,
            onOk: () => {
              setContactId("");
              router.refresh();
            },
          })
        }
      >
        <UserPlus className="size-4" aria-hidden /> Add champion
      </Button>
    </div>
  );
}

export function ChampionStatusSelect({
  id,
  status,
  name,
  readOnly,
}: {
  id: string;
  status: string;
  name: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <NativeSelect
      aria-label={`${name}: status`}
      value={status}
      disabled={pending || readOnly}
      className="h-8 w-28 text-xs"
      onChange={(e) => {
        const next = e.target.value as "active" | "paused" | "retired";
        run(() => setChampionStatus({ id, status: next }), {
          success: "Champion updated.",
          onOk: () => router.refresh(),
        });
      }}
    >
      <option value="active">Active</option>
      <option value="paused">Paused</option>
      <option value="retired">Retired</option>
    </NativeSelect>
  );
}

export function CopyLink({ link, label }: { link: string; label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(link).then(
          () => toast.success("Link copied."),
          () => toast.error("Couldn't copy. Select the link and copy it."),
        );
      }}
    >
      <Copy className="size-3.5" aria-hidden />
    </Button>
  );
}

export function ManualReferralForm({
  champions,
  leads,
  jobs,
  readOnly,
}: {
  champions: Opt[];
  leads: Opt[];
  jobs: Opt[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={readOnly}
      >
        <Plus className="size-4" aria-hidden /> Add a referral by hand
      </Button>
    );
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = f.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const parsed = manualReferralSchema.safeParse({
      championId: s("championId"),
      leadId: s("leadId"),
      jobId: s("jobId"),
      referredName: s("referredName") ?? "",
      notes: s("notes") ?? "",
    });
    if (!parsed.success) return setErrors(issues(parsed.error.issues));
    setErrors({});
    run(() => addManualReferral(parsed.data), {
      success: "Referral added.",
      onOk: () => {
        setOpen(false);
        router.refresh();
      },
      onError: (err) => setErrors(firstErrors(err)),
    });
  }
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <h3 className="text-sm font-semibold">Add a referral by hand</h3>
      <p className="text-xs text-muted-foreground">
        For a referral that came by phone or in person. Website referrals with a ?ref= code are
        added automatically.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field id="ref-champion" label="Champion" error={errors.championId}>
          <NativeSelect id="ref-champion" name="championId" defaultValue="" disabled={pending}>
            <option value="">Choose…</option>
            {champions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ref-lead" label="Referred lead" error={errors.leadId}>
          <NativeSelect id="ref-lead" name="leadId" defaultValue="" disabled={pending}>
            <option value="">None</option>
            {leads.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="ref-job" label="or referred job">
          <NativeSelect id="ref-job" name="jobId" defaultValue="" disabled={pending}>
            <option value="">None</option>
            {jobs.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="ref-notes" label="Notes (optional)">
        <Input id="ref-notes" name="notes" maxLength={2000} disabled={pending} />
      </Field>
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          <Save className="size-4" aria-hidden /> Add referral
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PayoutForm({
  referralId,
  label,
  readOnly,
}: {
  referralId: string;
  label: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<(typeof PAYOUT_METHODS)[number]>("check");
  const [reference, setReference] = React.useState("");
  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={readOnly}>
        <HandCoins className="size-4" aria-hidden /> Record payout
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label={`Payout for ${label}`}>
      <Field id={`pm-${referralId}`} label="Paid by">
        <NativeSelect
          id={`pm-${referralId}`}
          value={method}
          onChange={(e) => setMethod(e.target.value as (typeof PAYOUT_METHODS)[number])}
          className="w-40"
        >
          {PAYOUT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYOUT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`pr-${referralId}`} label="Reference (optional)">
        <Input
          id={`pr-${referralId}`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Check #1042"
          className="w-40"
        />
      </Field>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(() => recordPayout({ referralId, method, reference }), {
            success: "Payout recorded.",
            onOk: () => {
              setOpen(false);
              router.refresh();
            },
          })
        }
      >
        Save payout
      </Button>
    </div>
  );
}

export function IneligibleButton({
  referralId,
  readOnly,
}: {
  referralId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        disabled={readOnly}
      >
        Not eligible…
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field id={`ie-${referralId}`} label="Why it isn't eligible">
        <Input
          id={`ie-${referralId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-56"
        />
      </Field>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || reason.trim().length < 3}
        onClick={() =>
          run(() => markIneligible({ referralId, reason }), {
            success: "Marked not eligible.",
            onOk: () => router.refresh(),
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

export function ReferralSettingsForm({
  defaults,
  readOnly,
}: {
  defaults: {
    payableWhen: "paid_in_full" | "sold";
    codePrefix: string;
    programNote: string;
    terms: string;
  };
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = referralSettingsSchema.safeParse({
      payableWhen: f.get("payableWhen"),
      codePrefix: f.get("codePrefix"),
      programNote: f.get("programNote"),
      terms: f.get("terms"),
    });
    if (!parsed.success) return setErrors(issues(parsed.error.issues));
    setErrors({});
    run(() => saveReferralSettings(parsed.data), {
      success: "Referral program saved.",
      onOk: () => router.refresh(),
      onError: (err) => setErrors(firstErrors(err)),
    });
  }
  const disabled = pending || readOnly;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rs-when" label="The reward is payable when the referred job is">
          <NativeSelect
            id="rs-when"
            name="payableWhen"
            defaultValue={defaults.payableWhen}
            disabled={disabled}
          >
            <option value="paid_in_full">Paid in full</option>
            <option value="sold">Sold (estimate accepted)</option>
          </NativeSelect>
        </Field>
        <Field
          id="rs-prefix"
          label="Code prefix"
          description="New codes look like BEAR-7KQ2. Existing codes keep theirs."
          error={errors.codePrefix}
        >
          <Input
            id="rs-prefix"
            name="codePrefix"
            defaultValue={defaults.codePrefix}
            maxLength={8}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field
        id="rs-note"
        label="How the program works (shown to the team)"
        description="Draft – owner to approve."
        error={errors.programNote}
      >
        <Textarea
          id="rs-note"
          name="programNote"
          defaultValue={defaults.programNote}
          rows={3}
          maxLength={2000}
          disabled={disabled}
        />
      </Field>
      <Field
        id="rs-terms"
        label="Terms (for customers)"
        description="Leave empty until the owners write the program terms."
        error={errors.terms}
      >
        <Textarea
          id="rs-terms"
          name="terms"
          defaultValue={defaults.terms}
          rows={4}
          maxLength={5000}
          disabled={disabled}
        />
      </Field>
      <Button type="submit" disabled={disabled} className="self-start">
        <Save className="size-4" aria-hidden /> Save
      </Button>
    </form>
  );
}
