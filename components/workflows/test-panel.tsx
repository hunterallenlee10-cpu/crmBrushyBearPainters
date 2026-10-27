"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { FlaskConical, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/forms/native-select";
import { StepOutcomeBadge } from "@/components/workflows/run-status";
import { useRunAction } from "@/components/forms/use-run-action";
import type { Simulation } from "@/lib/domain/workflows/plan";
import { countSms, describeSmsCount } from "@/lib/leads/messaging";
import { formatDateTime } from "@/lib/format/dates";
import { testWorkflow } from "@/app/(app)/admin/workflows/actions";

type Candidate = { id: string; label: string };

/**
 * Admin → Workflows → Test (SPEC §11.1): dry-runs the workflow against a
 * chosen record, optionally "as if" at another time (to see quiet hours or a
 * reminder time), and shows exactly what each step would do. Nothing is sent.
 */
export function WorkflowTestPanel({
  workflowKey,
  subjectWords,
  candidates,
  readOnly,
}: {
  workflowKey: string;
  subjectWords: string;
  candidates: readonly Candidate[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [subjectId, setSubjectId] = React.useState(candidates[0]?.id ?? "");
  const [at, setAt] = React.useState("");
  const [result, setResult] = React.useState<Simulation | null>(null);

  const go = () => {
    if (!subjectId) return;
    const iso = at ? fromZonedTime(at, "America/Los_Angeles").toISOString() : undefined;
    run(() => testWorkflow({ key: workflowKey, subjectId, at: iso }), {
      onOk: (r) => {
        setResult(r);
        router.refresh();
      },
    });
  };

  return (
    <section id="test" aria-labelledby="test-heading" className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
      <div>
        <h2 id="test-heading" className="flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="size-5 text-bb-forest" aria-hidden /> Test
        </h2>
        <p className="text-sm text-muted-foreground">
          A dry run against a real {subjectWords}: every step, the messages exactly as they'd be
          written, consent and quiet hours. Nothing is sent and nothing changes.
        </p>
      </div>
      {candidates.length === 0 ? (
        <p className="rounded-xl bg-muted/50 p-3 text-sm">
          There's no {subjectWords} to test with yet. Once there is one, pick it here.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-subject">Record</Label>
            <NativeSelect id="test-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-at">As if it were (Pacific, optional)</Label>
            <Input id="test-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          <Button onClick={go} disabled={pending || readOnly || !subjectId}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FlaskConical className="size-4" aria-hidden />}
            Run test
          </Button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {!result.matched ? (
            <p className="rounded-xl bg-warning-bg p-3 text-sm text-warning">
              It wouldn't start for this record. {result.reason}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {result.steps.map((s) => (
                <li key={s.actionId} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{s.index + 1}.</span>
                    <span className="font-medium">{s.label}</span>
                    <StepOutcomeBadge outcome={s.outcome} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(s.at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{prettyDetail(s.detail)}</p>
                  {s.sends?.map((m, i) => (
                    <div key={i} className="mt-2 rounded-lg bg-muted/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{m.channel === "sms" ? "Text" : "Email"}</Badge>
                        <span>
                          To {m.to ?? "—"}
                          {m.address ? ` (${m.address})` : ""}
                        </span>
                        {m.templateStatus === "draft" && <Badge variant="sample">Draft – owner to approve</Badge>}
                        {m.messageType === "marketing" && <Badge variant="info">Marketing</Badge>}
                        {m.deferredUntil && <Badge variant="info">Quiet hours: {formatDateTime(m.deferredUntil)}</Badge>}
                      </div>
                      {m.blocked ? (
                        <p className="mt-2 text-warning">Not sent: {m.blocked}</p>
                      ) : (
                        <>
                          {m.subject && <p className="mt-2 font-medium">{m.subject}</p>}
                          <p className="mt-1 whitespace-pre-line">{m.body}</p>
                          {m.channel === "sms" && (
                            <p className="mt-1 text-xs text-muted-foreground">{describeSmsCount(countSms(m.body))}</p>
                          )}
                        </>
                      )}
                      {m.placeholders.length > 0 && (
                        <p className="mt-1 text-xs text-warning">
                          Still a placeholder: {m.placeholders.join(", ")} (Company Settings).
                        </p>
                      )}
                    </div>
                  ))}
                  {s.notify && (
                    <div className="mt-2 rounded-lg bg-muted/40 p-3 text-sm">
                      <p className="font-medium">{s.notify.title}</p>
                      {s.notify.body && <p className="whitespace-pre-line text-muted-foreground">{s.notify.body}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted-foreground">
            Waits are shown on a pretend clock. On a real run the record is read again after each
            wait, so an answer from the customer can stop the rest.
          </p>
        </div>
      )}
    </section>
  );
}

/** ISO times inside step details → Pacific. */
function prettyDetail(detail: string): string {
  return detail.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, (iso) => formatDateTime(iso));
}
