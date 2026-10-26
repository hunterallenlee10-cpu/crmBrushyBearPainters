"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Camera, ClipboardList, MessageSquare, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export const CREW_TABS = [
  { label: "Today", href: "/field/today", icon: Sun },
  { label: "Jobs", href: "/schedule/my-projects", icon: Briefcase },
  { label: "Camera", href: "/field/camera", icon: Camera },
  { label: "Daily Log", href: "/field/daily-log", icon: ClipboardList },
  { label: "Messages", href: "/field/messages", icon: MessageSquare },
] as const;

/**
 * Bottom tab bar for crew roles on phones (SPEC §16): 44px+ touch targets,
 * reachable one-handed. `fixed={false}` renders it inline (design-system page).
 */
export function CrewTabBar({ fixed = true }: { fixed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Crew"
      className={cn(
        "border-t bg-card pb-[env(safe-area-inset-bottom)]",
        fixed && "fixed inset-x-0 bottom-0 z-40 lg:hidden",
      )}
    >
      <ul className="grid grid-cols-5">
        {CREW_TABS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-bb-forest" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.5]")} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
