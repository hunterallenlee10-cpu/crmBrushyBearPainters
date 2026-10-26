"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createAccountSchema,
  suggestDisplayName,
  type CreateAccountInput,
  type CreateAccountValues,
} from "@/lib/validation/accounts";
import { createAccount } from "../actions";
import { AccountFields, ContactFields, PropertyFields } from "./fields";
import { applyFieldErrors, TOUCH, type AccountFormOptions } from "./form-bits";
import { emptyAccount, emptyContact, emptyProperty } from "./defaults";

/** "New account": the account, its primary contact and primary property in one step. */
export function NewAccountDialog({
  options,
  viewerId,
}: {
  options: AccountFormOptions;
  viewerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const empty = React.useMemo<CreateAccountInput>(
    () => ({
      account: emptyAccount(viewerId),
      contact: emptyContact("primary"),
      property: emptyProperty(true),
    }),
    [viewerId],
  );
  const form = useForm<CreateAccountInput, unknown, CreateAccountValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: empty,
  });
  const {
    control,
    setValue,
    handleSubmit,
    setError,
    reset,
    formState: { isSubmitting, dirtyFields },
  } = form;
  const nameTyped = Boolean(dirtyFields.account?.display_name);

  // Suggest "Lastname Residence" until the name is typed by hand.
  const [type, first, last] = useWatch({
    control,
    name: ["account.account_type", "contact.first_name", "contact.last_name"],
  });
  React.useEffect(() => {
    if (nameTyped) return;
    setValue("account.display_name", suggestDisplayName(type, last, first));
  }, [type, first, last, nameTyped, setValue]);

  async function onSubmit() {
    const result = await createAccount(form.getValues());
    if (!result.ok) {
      applyFieldErrors(setError, result.error);
      toast.error(result.error.message);
      return;
    }
    toast.success("Account created.");
    router.push(`/accounts/${result.data.id}`);
    setOpen(false);
    reset(empty);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(empty);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="cta" className={TOUCH}>
          <Plus aria-hidden />
          New account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            A household or customer, with the main person to talk to and the home we&apos;d paint.
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            id="new-account-form"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col gap-6"
          >
            <section aria-labelledby="new-account-contact" className="flex flex-col gap-3">
              <h3 id="new-account-contact" className="text-sm font-semibold text-bb-forest">
                Primary contact
              </h3>
              <ContactFields idPrefix="new" hideRole />
            </section>
            <section aria-labelledby="new-account-property" className="flex flex-col gap-3">
              <h3 id="new-account-property" className="text-sm font-semibold text-bb-forest">
                Property
              </h3>
              <PropertyFields idPrefix="new" options={options} compact />
            </section>
            <section aria-labelledby="new-account-account" className="flex flex-col gap-3">
              <h3 id="new-account-account" className="text-sm font-semibold text-bb-forest">
                Account
              </h3>
              <AccountFields idPrefix="new" options={options} />
            </section>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-account-form" className={TOUCH} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
