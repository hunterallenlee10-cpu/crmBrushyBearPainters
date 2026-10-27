"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { parseCsv } from "@/lib/domain/csv";
import { MAX_IMPORT_ROWS } from "@/lib/domain/imports";
import { startImport } from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;

export function NewImportForm({ modules }: { modules: { value: string; label: string }[] }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [module, setModule] = React.useState(modules[0]!.value);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Pick a CSV file.");
    if (file.size > MAX_BYTES)
      return setError("That file is over 5 MB. Split it into smaller files.");
    const parsed = parseCsv(await file.text(), { maxRows: MAX_IMPORT_ROWS });
    if (parsed.error && parsed.rows.length === 0) return setError(parsed.error);
    if (parsed.error) return setError(parsed.error);
    run(
      () =>
        startImport({
          module: module as "leads" | "accounts" | "contacts",
          file_name: file.name.slice(0, 200),
          header: parsed.header,
          rows: parsed.rows,
        }),
      {
        success: "Uploaded. Now check how the columns map.",
        onOk: (d) => router.push(`/admin/import/${d.id}`),
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
    >
      <Field id="import-module" label="What's in the file?">
        <NativeSelect id="import-module" value={module} onChange={(e) => setModule(e.target.value)}>
          {modules.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="import-file"
        label="CSV file"
        description={`First row = column names. Up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows, 5 MB.`}
        error={error ?? undefined}
      >
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={error ? "import-file-error" : "import-file-description"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button type="submit" disabled={pending || !file}>
        <Upload aria-hidden /> Upload
      </Button>
    </form>
  );
}
