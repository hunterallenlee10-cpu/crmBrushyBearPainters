"use client";

import * as React from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revealJobAccessCode } from "@/lib/production/access-code-actions";

/** "Show gate code": reveals the code for the crew on their scheduled day (logged). */
export function AccessCodeButton({ jobId, disabled }: { jobId: string; disabled?: boolean }) {
  const [code, setCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (code) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-bb-forest/30 bg-bb-cream-light px-3 py-2 text-sm">
        <KeyRound className="size-4" aria-hidden />
        Gate / lockbox code: <strong className="font-mono text-base tracking-wider">{code}</strong>
      </p>
    );
  }
  return (
    <Button
      variant="outline"
      size="touch"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        const r = await revealJobAccessCode({ job_id: jobId });
        setBusy(false);
        if (r.ok) setCode(r.data.code);
        else toast.error(r.error.message);
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
      Show gate code
    </Button>
  );
}
