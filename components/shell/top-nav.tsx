"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isGroupActive, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";

const itemBase =
  "inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";

function itemClass(active: boolean) {
  return cn(
    itemBase,
    active
      ? "bg-accent text-bb-forest"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

export function TopNav({
  groups,
  attentionCount,
}: {
  groups: readonly NavGroup[];
  attentionCount: number;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
      {groups.map((group) =>
        group.href ? (
          <Link
            key={group.id}
            href={group.href}
            className={itemClass(isGroupActive(group, pathname))}
            aria-current={isGroupActive(group, pathname) ? "page" : undefined}
          >
            {group.label}
            {group.badge === "attention" && attentionCount > 0 && (
              <span className="ml-1 rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
                {attentionCount}
              </span>
            )}
          </Link>
        ) : (
          <NavDropdown key={group.id} group={group} active={isGroupActive(group, pathname)} />
        ),
      )}
    </nav>
  );
}

function NavDropdown({ group, active }: { group: NavGroup; active: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={itemClass(active)}>
        {group.label}
        <ChevronDown className="size-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          {group.items?.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href} className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {group.recent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {group.recent.label}
            </DropdownMenuLabel>
            <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {group.recent.empty}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
