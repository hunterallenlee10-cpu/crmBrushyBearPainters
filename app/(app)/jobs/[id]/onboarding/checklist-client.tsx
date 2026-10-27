"use client";

import * as React from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDashed,
  ListPlus,
  MinusCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
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
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { UploadDocumentDialog } from "@/components/documents/upload-dialog";
import {
  ONBOARDING_GROUP_LABELS,
  ONBOARDING_STATUS_LABELS,
  type OnboardingGroup,
  type OnboardingStatus,
} from "@/lib/estimating/engine";
import {
  UPLOAD_CATEGORY,
  groupChecklist,
  requirementActions,
  summaryLine,
  type ChecklistSummary,
  type RequirementAction,
} from "@/lib/domain/onboarding/checklist";
import { isOnboardingKey } from "@/lib/domain/onboarding/rules";
import type { RequestDraft } from "@/lib/onboarding/messages";
import type { Option } from "@/lib/leads/service";
import { formatDate, formatRelative } from "@/lib/format/dates";
import {
  clearRequirement,
  createRequirementTask,
  reopenRequirement,
  requestFromCustomer,
  reverifyOnboarding,
} from "./actions";

export type ChecklistItem = {
  id: string;
  key: string;
  group: string;
  label: string;
  required: boolean;
  ownerRole: string | null;
  status: string;
  verifiedAuto: boolean;
  verifiedAt: string | null;
  verifiedByName: string | null;
  note: string | null;
  detail: string | null;
  requestedAt: string | null;
  hasTask: boolean;
  when: string | null;
  draft: RequestDraft | null;
};

const ICONS: Record<OnboardingStatus, React.ComponentType<{ className?: string }>> = {
  verified: CheckCircle2,
  pending: Circle,
  missing: CircleAlert,
  needs_review: CircleDashed,
  not_required: MinusCircle,
};
const CHIP: Record<OnboardingStatus, string> = {
  verified: "bg-success-bg text-success",
  pending: "bg-neutral-bg text-neutral",
  missing: "bg-danger-bg text-danger",
  needs_review: "bg-warning-bg text-warning",
  not_required: "bg-neutral-bg text-neutral",
};
const ROLE_LABELS: Record<string, string> = {
  estimator: "Estimator",
  office: "Office",
  point_of_contact: "Point of contact",
  project_manager: "Project manager",
};

const asStatus = (s: string): OnboardingStatus =>
  s in ICONS ? (s as OnboardingStatus) : "pending";

/**
 * The grouped requirement checklist (SPEC §6.4): each item's status chip and
 * what the check found, its owner, and the actions Request from customer,
 * Upload, Create task, Mark cleared with a note (or Reopen a manual clear).
 */
