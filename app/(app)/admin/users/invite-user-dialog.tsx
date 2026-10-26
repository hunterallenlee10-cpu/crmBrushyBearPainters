"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  inviteUserSchema,
  type InviteUserInput,
  type InviteUserValues,
} from "@/lib/validation/users";
import { inviteUser } from "./actions";
import { NativeSelect, TOUCH, applyFieldErrors } from "./_components/form-bits";

export type RoleOption = { id: string; name: string; description: string | null };

const EMPTY: InviteUserInput = {
  full_name: "",
  email: "",
  role_template_id: "",
  title: "",
  department: "",
};

export function InviteUserDialog({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = React.useState(false);
  const form = useForm<InviteUserInput, unknown, InviteUserValues>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: EMPTY,
  });
  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = form;
  const err = (k: keyof InviteUserInput) => errors[k]?.message;
  const selectedRole = roles.find((r) => r.id === watch("role_template_id"));

  async function onSubmit() {
    const values = form.getValues();
    const result = await inviteUser(values);
    if (result.ok) {
      toast.success(
        result.data.emailRecorded
          ? `Invited ${values.full_name.trim()}. The invitation email is in the outbox as Simulated — nothing was sent.`
          : `Invited ${values.full_name.trim()}, but the invitation email couldn't be recorded. Tell them to sign in at /login.`,
      );
      reset(EMPTY);
      setOpen(false);
      return;
    }
    applyFieldErrors(setError, result.error);
    toast.error(result.error.message);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="cta" className={TOUCH}>
          <UserPlus aria-hidden /> Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They sign in with this email using a magic link or Google. In this build the invitation
            email is recorded in the outbox, not sent.
          </DialogDescription>
        </DialogHeader>
        <form
          id="invite-user-form"
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-4"
          noValidate
        >
          <Field id="invite-full_name" label="Full name" required error={err("full_name")}>
            <Input
              autoComplete="off"
              className={TOUCH}
              {...register("full_name")}
              {...fieldAria("invite-full_name", err("full_name"))}
            />
          </Field>
          <Field id="invite-email" label="Email" required error={err("email")}>
            <Input
              type="email"
              autoComplete="off"
              className={TOUCH}
              {...register("email")}
              {...fieldAria("invite-email", err("email"))}
            />
          </Field>
          <Field
            id="invite-role"
            label="Role"
            required
            error={err("role_template_id")}
            description={selectedRole?.description ?? "Decides what they can see and do."}
          >
            <NativeSelect
              {...register("role_template_id")}
              {...fieldAria("invite-role", err("role_template_id"), true)}
            >
              <option value="">Choose a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="invite-title" label="Title" error={err("title")}>
              <Input
                className={TOUCH}
                placeholder="e.g. Crew Lead"
                {...register("title")}
                {...fieldAria("invite-title", err("title"))}
              />
            </Field>
            <Field id="invite-department" label="Department" error={err("department")}>
              <Input
                className={TOUCH}
                placeholder="e.g. Field"
                {...register("department")}
                {...fieldAria("invite-department", err("department"))}
              />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-user-form" className={TOUCH} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
