"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DailyBriefSummary } from "@/lib/domain/analytics/brief";
import { generateDailyBrief } from "../actions";

/**
 * Daily Brief (SPEC §8.14): Generate → a deterministic summary of what changed
 * on a day (yesterday by default) and what needs attention now. Same input,
 * same words: it is built from registry counts, not written by a model.
 */
export function DailyBrief({ yesterday }: { yesterday: string }) {
  const [day, setDay] = React.useState(yesterday);
  const [brief, setBrief] = React.useState<DailyBriefSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateDailyBrief({ day });
      if (res.ok) setBrief(res.data);
      else setError(res.error.message);
    });
  }

  return (
    <section
      aria-labelledby="brief-title"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="brief-title"
            className="flex items-center gap-2 text-base font-semibold text-bb-ink"
          >
            <FileText className="size-4 text-bb-forest" aria-hidden />
            Daily Brief
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What changed that day, and what needs attention now.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="brief-day" className="text-xs font-medium text-muted-foreground">
              Day
            </label>
            <Input
              id="brief-day"
              type="date"
              value={day}
              max={yesterday}
              onChange={(e) => setDay(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <Button onClick={generate} disabled={pending || !day} size="sm" className="h-9">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Generate
          </Button>
        </div>
      </div>
      <div aria-live="polite">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!brief && !error && (
          <p className="rounded-xl bg-muted px-3 py-4 text-center text-sm text-muted-foreground">
            Pick a day and press Generate.
          </p>
        )}
        {brief && (
          <div data-testid="daily-brief" className="flex flex-col gap-3 text-sm">
            <p className="font-medium text-bb-ink">{brief.headline}</p>
            {brief.changed.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  What changed
                </h3>
                <ul className="mt-1 list-disc pl-5">
                  {brief.changed.map((l) => (
                    <li key={l.text}>
                      {l.href ? (
                        <Link href={l.href} className="hover:underline">
                          {l.text}
                        </Link>
                      ) : (
                        l.text
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Needs attention now
              </h3>
              <ul className="mt-1 list-disc pl-5">
                {brief.attention.map((l) => (
                  <li key={l.text}>
                    {l.href ? (
                      <Link href={l.href} className="hover:underline">
                        {l.text}
                      </Link>
                    ) : (
                      l.text
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Metrics: {brief.citations.join(", ")} · Figures are computed, not written.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
