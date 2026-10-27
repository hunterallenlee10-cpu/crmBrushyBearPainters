"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type CenterLink = { href: string; label: string; badge?: number | null };

/** Production Center left sub-nav (SPEC §8.6); a scrolling row on phones. */
export function CenterNav({ links }: { links: CenterLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Production Center">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {links.map((l) => {
          const active =
            l.href === "/schedule" ? pathname === "/schedule" : pathname.startsWith(l.href);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm whitespace-nowrap lg:min-h-9",
                  active ? "bg-accent font-semibold text-bb-forest" : "text-bb-ink hover:bg-muted",
                )}
              >
                {l.label}
                {l.badge ? (
                  <span className="rounded-full bg-bb-honey px-1.5 text-xs font-semibold text-bb-ink tabular-nums">
                    {l.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
