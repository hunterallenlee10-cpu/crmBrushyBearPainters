"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import type { BulkModule } from "@/lib/domain/bulk";
import { previewBulkUpdate } from "../actions";

export type BulkFieldChoice = {
  key: string;
  label: string;
  kind:
    "user" | "picklist" | "enum" | "text" | "date" | "number" | "tags" | "territory" | "checkbox";
  nullable: boolean;
  options: { value: string; label: string }[];
};

type Change = { key: string; value: string };

export function BulkSelectionForm({
  module,
  ids,
  choices,
}: {
  module: BulkModule;
  ids: string[];
  choices: BulkFieldChoice[];
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [changes, setChanges] = React.useState<Change[]>([
    { key: choices[0]?.key ?? "", value: "" },
  ]);
  const [error, setError] = React.useState<string | null>(null);

  const update = (i: number, patch: Partial<Change>) =>
    setChanges((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: Record<string, string | number | boolean | string[] | null> = {};
    for (const c of changes) {
      const f = choices.find((x) => x.key === c.key);
      if (!f) continue;
      const v = c.value.trim();
      payload[c.key] =
        f.kind === "tags"
          ? v
              .split(/[,;]/)
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
          : f.kind === "number"
            ? v === ""
              ? null
              : Number(v)
            : f.kind === "checkbox"
              ? v === ""
                ? null
                : v
              : v === ""
                ? null
                : v;
    }
    run(() => previewBulkUpdate({ source: "selection", module, ids, changes: payload }), {
      onOk: (d) => router.push(`/admin/bulk-update/${d.id}`),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      {changes.map((c, i) => {
        const f = choices.find((x) => x.key === c.key);
        const valueId = `bulk-value-${i}`;
        return (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Field
              <NativeSelect
                value={c.key}
                onChange={(e) => update(i, { key: e.target.value, value: "" })}
              >
                {choices.map((x) => (
                  <option
                    key={x.key}
                    value={x.key}
                    disabled={x.key !== c.key && changes.some((y) => y.key === x.key)}
                  >
                    {x.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label htmlFor={valueId} className="flex flex-col gap-1.5 text-sm font-medium">
              New value
              {f && (f.options.length > 0 || f.kind === "checkbox") ? (
                <NativeSelect
                  id={valueId}
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                >
                  <option value="">{f.nullable ? "(empty)" : "Pick…"}</option>
                  {f.kind === "checkbox" ? (
                    <>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </>
                  ) : (
                    f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))
                  )}
                </NativeSelect>
              ) : (
                <Input
                  id={valueId}
                  type={f?.kind === "date" ? "date" : "text"}
                  inputMode={f?.kind === "number" ? "numeric" : undefined}
                  placeholder={
                    f?.kind === "tags"
                      ? "tag one, tag two"
                      : f?.nullable
                        ? "Leave empty to clear"
                        : ""
                  }
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              )}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${f?.label ?? "field"}`}
              disabled={changes.length === 1}
              onClick={() => setChanges((list) => list.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={changes.length >= choices.length}
          onClick={() =>
            setChanges((list) => [
              ...list,
              {
                key: choices.find((x) => !list.some((y) => y.key === x.key))?.key ?? "",
                value: "",
              },
            ])
          }
        >
          <Plus aria-hidden /> Another field
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Eye aria-hidden /> Preview changes
        </Button>
      </div>
    </form>
  );
}
