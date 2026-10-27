"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  FileSignature,
  NotebookPen,
  PaintBucket,
  PanelLeftClose,
  PanelLeftOpen,
  Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ReasonButton } from "@/components/leads/reason-button";
import type { JobSectionId } from "@/lib/domain/jobs/constants";
import { cn } from "@/lib/utils";

export type NavItem = { id: JobSectionId; label: string; href: string; count: number | null };

const COLLAPSE_KEY = "bb:job-nav-collapsed";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Left section nav (SPEC §8.5): every section with cheap counts, plus the job
 * shortcuts. Collapsible on desktop (remembered per browser); a select on phones.
 */
export function SectionNav({
  items,
  current,
  shortcuts,
}: {
  items: NavItem[];
  current: JobSectionId;
  shortcuts: {
    resultHref: string;
    resultReason: string | null;
    estimateHref: string;
    estimateReason: string | null;
    paintHref: string;
    paintReason: string | null;
    dailyLogHref: string;
    dailyLogReason: string | null;
  };
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // storage unavailable: start expanded
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // not remembered; fine
      }
      return !c;
    });
  };

  const shortcutList = (
    <div className="flex flex-col gap-1.5">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Shortcuts
      </h2>
      {shortcuts.resultReason ? (
        <ReasonButton
          size="sm"
          variant="outline"
          className="justify-start"
          disabledReason={shortcuts.resultReason}
        >
          <ClipboardCheck aria-hidden />
          Result Walkthrough
        </ReasonButton>
      ) : (
        <Button size="sm" variant="outline" className="justify-start" asChild>
          <Link href={shortcuts.resultHref} scroll={false}>
            <ClipboardCheck aria-hidden />
            Result Walkthrough
          </Link>
        </Button>
      )}
      {shortcuts.estimateReason ? (
        <ReasonButton
          size="sm"
          variant="outline"
          className="justify-start"
          disabledReason={shortcuts.estimateReason}
        >
          <Ruler aria-hidden />
          Build Estimate
        </ReasonButton>
      ) : (
        <>
          <Button size="sm" variant="outline" className="justify-start" asChild>
            <Link href={shortcuts.estimateHref} scroll={false}>
              <Ruler aria-hidden />
              Build Estimate
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="justify-start" asChild>
            <Link href={shortcuts.estimateHref} scroll={false}>
              <FileSignature aria-hidden />
              Send for Signature
            </Link>
          </Button>
        </>
      )}
      {shortcuts.paintReason ? (
        <ReasonButton
          size="sm"
          variant="outline"
          className="justify-start"
          disabledReason={shortcuts.paintReason}
        >
          <PaintBucket aria-hidden />
          Order Paint
        </ReasonButton>
      ) : (
        <Button size="sm" variant="outline" className="justify-start" asChild>
          <Link href={shortcuts.paintHref} scroll={false}>
            <PaintBucket aria-hidden />
            Order Paint
          </Link>
        </Button>
      )}
      {shortcuts.dailyLogReason ? (
        <ReasonButton
          size="sm"
          variant="outline"
          className="justify-start"
          disabledReason={shortcuts.dailyLogReason}
        >
          <NotebookPen aria-hidden />
          New Daily Log
        </ReasonButton>
      ) : (
        <Button size="sm" variant="outline" className="justify-start" asChild>
          <Link href={shortcuts.dailyLogHref} scroll={false}>
            <NotebookPen aria-hidden />
            New Daily Log
          </Link>
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Phones and tablets: a select plus the shortcuts in a disclosure. */}
      <div className="flex flex-col gap-2 lg:hidden print:hidden">
        <Label htmlFor="job-section-select">Section</Label>
        <select
          id="job-section-select"
          className={selectClass}
          value={current}
          onChange={(e) => {
            const item = items.find((i) => i.id === e.target.value);
            if (item) router.push(item.href, { scroll: false });
          }}
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
              {i.count ? ` (${i.count})` : ""}
            </option>
          ))}
        </select>
        <details className="rounded-xl border bg-card px-3 py-2">
          <summary className="cursor-pointer py-1 text-sm font-medium">Job shortcuts</summary>
          <div className="pt-2 pb-1">{shortcutList}</div>
        </details>
      </div>

      {/* Desktop: collapsible left rail. */}
      <div
        className={cn(
          "hidden shrink-0 flex-col gap-4 pb-16 lg:flex print:hidden",
          collapsed ? "w-auto" : "w-56",
        )}
      >
        <Button
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="job-section-links"
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          {collapsed ? "Show sections" : "Hide sections"}
        </Button>
        {!collapsed && (
          <>
            <nav id="job-section-links" aria-label="Job sections">
              <ul className="flex flex-col gap-0.5">
                {items.map((i) => {
                  const active = i.id === current;
                  return (
                    <li key={i.id}>
                      <Link
                        href={i.href}
                        scroll={false}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                          active && "bg-bb-forest font-semibold text-white hover:bg-bb-forest-dark",
                        )}
                      >
                        <span>{i.label}</span>
                        {i.count ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 text-xs tabular-nums",
                              active ? "bg-white/20" : "bg-muted-foreground/15",
                            )}
                          >
                            {i.count}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {shortcutList}
          </>
        )}
      </div>
    </>
  );
}