export function ChecklistClient({
  jobId,
  items,
  summary,
  lastCheckedAt,
  users,
  defaultAssignee,
  can,
}: {
  jobId: string;
  items: ChecklistItem[];
  summary: ChecklistSummary | null;
  lastCheckedAt: string | null;
  users: Option[];
  defaultAssignee: string;
  can: { edit: boolean; request: boolean; upload: boolean; task: boolean };
}) {
  const { pending, run } = useRunAction();
  const [dialog, setDialog] = React.useState<{
    kind: RequirementAction;
    item: ChecklistItem;
  } | null>(null);
  const groups = groupChecklist(items);

  const allowed = (a: RequirementAction) =>
    a === "request"
      ? can.request
      : a === "upload"
        ? can.upload
        : a === "task"
          ? can.task
          : can.edit;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card px-4 py-3">
        <p className="text-sm font-medium" data-testid="onboarding-summary">
          {summary ? summaryLine(summary) : "No required items"}
          {lastCheckedAt && (
            <span className="block text-xs font-normal text-muted-foreground">
              Checked {formatRelative(lastCheckedAt)} · runs on its own every few minutes
            </span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => reverifyOnboarding({ jobId }), {
              success: (d) =>
                d.advanced
                  ? "Everything is cleared. The job moved to Ready to Schedule."
                  : d.changed
                    ? `Re-verified: ${d.changed} item${d.changed === 1 ? "" : "s"} changed.`
                    : "Re-verified. Nothing changed.",
            })
          }
        >
          <RefreshCw aria-hidden /> Re-verify all
        </Button>
      </div>

      {groups.map((g) => (
        <section key={g.group} aria-label={ONBOARDING_GROUP_LABELS[g.group as OnboardingGroup]}>
          <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
            {ONBOARDING_GROUP_LABELS[g.group as OnboardingGroup]}
          </h3>
          <ul className="divide-y rounded-2xl border bg-card">
            {g.items.map((r) => {
              const status = asStatus(r.status);
              const Icon = ICONS[status];
              const actions = requirementActions(r).filter(allowed);
              const manual = status === "verified" && !r.verifiedAuto;
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start"
                  data-testid={`requirement-${r.key}`}
                >
                  <Icon
                    className={`mt-0.5 size-5 shrink-0 ${status === "verified" ? "text-success" : status === "missing" ? "text-danger" : status === "needs_review" ? "text-warning" : "text-muted-foreground"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {r.label}
                      {!r.required && (
                        <span className="font-normal text-muted-foreground"> (not required)</span>
                      )}
                    </p>
                    {r.detail && <p className="text-xs text-muted-foreground">{r.detail}</p>}
                    {manual && r.note && (
                      <p className="text-xs">
                        <ShieldCheck className="mr-1 inline size-3 text-success" aria-hidden />
                        Cleared by {r.verifiedByName ?? "a teammate"}
                        {r.verifiedAt ? ` on ${formatDate(r.verifiedAt)}` : ""}: {r.note}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.ownerRole ? `Owner: ${ROLE_LABELS[r.ownerRole] ?? r.ownerRole}` : null}
                      {r.requestedAt ? ` · Requested ${formatRelative(r.requestedAt)}` : ""}
                      {r.hasTask ? " · Task created" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[status]}`}
                      data-testid="requirement-status"
                    >
                      {status === "verified" && r.verifiedAuto
                        ? "Auto-verified"
                        : status === "verified"
                          ? "Cleared"
                          : ONBOARDING_STATUS_LABELS[status]}
                    </span>
                    {actions.map((a) => (
                      <ActionButton
                        key={a}
                        action={a}
                        label={r.label}
                        disabled={pending}
                        onClick={() =>
                          a === "reopen"
                            ? run(() => reopenRequirement({ jobId, requirementId: r.id }), {
                                success: "Reopened. The check will run again.",
                              })
                            : setDialog({ kind: a, item: r })
                        }
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {dialog?.kind === "clear" && (
        <ClearDialog jobId={jobId} item={dialog.item} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "request" && dialog.item.draft && (
        <RequestDialog
          jobId={jobId}
          item={dialog.item}
          draft={dialog.item.draft}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "task" && (
        <TaskDialog
          jobId={jobId}
          item={dialog.item}
          users={users}
          defaultAssignee={defaultAssignee}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "upload" && isOnboardingKey(dialog.item.key) && (
        <UploadDocumentDialog
          target={{ jobId }}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          defaultCategory={UPLOAD_CATEGORY[dialog.item.key]}
          title={`Upload: ${dialog.item.label}`}
          description="It's stored in Documents and the item re-checks itself."
        />
      )}
    </div>
  );
}

function ActionButton({
  action,
  label,
  disabled,
  onClick,
}: {
  action: RequirementAction;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const map = {
    request: { text: "Request", icon: Send },
    upload: { text: "Upload", icon: Upload },
    task: { text: "Task", icon: ListPlus },
    clear: { text: "Mark cleared", icon: CheckCircle2 },
    reopen: { text: "Reopen", icon: RotateCcw },
  } as const;
  const { text, icon: Icon } = map[action];
  return (
    <Button
      type="button"
      size="sm"
      variant={action === "clear" ? "secondary" : "outline"}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${text}: ${label}`}
    >
      <Icon aria-hidden /> {text}
    </Button>
  );
}

function ClearDialog({
  jobId,
  item,
  onClose,
}: {
  jobId: string;
  item: ChecklistItem;
  onClose: () => void;
}) {
  const { pending, run } = useRunAction();
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark cleared: {item.label}</DialogTitle>
          <DialogDescription>
            Say how you know it&apos;s done. The note is saved with your name and the checks
            won&apos;t undo it.
          </DialogDescription>
        </DialogHeader>
        <Field id="clear-note" label="How was it cleared?" required error={errors.note}>
          <Textarea
            id="clear-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Check #1042 received at the office"
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => clearRequirement({ jobId, requirementId: item.id, note }), {
                success: (d) =>
                  d.advanced
                    ? "Cleared. Everything is done, so the job moved to Ready to Schedule."
                    : "Cleared.",
                onOk: onClose,
                onError: (e) => setErrors(firstErrors(e)),
              })
            }
          >
            Mark cleared
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDialog({
  jobId,
  item,
  draft,
  onClose,
}: {
  jobId: string;
  item: ChecklistItem;
  draft: RequestDraft;
  onClose: () => void;
}) {
  const { pending, run } = useRunAction();
  const [channel, setChannel] = React.useState<"email" | "sms">("email");
  const [subject, setSubject] = React.useState(draft.emailSubject);
  const [body, setBody] = React.useState(draft.emailBody);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const switchTo = (c: "email" | "sms") => {
    setChannel(c);
    setBody(c === "sms" ? draft.sms : draft.emailBody);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request from customer: {item.label}</DialogTitle>
          <DialogDescription>
            Simulated – not sent: it goes to the outbox until texting and email are connected. Draft
            wording – owner to approve.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field id="req-channel" label="Send by">
            <NativeSelect
              id="req-channel"
              value={channel}
              onChange={(e) => switchTo(e.target.value as "email" | "sms")}
            >
              <option value="email">Email</option>
              <option value="sms">Text</option>
            </NativeSelect>
          </Field>
          {channel === "email" && (
            <Field id="req-subject" label="Subject" error={errors.subject}>
              <Input
                id="req-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
          )}
          <Field id="req-body" label="Message" error={errors.body}>
            <Textarea
              id="req-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="cta"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  requestFromCustomer({
                    jobId,
                    requirementId: item.id,
                    channel,
                    subject: channel === "email" ? subject : undefined,
                    body,
                    templateKey: draft.templateKey,
                  }),
                {
                  success: "Recorded in the outbox (simulated – not sent).",
                  onOk: onClose,
                  onError: (e) => setErrors(firstErrors(e)),
                },
              )
            }
          >
            <Send aria-hidden /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({
  jobId,
  item,
  users,
  defaultAssignee,
  onClose,
}: {
  jobId: string;
  item: ChecklistItem;
  users: Option[];
  defaultAssignee: string;
  onClose: () => void;
}) {
  const { pending, run } = useRunAction();
  const [title, setTitle] = React.useState(`Onboarding: ${item.label}`.slice(0, 200));
  const [dueDate, setDueDate] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState(
    users.some((u) => u.value === defaultAssignee) ? defaultAssignee : (users[0]?.value ?? ""),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a task</DialogTitle>
          <DialogDescription>
            It shows in Tasks &amp; Checklists and on the person&apos;s My Day.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field id="ob-task-title" label="Title" error={errors.title}>
            <Input id="ob-task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="ob-task-due" label="Due (optional)" error={errors.dueDate}>
            <Input
              id="ob-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field id="ob-task-assignee" label="For" error={errors.assigneeId}>
            <NativeSelect
              id="ob-task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  createRequirementTask({
                    jobId,
                    requirementId: item.id,
                    title,
                    dueDate: dueDate || undefined,
                    assigneeId,
                  }),
                {
                  success: "Task created.",
                  onOk: onClose,
                  onError: (e) => setErrors(firstErrors(e)),
                },
              )
            }
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
