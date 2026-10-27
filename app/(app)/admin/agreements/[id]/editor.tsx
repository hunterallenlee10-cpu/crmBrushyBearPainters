"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect, TOUCH } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import {
  AGREEMENT_DOC_TYPE_LABELS,
  LEGAL_DRAFT_BADGE,
  checkPublishable,
  placeholderSlots,
  type AgreementDocType,
} from "@/lib/estimating/engine";
import { publishAgreementTemplate, saveAgreementTemplate } from "../actions";

type Clause = { title: string; body: string; when: "always" | "lead_safe" | "hoa" };
const WHEN_LABELS: Record<Clause["when"], string> = {
  always: "Always",
  lead_safe: "Only for lead-safe work",
  hoa: "Only for HOA homes",
};

/** Edit the wording, clauses and publish (SPEC §8.19 publish validation). */
export function TemplateEditor({
  template,
  mergeFields,
  required,
  canPublish,
  readOnly,
}: {
  template: {
    id: string;
    docType: AgreementDocType;
    name: string;
    body: string;
    clauses: Clause[];
    status: string;
    version: number;
    approvedLabel: string | null;
  };
  mergeFields: { key: string; label: string }[];
  required: string[];
  canPublish: boolean;
  readOnly: boolean;
}) {
  const [name, setName] = React.useState(template.name);
  const [body, setBody] = React.useState(template.body);
  const [clauses, setClauses] = React.useState<Clause[]>(template.clauses);
  const [confirmed, setConfirmed] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  const dirty =
    name !== template.name ||
    body !== template.body ||
    JSON.stringify(clauses) !== JSON.stringify(template.clauses);
  const check = checkPublishable({
    docType: template.docType,
    body,
    clauses,
    ownerConfirmed: confirmed,
  });
  const slots = placeholderSlots([body, ...clauses.map((c) => c.body)].join("\n\n"));
  const published = template.status === "published";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{template.name}</h1>
        <Badge variant="outline">{AGREEMENT_DOC_TYPE_LABELS[template.docType]}</Badge>
        <Badge variant={published ? "success" : "sample"}>
          {published ? `Published v${template.version}` : `Draft v${template.version}`}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {published
          ? `${template.approvedLabel ?? "Published"}. Changing the wording sends it back to draft until it's published again.`
          : `${LEGAL_DRAFT_BADGE}. Customers see a draft label until it's published.`}
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            run(
              () =>
                saveAgreementTemplate({
                  id: template.id,
                  doc_type: template.docType,
                  name,
                  body,
                  clauses,
                }),
              { success: "Template saved.", onError: (er) => setErrors(firstErrors(er)) },
            );
          }}
        >
          <Field id="tpl-name" label="Name" error={errors.name}>
            <Input
              {...fieldAria("tpl-name", errors.name)}
              className={TOUCH}
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            id="tpl-body"
            label="Wording"
            description="# Heading, ## Subheading, blank line between paragraphs. {{merge.fields}} fill in per job; [SLOTS] must be filled before publishing."
            error={errors.body}
          >
            <Textarea
              {...fieldAria("tpl-body", errors.body, true)}
              rows={20}
              className="font-mono text-sm"
              value={body}
              disabled={readOnly}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Clauses added when they apply</legend>
            {clauses.map((c, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_200px_auto]"
              >
                <Field id={`cl-t-${i}`} label="Title">
                  <Input
                    id={`cl-t-${i}`}
                    className={TOUCH}
                    value={c.title}
                    disabled={readOnly}
                    onChange={(e) =>
                      setClauses(
                        clauses.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field id={`cl-w-${i}`} label="When">
                  <NativeSelect
                    id={`cl-w-${i}`}
                    value={c.when}
                    disabled={readOnly}
                    onChange={(e) =>
                      setClauses(
                        clauses.map((x, j) =>
                          j === i ? { ...x, when: e.target.value as Clause["when"] } : x,
                        ),
                      )
                    }
                  >
                    {(Object.keys(WHEN_LABELS) as Clause["when"][]).map((w) => (
                      <option key={w} value={w}>
                        {WHEN_LABELS[w]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${TOUCH} self-end text-danger`}
                  aria-label={`Remove clause ${i + 1}`}
                  disabled={readOnly}
                  onClick={() => setClauses(clauses.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
                <Field id={`cl-b-${i}`} label="Clause" className="sm:col-span-3">
                  <Textarea
                    id={`cl-b-${i}`}
                    rows={3}
                    value={c.body}
                    disabled={readOnly}
                    onChange={(e) =>
                      setClauses(
                        clauses.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                className={`${TOUCH} w-fit`}
                onClick={() => setClauses([...clauses, { title: "", body: "", when: "always" }])}
              >
                <Plus aria-hidden />
                Add clause
              </Button>
            )}
          </fieldset>
          {!readOnly && (
            <Button type="submit" className={`${TOUCH} w-fit`} disabled={pending || !dirty}>
              Save draft
            </Button>
          )}
        </form>
        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-semibold">Ready to publish?</h2>
            {slots.length > 0 ? (
              <p className="mt-2 text-sm text-warning">
                {slots.length} slot{slots.length === 1 ? "" : "s"} still to fill.
              </p>
            ) : (
              <p className="mt-2 text-sm text-success">Every slot is filled.</p>
            )}
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {required.map((r) => {
                const has = [body, ...clauses.map((c) => c.body)].join("\n").includes(`{{${r}}}`);
                return (
                  <li key={r} className={has ? "text-success" : "text-danger"}>
                    {has ? "✓" : "✗"} {`{{${r}}}`}
                  </li>
                );
              })}
            </ul>
            {canPublish && !published && (
              <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  An owner (and our attorney, for legal wording) approved this text.
                </label>
                <Field id="tpl-note" label="Approval note">
                  <Input
                    id="tpl-note"
                    className={TOUCH}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                {!check.ok && dirty === false && (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {check.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <Button
                  className={TOUCH}
                  disabled={pending || dirty || !check.ok}
                  title={dirty ? "Save your changes first." : undefined}
                  onClick={() =>
                    run(
                      () =>
                        publishAgreementTemplate({
                          id: template.id,
                          owner_confirmed: confirmed,
                          approval_note: note,
                        }),
                      {
                        success: "Template published.",
                      },
                    )
                  }
                >
                  Publish
                </Button>
              </div>
            )}
          </section>
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-semibold">Merge fields</h2>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {mergeFields.map((f) => (
                <li key={f.key}>
                  <code className="rounded bg-muted px-1">{`{{${f.key}}}`}</code> {f.label}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
