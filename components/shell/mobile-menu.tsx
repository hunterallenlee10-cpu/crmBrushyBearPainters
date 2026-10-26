"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/shell/logo";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function MobileMenu({
  showAdmin,
  attentionCount,
}: {
  showAdmin: boolean;
  attentionCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const groups = NAV.filter((g) => showAdmin || !g.adminOnly);

  // Close after navigating.
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 overflow-y-auto p-0">
        <SheetHeader className="border-b">
          <SheetTitle asChild>
            <div>
              <Logo href={null} size="sm" />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </SheetHeader>
        <nav aria-label="Main" className="flex flex-col gap-4 p-4">
          {groups.map((group) =>
            group.href ? (
              <Link
                key={group.id}
                href={group.href}
                className={cn(
                  "flex min-h-11 items-center justify-between rounded-lg px-3 font-semibold",
                  pathname === group.href ? "bg-accent text-bb-forest" : "hover:bg-muted",
                )}
              >
                {group.label}
                {group.badge === "attention" && attentionCount > 0 && (
                  <span className="rounded-full bg-danger px-2 text-xs text-white">
                    {attentionCount}
                  </span>
                )}
              </Link>
            ) : (
              <div key={group.id}>
                <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul>
                  {group.items?.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex min-h-11 items-center rounded-lg px-3 text-sm",
                          pathname === item.href
                            ? "bg-accent font-semibold text-bb-forest"
                            : "hover:bg-muted",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
