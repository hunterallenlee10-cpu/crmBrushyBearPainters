"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { renderTemplateFor } from "@/app/(app)/messages/actions";

export type TemplateOption = { key: string; name: string; channel: "sms" | "email" };

/** Fill a composer from a template for this lead or job (SPEC §8.4 "composer with template picker"). */
export function TemplatePicker({
  subjectType,
  subjectId,
  channel,
  templates,
  onPick,
  disabled,
  idPrefix = "tpl",
}: {
  subjectType: "job" | "lead";
  subjectId: string;
  channel: "sms" | "email";
  templates: readonly TemplateOption[];
  onPick: (t: { subject: string | null; body: string; templateKey: string }) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { pending, run } = useRunAction();
  const options = templates.filter((t) => t.channel === channel);
  const [key, setKey] = React.useState("");
  if (!options.length) return null;
  const id = `${idPrefix}-${channel}`;
  return (
    <div className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          Start from a template
        </label>
        <NativeSelect
          id={id}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose…</option>
          {options.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!key || pending || disabled}
        onClick={() =>
          run(() => renderTemplateFor({ subjectType, subjectId, key, channel }), {
            onOk: (r) => onPick(r),
          })
        }
      >
        <FileText className="size-4" aria-hidden /> Use template
      </Button>
    </div>
  );
}
