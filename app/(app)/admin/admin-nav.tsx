"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AdminNavItem = {
  label: string;
  href: string;
  phase: number;
  group: string;
  built: boolean;
};

/** Left sub-nav for Admin → Setup with "Quick find" (SPEC §8.19). */
export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const groups = [...new Set(filtered.map((i) => i.group))];

  return (
    <nav aria-label="Setup" className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Quick find"
          aria-label="Quick find setup sections"
          className="h-9 pl-8"
        />
      </div>
      <Link
        href="/admin"
        className={cn(
          "rounded-lg px-3 py-1.5 text-sm font-semibold",
          pathname === "/admin" ? "bg-accent text-bb-forest" : "hover:bg-muted",
        )}
      >
        Setup home
      </Link>
      {groups.map((group) => (
        <div key={group}>
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {group}
          </p>
          <ul className="flex flex-col">
            {filtered
              .filter((i) => i.group === group)
              .map((i) => {
                const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
                return (
                  <li key={i.href}>
                    {i.built ? (
                      <Link
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-9 items-center rounded-lg px-3 text-sm",
                          active ? "bg-accent font-semibold text-bb-forest" : "hover:bg-muted",
                        )}
                      >
                        {i.label}
                      </Link>
                    ) : (
                      <span className="flex min-h-9 items-center justify-between gap-2 px-3 text-sm text-muted-foreground">
                        {i.label}
                        <span className="text-[10px] font-medium">Phase {i.phase}</span>
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {filtered.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">No matching sections.</p>
      )}
    </nav>
  );
}
