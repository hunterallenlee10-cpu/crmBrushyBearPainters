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
import { MAX_BULK_ROWS, type BulkModule } from "@/lib/domain/bulk";
import { previewBulkUpdate } from "./actions";

export function BulkCsvForm() {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [module, setModule] = React.useState<BulkModule>("leads");
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Pick a CSV file.");
    const parsed = parseCsv(await file.text(), { maxRows: MAX_BULK_ROWS });
    if (parsed.error) return setError(parsed.error);
    run(
      () =>
        previewBulkUpdate({
          source: "csv",
          module,
          file_name: file.name.slice(0, 200),
          header: parsed.header,
          rows: parsed.rows,
        }),
      {
        success: "Preview ready.",
        onOk: (d) => router.push(`/admin/bulk-update/${d.id}`),
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <Field id="bulk-module" label="Records">
        <NativeSelect
          id="bulk-module"
          value={module}
          onChange={(e) => setModule(e.target.value as BulkModule)}
        >
          <option value="leads">Leads</option>
          <option value="jobs">Jobs</option>
          <option value="accounts">Accounts</option>
          <option value="contacts">Contacts</option>
        </NativeSelect>
      </Field>
      <Field
        id="bulk-file"
        label="CSV file"
        description={`Empty cells are left alone; type (clear) to empty a field. Up to ${MAX_BULK_ROWS.toLocaleString("en-US")} rows.`}
        error={error ?? undefined}
      >
        <Input
          id="bulk-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={error ? "bulk-file-error" : "bulk-file-description"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button type="submit" disabled={pending || !file}>
        <Upload aria-hidden /> Preview
      </Button>
    </form>
  );
}
