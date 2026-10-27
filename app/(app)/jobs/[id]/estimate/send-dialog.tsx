"use client";

import * as React from "react";
import { Copy, ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/forms/field";
import { TOUCH } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import type { ActionResult } from "@/lib/actions/errors";
import { formatDate } from "@/lib/format/dates";

type SendInput = {
  id: string;
  channels: ("sms" | "email")[];
  sms_body?: string | null;
  email_subject?: string | null;
  email_body?: string | null;
};

/**
 * Send for signature (SPEC §7.5): text, email or both. Messages go through
 * the messaging adapters into the outbox as simulated — nothing reaches the
 * customer in this build. `{{link}}` is replaced with the proposal link.
 */
export function SendDialog({
  id,
  title,
  contact,
  messages,
  disabledReason,
  send,
  onSent,
  label = "Send for signature",
}: {
  id: string;
  title: string;
  contact: { name: string; mobile: string | null; email: string | null } | null;
  messages: { sms: string; emailSubject: string; emailBody: string };
  disabledReason: string | null;
  send: (input: SendInput) => Promise<ActionResult<{ url: string; expiresAt: string }>>;
  /** Called after a successful send (keep this dialog mounted to show the link). */
  onSent?: () => void;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [sms, setSms] = React.useState(!!contact?.mobile);
  const [email, setEmail] = React.useState(!!contact?.email);
  const [body, setBody] = React.useState(messages);
  const [result, setResult] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const { pending, run } = useRunAction();

  const openDialog = () => {
    setSms(!!contact?.mobile);
    setEmail(!!contact?.email);
    setBody(messages);
    setResult(null);
    setOpen(true);
  };

  const submit = () => {
    const channels: ("sms" | "email")[] = [
      ...(sms ? ["sms" as const] : []),
      ...(email ? ["email" as const] : []),
    ];
    run(
      () =>
        send({
          id,
          channels,
          sms_body: sms ? body.sms : null,
          email_subject: email ? body.emailSubject : null,
          email_body: email ? body.emailBody : null,
        }),
      {
        success: "Sent (simulated).",
        onOk: (d) => {
          setResult(d);
          onSent?.();
        },
      },
    );
  };

  return (
    <>
      <Button
        className={TOUCH}
        onClick={openDialog}
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
      >
        <Send aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{result ? "Sent" : title}</DialogTitle>
            <DialogDescription>
              {result
                ? "The message is in the outbox as simulated; nothing was really sent. Open the link to see what the customer sees."
                : contact
                  ? `To ${contact.name}. Messages are simulated in this build.`
                  : "This job has no primary contact yet."}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input readOnly value={result.url} aria-label="Proposal link" className={TOUCH} />
                <Button
                  variant="outline"
                  className={TOUCH}
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard?.writeText(result.url);
                    toast.success("Link copied.");
                  }}
                >
                  <Copy aria-hidden />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                The link works until {formatDate(result.expiresAt)}. It&apos;s shown only now; send
                a new version to get a new link.
              </p>
              <DialogFooter>
                <Button asChild variant="outline" className={TOUCH}>
                  <a href={result.url} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                    Open proposal page
                  </a>
                </Button>
                <Button className={TOUCH} onClick={() => setOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Send by</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={sms}
                    disabled={!contact?.mobile}
                    onChange={(e) => setSms(e.target.checked)}
                  />
                  Text {contact?.mobile ? `(${contact.mobile})` : "(no mobile number)"}
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={email}
                    disabled={!contact?.email}
                    onChange={(e) => setEmail(e.target.checked)}
                  />
                  Email {contact?.email ? `(${contact.email})` : "(no email address)"}
                </label>
              </fieldset>
              {sms && (
                <Field
                  id="send-sms"
                  label="Text message"
                  description="{{link}} becomes the proposal link."
                >
                  <Textarea
                    id="send-sms"
                    rows={3}
                    value={body.sms}
                    onChange={(e) => setBody({ ...body, sms: e.target.value })}
                  />
                </Field>
              )}
              {email && (
                <>
                  <Field id="send-subject" label="Email subject">
                    <Input
                      id="send-subject"
                      className={TOUCH}
                      value={body.emailSubject}
                      onChange={(e) => setBody({ ...body, emailSubject: e.target.value })}
                    />
                  </Field>
                  <Field id="send-body" label="Email">
                    <Textarea
                      id="send-body"
                      rows={7}
                      value={body.emailBody}
                      onChange={(e) => setBody({ ...body, emailBody: e.target.value })}
                    />
                  </Field>
                </>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className={TOUCH}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className={TOUCH} disabled={pending || (!sms && !email)}>
                  <Send aria-hidden />
                  Send
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
