"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { JOB_PRIORITIES, JOB_PRIORITY_LABELS, type JobPriority } from "@/lib/domain/jobs/constants";
import { jobCreateSchema } from "@/lib/validation/jobs";
import { cn } from "@/lib/utils";
import { createJob, getAccountChoice, searchAccounts } from "./actions";
import { defaultJobName } from "./default-name";
import type { AccountChoice, AccountHit } from "./schema";

type Option = { value: string; label: string };

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

type Errors = Partial<Record<string, string>>;

/** New Job form: customer → property & contact → work → team. */
export function NewJobForm({
  options,
  initialAccount,
  accountMissing,
  viewerId,
  canAssign,
  canWriteNotes,
  readOnly,
  seasons,
}: {
  options: { workTypes: Option[]; leadSources: Option[]; users: Option[] };
  initialAccount: AccountChoice | null;
  accountMissing: boolean;
  viewerId: string;
  canAssign: boolean;
  canWriteNotes: boolean;
  readOnly: boolean;
  seasons: number[];
}) {
  const router = useRouter();
  const [account, setAccount] = React.useState<AccountChoice | null>(initialAccount);
  const [propertyId, setPropertyId] = React.useState(initialAccount?.properties[0]?.id ?? "");
  const [contactId, setContactId] = React.useState(defaultContact(initialAccount));
  const [workTypes, setWorkTypes] = React.useState<string[]>([]);
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [ownerId, setOwnerId] = React.useState(viewerId);
  const [pocId, setPocId] = React.useState("");
  const [leadSource, setLeadSource] = React.useState("");
  const [priority, setPriority] = React.useState<JobPriority>("normal");
  const [season, setSeason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [saving, setSaving] = React.useState(false);

  const property = account?.properties.find((p) => p.id === propertyId) ?? null;
  const contact = account?.contacts.find((c) => c.id === contactId) ?? null;
  const labels = options.workTypes.filter((w) => workTypes.includes(w.value)).map((w) => w.label);
  const suggested = defaultJobName({
    lastName: contact?.lastName,
    firstName: contact?.firstName,
    accountName: account?.name,
    city: property?.city,
    workTypeLabels: labels,
  });
  const shownName = nameEdited ? name : suggested;

  function chooseAccount(next: AccountChoice | null) {
    setAccount(next);
    setPropertyId(next?.properties[0]?.id ?? "");
    setContactId(defaultContact(next));
    setErrors((e) => ({ ...e, account_id: undefined }));
  }

  function toggleWorkType(value: string, on: boolean) {
    setWorkTypes((prev) =>
      on
        ? options.workTypes.map((w) => w.value).filter((v) => v === value || prev.includes(v))
        : prev.filter((v) => v !== value),
    );
    setErrors((e) => ({ ...e, work_types: undefined }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const payload = {
      account_id: account?.id ?? "",
      property_id: propertyId || null,
      primary_contact_id: contactId || null,
      name: shownName,
      work_types: workTypes,
      owner_id: canAssign ? ownerId || null : viewerId,
      point_of_contact_id: pocId || null,
      lead_source: leadSource || null,
      priority,
      target_season: season ? Number(season) : null,
      notes: canWriteNotes ? notes : null,
    };
    const parsed = jobCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_form");
        next[key] ??= issue.message;
      }
      setErrors(next);
      toast.error("Some fields need attention.");
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await createJob(payload);
    if (!result.ok) {
      setSaving(false);
      const next: Errors = {};
      for (const [k, m] of Object.entries(result.error.fieldErrors ?? {})) next[k] = m[0];
      setErrors(next);
      toast.error(result.error.message);
      return;
    }
    toast.success(`Job ${result.data.jobNumber} created.`);
    router.push(`/jobs/${result.data.id}`);
  }

  const err = (k: string) => errors[k];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-label="New job">
      {/* 1. Customer */}
      <section aria-labelledby="nj-customer" className="rounded-2xl border bg-card p-5">
        <h2 id="nj-customer" className="mb-1 text-base font-semibold">
          Customer
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Pick the account. New customers start as a lead or from Accounts → New account.
        </p>
        {accountMissing && !account && (
          <p role="alert" className="mb-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-bb-ink">
            That customer isn&apos;t available. Search for another one.
          </p>
        )}
        {account ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-bb-cream-light px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <Building2 className="size-4 shrink-0 text-bb-forest" aria-hidden />
                <span className="break-words" data-testid="chosen-account">
                  {account.name}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => chooseAccount(null)}
                aria-label={`Change customer (now ${account.name})`}
              >
                <X aria-hidden />
                Change
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="nj-property"
                label="Property"
                error={err("property_id")}
                description={
                  account.properties.length ? undefined : "This customer has no property yet."
                }
              >
                <select
                  className={selectClass}
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  {...fieldAria("nj-property", err("property_id"), account.properties.length === 0)}
                >
                  <option value="">No property</option>
                  {account.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.isPrimary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="nj-contact" label="Primary contact" error={err("primary_contact_id")}>
                <select
                  className={selectClass}
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  {...fieldAria("nj-contact", err("primary_contact_id"))}
                >
                  <option value="">No contact</option>
                  {account.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ) : (
          <AccountPicker onPick={chooseAccount} error={err("account_id")} />
        )}
      </section>

      {/* 2. Work */}
      <section
        aria-labelledby="nj-work"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      >
        <h2 id="nj-work" className="text-base font-semibold">
          Work
        </h2>
        <fieldset aria-describedby={err("work_types") ? "nj-work-types-error" : undefined}>
          <legend className="mb-2 text-sm font-medium">
            Work types
            <span className="text-danger" aria-hidden>
              *
            </span>
            <span className="sr-only"> (required, pick at least one)</span>
          </legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {options.workTypes.map((w) => (
              <div key={w.value} className="flex min-h-6 items-center gap-2">
                <Checkbox
                  id={`nj-wt-${w.value}`}
                  checked={workTypes.includes(w.value)}
                  onCheckedChange={(v) => toggleWorkType(w.value, v === true)}
                />
                <Label htmlFor={`nj-wt-${w.value}`} className="font-normal">
                  {w.label}
                </Label>
              </div>
            ))}
          </div>
          {err("work_types") && (
            <p id="nj-work-types-error" role="alert" className="mt-2 text-xs text-danger">
              {err("work_types")}
            </p>
          )}
        </fieldset>
        <Field
          id="nj-name"
          label="Job name"
          required
          error={err("name")}
          description={
            nameEdited
              ? "Edited. Clear it to go back to the suggested name."
              : "Suggested from the contact's last name, the city and the work types. You can change it."
          }
        >
          <Input
            value={shownName}
            maxLength={200}
            placeholder="Lastname – City – Work types"
            onChange={(e) => {
              setNameEdited(e.target.value !== "");
              setName(e.target.value);
              setErrors((x) => ({ ...x, name: undefined }));
            }}
            {...fieldAria("nj-name", err("name"), true)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="nj-priority" label="Priority" error={err("priority")}>
            <select
              className={selectClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as JobPriority)}
              {...fieldAria("nj-priority", err("priority"))}
            >
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {JOB_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="nj-season" label="Target season" error={err("target_season")}>
            <select
              className={selectClass}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              {...fieldAria("nj-season", err("target_season"))}
            >
              <option value="">Not set</option>
              {seasons.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field id="nj-source" label="Lead source" error={err("lead_source")}>
            <select
              className={selectClass}
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value)}
              {...fieldAria("nj-source", err("lead_source"))}
            >
              <option value="">Not set</option>
              {options.leadSources.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {/* 3. Team */}
      <section
        aria-labelledby="nj-team"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
      >
        <h2 id="nj-team" className="text-base font-semibold">
          Team
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="nj-owner"
            label="Owner"
            error={err("owner_id")}
            description={
              canAssign
                ? undefined
                : "You own the jobs you create. Office managers and owners can assign someone else."
            }
          >
            <select
              className={selectClass}
              value={canAssign ? ownerId : viewerId}
              disabled={!canAssign}
              onChange={(e) => setOwnerId(e.target.value)}
              {...fieldAria("nj-owner", err("owner_id"), !canAssign)}
            >
              {options.users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.value === viewerId ? `${u.label} (me)` : u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="nj-poc" label="Point of contact" error={err("point_of_contact_id")}>
            <select
              className={selectClass}
              value={pocId}
              onChange={(e) => setPocId(e.target.value)}
              {...fieldAria("nj-poc", err("point_of_contact_id"))}
            >
              <option value="">Not set</option>
              {options.users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {canWriteNotes && (
          <Field
            id="nj-notes"
            label="Notes"
            error={err("notes")}
            description="Saved as a note on the job."
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              {...fieldAria("nj-notes", err("notes"), true)}
            />
          </Field>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {readOnly && (
          <p className="mr-auto text-sm text-muted-foreground">
            You&apos;re viewing as another user. Exit View as user to create jobs.
          </p>
        )}
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="cta" disabled={saving || readOnly}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Briefcase aria-hidden />}
          Create job
        </Button>
      </div>
    </form>
  );
}

function defaultContact(a: AccountChoice | null): string {
  if (!a) return "";
  if (a.primaryContactId && a.contacts.some((c) => c.id === a.primaryContactId)) {
    return a.primaryContactId;
  }
  return a.contacts[0]?.id ?? "";
}

/** Search customers by name (row security decides who shows up). */
function AccountPicker({ onPick, error }: { onPick: (a: AccountChoice) => void; error?: string }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<AccountHit[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      const result = await searchAccounts({ q: term });
      if (mine !== seq.current) return;
      setSearching(false);
      if (!result.ok) {
        toast.error(result.error.message);
        setHits([]);
        return;
      }
      setHits(result.data);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function pick(id: string) {
    setLoadingId(id);
    const result = await getAccountChoice({ id });
    setLoadingId(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    onPick(result.data);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="nj-account-search">
        Search customers
        <span className="text-danger" aria-hidden>
          *
        </span>
      </Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="nj-account-search"
          type="search"
          autoComplete="off"
          placeholder="Customer or household name"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "nj-account-error" : "nj-account-help"}
        />
      </div>
      {error ? (
        <p id="nj-account-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p id="nj-account-help" className="text-xs text-muted-foreground">
          Type at least 2 letters.
        </p>
      )}
      <div aria-live="polite" className="text-sm">
        {searching && <p className="text-muted-foreground">Searching…</p>}
        {!searching && hits && hits.length === 0 && (
          <p className="text-muted-foreground">No customers match “{q.trim()}”.</p>
        )}
        {!searching && hits && hits.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border" aria-label="Matching customers">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => pick(h.id)}
                  disabled={loadingId !== null}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-medium break-words">{h.name}</span>
                    {h.city && (
                      <span className="block text-xs text-muted-foreground">{h.city}</span>
                    )}
                  </span>
                  {loadingId === h.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <span className="text-xs font-medium text-bb-forest">Choose</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
