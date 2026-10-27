"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/price-book", label: "Catalog" },
  { href: "/price-book/paint", label: "Paint catalog" },
  { href: "/price-book/rates", label: "Production rates" },
];

export function PriceBookTabs() {
  const path = usePathname();
  const active = (href: string) =>
    href === "/price-book"
      ? path === "/price-book" || /^\/price-book\/[0-9a-f-]{36}/.test(path)
      : path.startsWith(href);
  return (
    <nav aria-label="Price book" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex gap-1 border-b">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                active(t.href)
                  ? "border-bb-forest text-bb-forest"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
