"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASK_EXAMPLES } from "@/lib/domain/analytics/ask";
import type { AskResult } from "@/lib/analytics/ask";
import { askQuestion } from "../actions";

/**
 * "Ask Brushy Bear" (SPEC §8.14, §12.2). Questions are matched to registry
 * metrics by keyword rules (no AI is connected); the answer lists the metrics
 * and filters it used. "Figures are computed, not written."
 */
export function AskBox() {
  const [question, setQuestion] = React.useState("");
  const [asked, setAsked] = React.useState("");
  const [result, setResult] = React.useState<AskResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function ask(q: string) {
    const text = q.trim();
    if (text.length < 3) return;
    setQuestion(text);
    setAsked(text);
    setError(null);
    startTransition(async () => {
      const res = await askQuestion({ question: text });
      if (res.ok) setResult(res.data);
      else {
        setResult(null);
        setError(res.error.message);
      }
    });
  }

  return (
    <section
      aria-labelledby="ask-title"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div>
        <h2 id="ask-title" className="flex items-center gap-2 text-base font-semibold text-bb-ink">
          <MessageCircleQuestion className="size-4 text-bb-forest" aria-hidden />
          Ask Brushy Bear
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Answers come only from the metrics registry and show which metrics and filters they used.
          Figures are computed, not written.
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <Input
          id="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How are sales this month?"
          maxLength={300}
          className="h-10"
        />
        <Button type="submit" disabled={pending || question.trim().length < 3} className="h-10">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {ASK_EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q)}
            className="min-h-9 rounded-full border bg-background px-3 text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {q}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="min-h-0">
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && !pending && (
          <div
            data-testid="ask-answer"
            className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-sm"
          >
            <p className="text-xs text-muted-foreground">“{asked}”</p>
            {result.kind === "answer" && (
              <>
                <p className="font-medium text-bb-ink">{result.answer.text}</p>
                <ul className="flex flex-col gap-1">
                  {result.answer.metrics.map((m) => (
                    <li key={m.id} className="text-xs text-muted-foreground">
                      <span className="font-semibold text-bb-ink">{m.label}</span> · {m.caption}
                    </li>
                  ))}
                </ul>
                {result.breakdown && result.breakdown.rows.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-bb-ink">{result.breakdown.title}</p>
                    <ul className="mt-1 grid gap-0.5 text-xs">
                      {result.breakdown.rows.map((r) => (
                        <li key={r.label} className="flex justify-between gap-3">
                          <span>{r.label}</span>
                          <span className="tabular-nums">{r.value}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.answer.link && (
                  <Link
                    href={result.answer.link.href}
                    className="text-xs font-medium text-bb-forest hover:underline"
                  >
                    {result.answer.link.label}
                  </Link>
                )}
                <p className="text-[11px] text-muted-foreground" data-testid="ask-citations">
                  {result.answer.periodLabel} · {result.answer.filtersLabel} · Metrics:{" "}
                  {result.answer.citations.join(", ")} · Figures are computed, not written.
                </p>
              </>
            )}
            {result.kind === "forbidden" && <p className="text-bb-ink">{result.reason}</p>}
            {result.kind === "unmapped" && (
              <p className="text-bb-ink">
                I can&apos;t answer that from the metrics I know yet.{" "}
                {result.suggestion ? (
                  <>
                    The closest report is{" "}
                    <Link
                      href={result.suggestion.href}
                      className="font-medium text-bb-forest hover:underline"
                    >
                      {result.suggestion.name}
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Try one of the examples above, or browse{" "}
                    <Link
                      href="/analytics/reports"
                      className="font-medium text-bb-forest hover:underline"
                    >
                      Reports
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
