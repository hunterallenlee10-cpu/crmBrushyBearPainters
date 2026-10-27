"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, CircleHelp, Loader2, SearchIcon, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const SUGGESTED = [
  "create a lead",
  "book a walkthrough",
  "build an estimate",
  "record a deposit",
  "daily log",
];

type Result = { slug: string; title: string; summary: string };

/**
 * Floating Help button (SPEC §8.1, §8.17): searches the Help Center. AI
 * answers stay off unless the AI integration is connected. Sits above the
 * crew tab bar on phones; pages leave room for it at the bottom.
 */
export function HelpButton({
  aiConnected,
  raised = false,
}: {
  aiConnected: boolean;
  raised?: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/help/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = (await r.json()) as { results: Result[] };
        setResults(data.results ?? []);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Help"
          className={cn(
            "fixed left-3 z-30 grid size-11 place-items-center rounded-full border-[1.5px] border-bb-ink bg-bb-honey text-bb-ink shadow-md transition-transform hover:scale-105 lg:bottom-4 lg:left-4 print:hidden",
            raised ? "bottom-20" : "bottom-3",
          )}
        >
          <CircleHelp className="size-5" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Help</SheetTitle>
          <SheetDescription>
            Search how-to articles.{" "}
            {aiConnected ? "" : "AI answers are off until the AI integration is connected."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-11 pl-9"
              type="search"
              placeholder="Search help articles"
              aria-label="Search help articles"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {busy && (
              <Loader2
                className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-label="Searching"
              />
            )}
          </div>
          {results !== null ? (
            <div aria-live="polite">
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No articles match “{q.trim()}”. Try other words.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {results.map((r) => (
                    <li key={r.slug}>
                      <SheetClose asChild>
                        <Link
                          href={`/help/${r.slug}`}
                          className="block rounded-lg border p-3 hover:bg-muted"
                        >
                          <span className="font-medium text-bb-forest">{r.title}</span>
                          {r.summary && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {r.summary}
                            </span>
                          )}
                        </Link>
                      </SheetClose>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div>
              <p className="pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Try
              </p>
              <ul className="flex flex-wrap gap-2">
                {SUGGESTED.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="min-h-9 rounded-full bg-muted px-3 text-sm hover:bg-muted/70"
                      onClick={() => setQ(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2 border-t pt-4 text-sm">
            <SheetClose asChild>
              <Link
                href="/help"
                className="inline-flex min-h-11 items-center gap-2 text-bb-forest hover:underline"
              >
                <BookOpen className="size-4" aria-hidden /> Open the Help Center
              </Link>
            </SheetClose>
            <SheetClose asChild>
              <Link
                href="/help/release-notes"
                className="inline-flex min-h-11 items-center gap-2 text-bb-forest hover:underline"
              >
                <Sparkles className="size-4" aria-hidden /> Release notes
              </Link>
            </SheetClose>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
