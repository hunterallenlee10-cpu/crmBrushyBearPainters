"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import type { ActionResult } from "@/lib/actions/errors";
import {
  accountSchema,
  contactSchema,
  propertySchema,
  type AccountInput,
  type AccountValues,
  type ContactInput,
  type ContactValues,
  type PropertyInput,
  type PropertyValues,
} from "@/lib/validation/accounts";
import { z } from "zod";
import {
  createProperty,
  deleteAccount,
  deleteProperty,
  setPrimaryContact,
  updateAccount,
  updateProperty,
} from "../actions";
import { createContact, deleteContact, updateContact } from "../../contacts/actions";
import { AccountFields, ContactFields, PropertyFields } from "./fields";
import { applyFieldErrors, TOUCH, type AccountFormOptions } from "./form-bits";
import {
  accountToInput,
  contactToInput,
  emptyContact,
  emptyProperty,
  propertyToInput,
  type AccountRowForForm,
  type ContactRowForForm,
  type PropertyRowForForm,
} from "./defaults";

/** Edit/add dialogs on the account and contact detail pages. */

const accountForm = z.object({ account: accountSchema });
const contactForm = z.object({ contact: contactSchema });
const propertyForm = z.object({ property: propertySchema });

type Failure = { ok: false; error: { message: string } };

function useRefreshAfter() {
  const router = useRouter();
  return React.useCallback(
    (message: string) => {
      toast.success(message);
      router.refresh();
    },
    [router],
  );
}

// -----------------------------------------------------------------------------
// Account
// -----------------------------------------------------------------------------

