"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  CASE_PRIORITIES,
  CASE_SOURCES,
  CASE_SOURCE_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
} from "@/lib/domain/cases";
import { createCaseSchema } from "@/lib/validation/cases";
import { createCase } from "../actions";

type Opt = { value: string; label: string };

export function CaseForm({
  jobs,
  accounts,
  users,
  defaultJobId,
  defaultAccountId,
  viewerId,
  canMessage,
  readOnly,
}: {
  jobs: Opt[];
  accounts: Opt[];
  users: Opt[];
  defaultJobId: string;
  defaultAccountId: string;
  viewerId: string;
  canMessage: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [jobId, setJobId] = React.useState(defaultJobId);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = f.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const input = {
      jobId: s("jobId"),
      accountId: s("jobId") ? undefined : s("accountId"),
      type: s("type"),
      priority: s("priority"),
      source: s("source"),
      title: s("title") ?? "",
      description: s("description") ?? "",
      ownerId: s("ownerId"),
      acknowledge: s("acknowledge") ?? "none",
    };
    const parsed = createCaseSchema.safeParse(input);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0] ?? "_form")] ??= i.message;
      setErrors(out);
      return;
    }
    setErrors({});
    run(() => createCase(parsed.data), {
      onOk: (r) => {
        toast.success(`Case ${r.caseNumber} opened.`);
        if (r.ackProblem) toast.warning(`The acknowledgment didn't go: ${r.ackProblem}`);
        router.push(`/cases/${r.id}`);
      },
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
      {readOnly && (
        <p role="status" className="text-sm text-danger">
          You&apos;re viewing as another user. Exit View as user to open a case.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="case-job" label="Job" error={errors.jobId}>
          <NativeSelect
            id="case-job"
            name="jobId"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={disabled}
          >
            <option value="">No job (customer only)</option>
            {jobs.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!jobId && (
          <Field id="case-account" label="Customer">
            <NativeSelect
              id="case-account"
              name="accountId"
              defaultValue={defaultAccountId}
              disabled={disabled}
            >
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>
      <Field id="case-title" label="What's the issue?" error={errors.title}>
        <Input
          id="case-title"
          name="title"
          maxLength={200}
          placeholder="Peeling on the back door trim"
          disabled={disabled}
        />
      </Field>
      <Field id="case-description" label="Details (optional)" error={errors.description}>
        <Textarea
          id="case-description"
          name="description"
          rows={4}
          maxLength={5000}
          disabled={disabled}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="case-type" label="Type">
          <NativeSelect id="case-type" name="type" defaultValue="warranty" disabled={disabled}>
            {CASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CASE_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="case-priority" label="Priority">
          <NativeSelect
            id="case-priority"
            name="priority"
            defaultValue="normal"
            disabled={disabled}
          >
            {CASE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p === "normal" ? "Normal" : p === "high" ? "High" : "Urgent"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="case-source" label="How it came in">
          <NativeSelect id="case-source" name="source" defaultValue="phone" disabled={disabled}>
            {CASE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {CASE_SOURCE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="case-owner" label="Owner">
          <NativeSelect id="case-owner" name="ownerId" defaultValue={viewerId} disabled={disabled}>
            {users.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canMessage && (
          <Field id="case-ack" label="Tell the customer we got it">
            <NativeSelect id="case-ack" name="acknowledge" defaultValue="none" disabled={disabled}>
              <option value="none">Don&apos;t send anything</option>
              <option value="sms">Text “We got your request”</option>
              <option value="email">Email “We got your request”</option>
            </NativeSelect>
          </Field>
        )}
      </div>
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <Button type="submit" disabled={disabled} className="self-start">
        <Save className="size-4" aria-hidden /> Open case
      </Button>
    </form>
  );
}
