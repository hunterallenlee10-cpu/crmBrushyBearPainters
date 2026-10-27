"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Braces, Eye, Loader2, Power, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  type TemplateCategory,
} from "@/lib/domain/templates/defaults";
import {
  MERGE_FIELDS,
  renderTemplate,
  sampleContext,
  validateTemplate,
  type MergeContext,
} from "@/lib/domain/templates/merge";
import { asciiPunctuation } from "@/lib/domain/templates/words";
import { countSms, describeSmsCount } from "@/lib/leads/messaging";
import {
  approveTemplate,
  previewTemplate,
  saveTemplate,
  setTemplateActive,
} from "@/app/(app)/admin/templates/actions";

export type EditableTemplate = {
  id: string | null;
  key: string;
  channel: "sms" | "email";
  name: string;
  description: string;
  category: TemplateCategory;
  messageType: "transactional" | "marketing";
  subject: string;
  body: string;
  active: boolean;
  status: "draft" | "approved";
  approvedBy: string | null;
  approvedAt: string | null;
  isSystem: boolean;
};

type PreviewResult = { subject: string | null; body: string; missing: string[]; placeholders: string[] };

const GROUPS = [...new Set(MERGE_FIELDS.map((f) => f.group))];

/**
 * Template editor (SPEC §11.3): merge-field palette, live preview (sample
 * values, or a real job's), and the SMS character / segment counter.
 * Texts are previewed the way they're sent (plain dashes and quotes).
 */