export function EditAccountDialog({
  accountId,
  account,
  options,
}: {
  accountId: string;
  account: AccountRowForForm;
  options: AccountFormOptions;
}) {
  const [open, setOpen] = React.useState(false);
  const done = useRefreshAfter();
  const defaults = React.useMemo(() => ({ account: accountToInput(account) }), [account]);
  const form = useForm<{ account: AccountInput }, unknown, { account: AccountValues }>({
    resolver: zodResolver(accountForm),
    defaultValues: defaults,
  });

  async function onSubmit() {
    const result = await updateAccount({ id: accountId, account: form.getValues().account });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error);
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    done("Account saved.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className={TOUCH}>
          <Pencil aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>Name, type, status, owner and tags.</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form id="edit-account-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <AccountFields idPrefix="edit" options={options} />
          </form>
        </FormProvider>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton form="edit-account-form" busy={form.formState.isSubmitting}>
            Save account
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Contact
// -----------------------------------------------------------------------------

export function ContactDialog(
  props:
    | { mode: "add"; accountId: string; trigger?: "button" | "small" }
    | { mode: "edit"; contact: ContactRowForForm; trigger?: "button" | "small" },
) {
  const [open, setOpen] = React.useState(false);
  const done = useRefreshAfter();
  const editing = props.mode === "edit" ? props.contact : null;
  const defaults = React.useMemo(
    () => ({ contact: editing ? contactToInput(editing) : emptyContact("spouse_partner") }),
    [editing],
  );
  const form = useForm<{ contact: ContactInput }, unknown, { contact: ContactValues }>({
    resolver: zodResolver(contactForm),
    defaultValues: defaults,
  });
  const formId = editing ? `edit-contact-${editing.id}` : "add-contact-form";

  async function onSubmit() {
    const contact = form.getValues().contact;
    const result =
      props.mode === "edit"
        ? await updateContact({ id: props.contact.id, contact })
        : await createContact({ account_id: props.accountId, contact });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error);
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    done(props.mode === "edit" ? "Contact saved." : "Contact added.");
  }

  const name = editing ? [editing.first_name, editing.last_name].filter(Boolean).join(" ") : "";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button
            variant="outline"
            size={props.trigger === "small" ? "sm" : "default"}
            className={props.trigger === "small" ? undefined : TOUCH}
            aria-label={props.trigger === "small" ? `Edit ${name}` : undefined}
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            Add contact
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${name}` : "Add a contact"}</DialogTitle>
          <DialogDescription>
            Phone numbers and consent are saved exactly as entered here. Nothing is sent.
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ContactFields
              idPrefix={editing ? `c-${editing.id.slice(0, 8)}` : "add"}
              optedOutAt={editing?.opted_out_at}
              smsOptInAt={editing?.sms_opt_in_at}
              emailOptInAt={editing?.email_opt_in_at}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton form={formId} busy={form.formState.isSubmitting}>
            {editing ? "Save contact" : "Add contact"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MakePrimaryButton({
  accountId,
  contactId,
  name,
}: {
  accountId: string;
  contactId: string;
  name: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const done = useRefreshAfter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      aria-label={`Make ${name} the primary contact`}
      onClick={async () => {
        setBusy(true);
        const result = await setPrimaryContact({ account_id: accountId, contact_id: contactId });
        setBusy(false);
        if (!result.ok) return toast.error(result.error.message);
        done(`${name} is now the primary contact.`);
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Star aria-hidden />}
      Make primary
    </Button>
  );
}

// -----------------------------------------------------------------------------
// Property
// -----------------------------------------------------------------------------

export function PropertyDialog(
  props:
    | { mode: "add"; accountId: string; options: AccountFormOptions }
    | { mode: "edit"; property: PropertyRowForForm; options: AccountFormOptions; label: string },
) {
  const [open, setOpen] = React.useState(false);
  const done = useRefreshAfter();
  const editing = props.mode === "edit" ? props.property : null;
  const defaults = React.useMemo(
    () => ({ property: editing ? propertyToInput(editing) : emptyProperty(false) }),
    [editing],
  );
  const form = useForm<{ property: PropertyInput }, unknown, { property: PropertyValues }>({
    resolver: zodResolver(propertyForm),
    defaultValues: defaults,
  });
  const formId = editing ? `edit-property-${editing.id}` : "add-property-form";

  async function onSubmit() {
    const property = form.getValues().property;
    const result =
      props.mode === "edit"
        ? await updateProperty({ id: props.property.id, property })
        : await createProperty({ account_id: props.accountId, property });
    if (!result.ok) {
      applyFieldErrors(form.setError, result.error);
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    done(props.mode === "edit" ? "Property saved." : "Property added.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        {props.mode === "edit" ? (
          <Button variant="outline" size="sm" aria-label={`Edit property ${props.label}`}>
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden />
            Add property
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit property" : "Add a property"}</DialogTitle>
          <DialogDescription>
            The ZIP code sets the territory. Homes built before 1978 (or unknown) are flagged for
            lead-safe work.
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form id={formId} onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <PropertyFields
              idPrefix={editing ? `p-${editing.id.slice(0, 8)}` : "addp"}
              options={props.options}
              showPrimary
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton form={formId} busy={form.formState.isSubmitting}>
            {editing ? "Save property" : "Add property"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Delete (soft delete with a reason; owners can restore from Admin → Deleted records)
// -----------------------------------------------------------------------------

const KIND_LABEL = { account: "account", contact: "contact", property: "property" } as const;

export function DeleteRecordDialog({
  kind,
  id,
  label,
  redirectTo,
  size = "default",
}: {
  kind: "account" | "contact" | "property";
  id: string;
  label: string;
  /** Where to go after deleting (detail pages); otherwise the page refreshes. */
  redirectTo?: string;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fieldId = `delete-${kind}-${id.slice(0, 8)}-reason`;

  async function confirm() {
    if (reason.trim().length < 3) {
      setError("Give a short reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    const run: () => Promise<ActionResult<unknown> | Failure> =
      kind === "account"
        ? () => deleteAccount({ id, reason })
        : kind === "contact"
          ? () => deleteContact({ id, reason })
          : () => deleteProperty({ id, reason });
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    toast.success(`Deleted ${label}. An owner can restore it from Admin → Deleted records.`);
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setReason("");
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={size === "default" ? `${TOUCH} text-danger` : "text-danger"}
          aria-label={size === "sm" ? `Delete ${label}` : undefined}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this {KIND_LABEL[kind]}?</DialogTitle>
          <DialogDescription>
            {kind === "account"
              ? `${label} and its contacts and properties disappear from lists and search.`
              : `${label} disappears from lists and search.`}{" "}
            Nothing is erased: an owner can restore it.
          </DialogDescription>
        </DialogHeader>
        <Field id={fieldId} label="Reason" required error={error ?? undefined}>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            {...fieldAria(fieldId, error ?? undefined)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={TOUCH}
            disabled={busy}
            onClick={confirm}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Delete {KIND_LABEL[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({
  form,
  busy,
  children,
}: {
  form: string;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" form={form} className={TOUCH} disabled={busy}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
