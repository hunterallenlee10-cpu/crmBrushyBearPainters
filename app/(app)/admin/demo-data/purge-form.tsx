"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRunAction } from "@/components/forms/use-run-action";
import { purgeDemoData } from "./actions";

export function PurgeDemoForm() {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [text, setText] = React.useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => purgeDemoData({ confirm: "PURGE" }), {
          success: (d) =>
            `Purged ${Number(d.jobs ?? 0)} jobs, ${Number(d.leads ?? 0)} leads and everything attached.`,
          onOk: () => router.refresh(),
        });
      }}
    >
      <h2 className="text-base font-semibold">Purge demo data</h2>
      <p className="text-sm text-muted-foreground">
        Removes every demo lead, customer, job, estimate, invoice, payment, log, crew and the
        messages and tasks attached to them. Real records stay. This can&apos;t be undone.
      </p>
      <label htmlFor="purge-confirm" className="text-sm font-medium">
        Type PURGE to confirm
      </label>
      <Input
        id="purge-confirm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="max-w-48"
        autoComplete="off"
      />
      <div>
        <Button type="submit" variant="destructive" disabled={pending || text !== "PURGE"}>
          <Trash2 aria-hidden /> Purge demo data
        </Button>
      </div>
    </form>
  );
}
