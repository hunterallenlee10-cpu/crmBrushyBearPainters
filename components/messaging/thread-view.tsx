"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  Loader2,
  Mail,
  MailOpen,
  MessageSquareText,
  Phone,
  Send,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmsCounter } from "@/components/leads/sms-counter";
import { useRunAction } from "@/components/forms/use-run-action";
import type { ActionResult } from "@/lib/actions/errors";
import { formatDateTime } from "@/lib/format/dates";
import type { ThreadDetail } from "@/lib/messaging/inbox";
import { cn } from "@/lib/utils";
import { markThread } from "@/app/(app)/messages/actions";
import { sendJobEmailAction, sendJobSmsAction } from "@/app/(app)/jobs/[id]/_sections/actions";
import { sendEmail, sendSms } from "@/app/(app)/leads/[id]/actions";
import { TemplatePicker, type TemplateOption } from "./template-picker";

type Sent = { messageId: string; outboxId: string };

/**
 * One conversation (SPEC §5.7): messages oldest first, marked read when someone
 * who can reply opens it, and a reply box (text or email) that goes through the
 * lead's or job's own send rules (consent, Do Not Contact, simulated outbox).
 */
export function ThreadView({
  thread,
  canReply,
  readOnly,
  blocks,
  templates,
}: {
  thread: ThreadDetail;
  canReply: boolean;
  readOnly: boolean;
  blocks: { sms: string | null; email: string | null };
  templates: readonly TemplateOption[];
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [channel, setChannel] = React.useState<"sms" | "email">(
    blocks.sms && !blocks.email ? "email" : "sms",
  );
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const marked = React.useRef(false);
  const kind =
    thread.subjectType === "job" || thread.subjectType === "lead" ? thread.subjectType : null;

  React.useEffect(() => {
    if (marked.current || !thread.unread || !canReply || readOnly) return;
    marked.current = true;
    void markThread({ threadId: thread.id, read: true }).then(() => router.refresh());
  }, [thread.id, thread.unread, canReply, readOnly, router]);

  const block = blocks[channel];
  const send = () => {
    if (!kind) return;
    const call = (): Promise<ActionResult<Sent>> => {
      if (kind === "job") {
        return channel === "sms"
          ? sendJobSmsAction({ job_id: thread.subjectId, body })
          : sendJobEmailAction({ job_id: thread.subjectId, subject, body });
      }
      return channel === "sms"
        ? sendSms({ lead_id: thread.subjectId, body })
        : sendEmail({ lead_id: thread.subjectId, subject, body });
    };
    run(call, {
      success: "Recorded in the outbox (simulated – not sent).",
      onOk: () => {
        setBody("");
        setSubject("");
        router.refresh();
      },
    });
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{thread.title}</h2>
          <p className="text-sm text-muted-foreground">
            {thread.subtitle}
            {thread.contact ? ` · ${thread.contact.name}` : ""}
            {thread.readAt && !thread.unread
              ? ` · read ${formatDateTime(thread.readAt)}${thread.readBy ? ` by ${thread.readBy}` : ""}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {thread.href && (
            <Button asChild variant="outline" size="sm">
              <Link href={thread.href}>Open {thread.subjectType}</Link>
            </Button>
          )}
          {canReply && !thread.unread && thread.lastInboundAt && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || readOnly}
              onClick={() =>
                run(() => markThread({ threadId: thread.id, read: false }), {
                  success: "Marked unread.",
                  onOk: () => router.refresh(),
                })
              }
            >
              <Mail className="size-4" aria-hidden /> Mark unread
            </Button>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-3" aria-label="Messages in this conversation">
        {thread.messages.map((m) => {
          const inbound = m.direction === "inbound";
          const Icon =
            m.channel === "sms"
              ? MessageSquareText
              : m.channel === "email"
                ? inbound
                  ? Mail
                  : MailOpen
                : Phone;
          return (
            <li key={m.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl border px-3 py-2 text-sm",
                  inbound ? "bg-card" : "border-bb-forest/20 bg-accent",
                )}
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden />
                  <span>
                    {inbound
                      ? "Customer"
                      : (m.sentBy ?? (m.automatic ? "Automatic" : "Brushy Bear"))}
                  </span>
                  <span>· {formatDateTime(m.at)}</span>
                  {m.automatic && (
                    <Badge variant="outline" className="gap-1">
                      <Bot className="size-3" aria-hidden /> Workflow
                    </Badge>
                  )}
                  {m.marketing && <Badge variant="info">Marketing</Badge>}
                  {m.simulated && !inbound && <Badge variant="neutral">Simulated – not sent</Badge>}
                </div>
                {m.subject && <p className="font-medium">{m.subject}</p>}
                <p className="whitespace-pre-line">
                  {m.body ?? m.callOutcome?.replace(/_/g, " ") ?? ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {canReply && kind && (
        <form
          className="mt-auto flex flex-col gap-3 rounded-2xl border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          aria-label="Reply"
        >
          <div className="flex gap-2" role="radiogroup" aria-label="Channel">
            {(["sms", "email"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={channel === c ? "default" : "outline"}
                role="radio"
                aria-checked={channel === c}
                onClick={() => setChannel(c)}
              >
                {c === "sms" ? "Text" : "Email"}
              </Button>
            ))}
          </div>
          {block ? (
            <p className="flex items-start gap-2 rounded-xl bg-warning-bg p-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {block}
            </p>
          ) : (
            <>
              <TemplatePicker
                subjectType={kind}
                subjectId={thread.subjectId}
                channel={channel}
                templates={templates}
                disabled={readOnly}
                idPrefix="reply-tpl"
                onPick={(t) => {
                  setBody(t.body);
                  if (t.subject) setSubject(t.subject);
                }}
              />
              {channel === "email" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="reply-subject">Subject</Label>
                  <Input
                    id="reply-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor="reply-body">Message</Label>
                <Textarea
                  id="reply-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  disabled={readOnly}
                />
                {channel === "sms" && <SmsCounter text={body} />}
              </div>
              <div>
                <Button
                  type="submit"
                  disabled={
                    pending || readOnly || !body.trim() || (channel === "email" && !subject.trim())
                  }
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4" aria-hidden />
                  )}
                  Send {channel === "sms" ? "text" : "email"}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
