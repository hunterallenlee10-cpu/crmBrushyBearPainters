"use client";

import { CircleHelp, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const SUGGESTED = [
  "How do I create a lead?",
  "How do I book a walkthrough?",
  "How do I build and send an estimate?",
  "How do I record a deposit?",
  "How do I submit a daily log?",
];

/**
 * Floating Help button (SPEC §8.1). Knowledge-base search arrives with the Help
 * Center (Phase 10). AI answers stay off unless the AI integration is connected.
 */
export function HelpButton({ aiConnected }: { aiConnected: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Help"
          className="fixed bottom-20 left-4 z-30 grid size-11 place-items-center rounded-full border-[1.5px] border-bb-ink bg-bb-honey text-bb-ink shadow-md transition-transform hover:scale-105 lg:bottom-4"
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
        <div className="flex flex-col gap-5 px-4">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search help articles"
              aria-label="Search help articles"
              disabled
            />
          </div>
          <div>
            <p className="pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Suggested questions
            </p>
            <ul className="flex flex-col gap-1">
              {SUGGESTED.map((q) => (
                <li key={q} className="rounded-lg bg-muted px-3 py-2 text-sm">
                  {q}
                </li>
              ))}
            </ul>
          </div>
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            The Help Center and its articles arrive in Phase 10.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