export function TemplateEditor({
  template,
  company,
  jobs,
  canApprove,
  readOnly,
  usedBy,
}: {
  template: EditableTemplate;
  company: MergeContext;
  jobs: readonly { id: string; label: string }[];
  canApprove: boolean;
  readOnly: boolean;
  usedBy: readonly string[];
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [t, setT] = React.useState(template);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [focus, setFocus] = React.useState<"body" | "subject">("body");
  const [jobId, setJobId] = React.useState("");
  const [real, setReal] = React.useState<PreviewResult | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const isNew = !template.id;
  const dirty = JSON.stringify(t) !== JSON.stringify(template);

  const sample = React.useMemo(() => sampleContext({ company }), [company]);
  const local = renderTemplate(t.body, sample, { missingAs: "marker" });
  const localSubject = t.subject ? renderTemplate(t.subject, sample, { missingAs: "marker" }) : null;
  const preview = real ?? {
    subject: localSubject?.text ?? null,
    body: t.channel === "sms" ? asciiPunctuation(local.text) : local.text,
    missing: [],
    placeholders: local.placeholders,
  };
  const issues = [...validateTemplate(t.body), ...(t.subject ? validateTemplate(t.subject) : [])];
  const sms = countSms(t.channel === "sms" ? preview.body : "");

  const set = <K extends keyof EditableTemplate>(k: K, v: EditableTemplate[K]) => {
    setReal(null);
    setT((x) => ({ ...x, [k]: v }));
  };

  const insert = (path: string, filter?: string) => {
    const tag = filter ? `{{${path} | ${filter}}}` : `{{${path}}}`;
    if (focus === "subject" && t.channel === "email") {
      const el = subjectRef.current;
      const pos = el?.selectionStart ?? t.subject.length;
      set("subject", t.subject.slice(0, pos) + tag + t.subject.slice(pos));
      return;
    }
    const el = bodyRef.current;
    const start = el?.selectionStart ?? t.body.length;
    const end = el?.selectionEnd ?? start;
    set("body", t.body.slice(0, start) + tag + t.body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const save = () =>
    run(
      () =>
        saveTemplate({
          id: t.id ?? undefined,
          key: isNew ? t.key : undefined,
          channel: t.channel,
          name: t.name,
          description: t.description,
          category: t.category,
          messageType: t.messageType,
          subject: t.channel === "email" ? t.subject : undefined,
          body: t.body,
          active: t.active,
        }),
      {
        success: "Saved. The wording is a draft until an owner approves it.",
        onOk: (r) => {
          setErrors({});
          if (isNew) router.push(`/admin/templates/${r.id}`);
          else router.refresh();
        },
        onError: (e) =>
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""]))),
      },
    );

  const fillFromJob = (id: string) => {
    setJobId(id);
    if (!id) {
      setReal(null);
      return;
    }
    run(
      () =>
        previewTemplate({
          body: t.body,
          subject: t.channel === "email" ? t.subject : undefined,
          channel: t.channel,
          messageType: t.messageType,
          jobId: id,
        }),
      { onOk: (r) => setReal(r) },
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {t.status === "draft" ? (
            <Badge variant="sample">Draft – owner to approve</Badge>
          ) : (
            <Badge variant="success">Approved{t.approvedBy ? ` by ${t.approvedBy}` : ""}</Badge>
          )}
          {t.isSystem && <Badge variant="outline">System template</Badge>}
          {!t.active && <Badge variant="neutral">Off</Badge>}
          {usedBy.length > 0 && <span className="text-xs text-muted-foreground">Used by {usedBy.join(", ")}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={t.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} disabled={readOnly} />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-key">Key</Label>
            <Input
              id="tpl-key"
              value={t.key}
              onChange={(e) => set("key", e.target.value.toLowerCase())}
              disabled={!isNew || readOnly}
              aria-invalid={!!errors.key}
              aria-describedby="tpl-key-help"
            />
            <p id="tpl-key-help" className="text-xs text-muted-foreground">
              {isNew ? "Lowercase letters, numbers and _. It can't change later." : "Messages remember the key they came from."}
            </p>
            {errors.key && <p className="text-sm text-destructive">{errors.key}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-channel">Channel</Label>
            <NativeSelect id="tpl-channel" value={t.channel} onChange={(e) => set("channel", e.target.value as "sms" | "email")} disabled={!isNew || readOnly}>
              <option value="sms">Text (SMS)</option>
              <option value="email">Email</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-cat">Category</Label>
            <NativeSelect id="tpl-cat" value={t.category} onChange={(e) => set("category", e.target.value as TemplateCategory)} disabled={readOnly}>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TEMPLATE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-type">Kind of message</Label>
            <NativeSelect
              id="tpl-type"
              value={t.messageType}
              onChange={(e) => set("messageType", e.target.value as "transactional" | "marketing")}
              disabled={readOnly}
              aria-describedby="tpl-type-help"
            >
              <option value="transactional">About their project (transactional)</option>
              <option value="marketing">Marketing</option>
            </NativeSelect>
            <p id="tpl-type-help" className="text-xs text-muted-foreground">
              Marketing needs an opt-in for texts, gets “Reply STOP to opt out” or the unsubscribe footer, and never goes to anyone who opted out.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Input id="tpl-desc" value={t.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} />
          </div>
        </div>
        {t.channel === "email" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input
              id="tpl-subject"
              ref={subjectRef}
              value={t.subject}
              onFocus={() => setFocus("subject")}
              onChange={(e) => set("subject", e.target.value)}
              aria-invalid={!!errors.subject}
              disabled={readOnly}
            />
            {errors.subject && <p className="text-sm text-destructive">{errors.subject}</p>}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="tpl-body">Message</Label>
            {t.channel === "sms" && (
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {describeSmsCount(sms)} (with sample values)
              </span>
            )}
          </div>
          <Textarea
            id="tpl-body"
            ref={bodyRef}
            value={t.body}
            rows={t.channel === "sms" ? 5 : 14}
            onFocus={() => setFocus("body")}
            onChange={(e) => set("body", e.target.value)}
            aria-invalid={!!errors.body || issues.length > 0}
            aria-describedby="tpl-body-issues"
            className="font-mono text-sm"
            disabled={readOnly}
          />
          <div id="tpl-body-issues">
            {issues.map((i) => (
              <p key={i.detail} className="text-sm text-destructive">{i.detail}</p>
            ))}
            {errors.body && <p className="text-sm text-destructive">{errors.body}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending || readOnly || issues.length > 0 || (!dirty && !isNew)}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {isNew ? "Create template" : "Save"}
          </Button>
          {!isNew && canApprove && t.status === "draft" && (
            <Button
              variant="outline"
              disabled={pending || dirty || readOnly}
              title={dirty ? "Save your changes first." : undefined}
              onClick={() =>
                run(() => approveTemplate({ id: t.id as string }), {
                  success: "Approved. This wording is now the owners'.",
                  onOk: () => router.refresh(),
                })
              }
            >
              <BadgeCheck className="size-4" aria-hidden /> Approve wording
            </Button>
          )}
          {!isNew && (
            <Button
              variant="outline"
              disabled={pending || readOnly}
              onClick={() =>
                run(() => setTemplateActive({ id: t.id as string, active: !template.active }), {
                  success: template.active ? "Turned off: steps that use it are skipped." : "Turned on.",
                  onOk: () => router.refresh(),
                })
              }
            >
              <Power className="size-4" aria-hidden /> {template.active ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <section aria-labelledby="preview-heading" className="rounded-2xl border bg-card p-4">
          <h2 id="preview-heading" className="flex items-center gap-2 font-semibold">
            <Eye className="size-4" aria-hidden /> Preview
          </h2>
          <div className="mt-2 flex flex-col gap-1.5">
            <Label htmlFor="tpl-job">Fill in from</Label>
            <NativeSelect id="tpl-job" value={jobId} onChange={(e) => fillFromJob(e.target.value)}>
              <option value="">Sample values</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">
            {t.channel === "email" && preview.subject && <p className="font-medium">{preview.subject}</p>}
            <p className="mt-1 whitespace-pre-line">{preview.body}</p>
          </div>
          {preview.placeholders.length > 0 && (
            <p className="mt-2 text-xs text-warning">Still placeholders: {preview.placeholders.join(", ")}</p>
          )}
          {real && real.missing.length > 0 && (
            <p className="mt-2 text-xs text-warning">
              This record has no value for {real.missing.map((m) => `{{${m}}}`).join(", ")}. A send would be held back.
            </p>
          )}
        </section>
        <section aria-labelledby="fields-heading" className="rounded-2xl border bg-card p-4">
          <h2 id="fields-heading" className="flex items-center gap-2 font-semibold">
            <Braces className="size-4" aria-hidden /> Insert field
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Click to add at the cursor. Add <code>| default:&quot;there&quot;</code> for a fallback.
          </p>
          <div className="mt-2 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
            {GROUPS.map((g) => (
              <div key={g}>
                <p className="text-xs font-semibold text-muted-foreground">{g}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {MERGE_FIELDS.filter((f) => f.group === g).map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      disabled={readOnly}
                      onClick={() => insert(f.path, f.filter)}
                      className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      title={`{{${f.path}${f.filter ? ` | ${f.filter}` : ""}}}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
