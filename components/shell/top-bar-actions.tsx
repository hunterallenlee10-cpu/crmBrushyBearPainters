"use client";

import Link from "next/link";
import { Bell, LogOut, Phone, Plug, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** "0 of 11 connected" — click goes to Admin → Integrations (SPEC §8.1). */
export function IntegrationsPill({ connected, total }: { connected: number; total: number }) {
  const none = connected === 0;
  return (
    <Link
      href="/admin/integrations"
      className={cn(
        "hidden h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors md:inline-flex",
        none
          ? "border-neutral/20 bg-neutral-bg text-neutral hover:bg-muted"
          : "border-success/20 bg-success-bg text-success",
      )}
    >
      <Plug className="size-3.5" aria-hidden />
      {connected} of {total} connected
    </Link>
  );
}

/**
 * Unavailable icon button with an explanation. Uses aria-disabled (not `disabled`)
 * so keyboard and screen-reader users can still focus it and hear why.
 */
function DisabledAction({
  label,
  reason,
  children,
}: {
  label: string;
  reason: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-disabled="true"
          aria-label={`${label}: ${reason}`}
          onClick={(e) => e.preventDefault()}
          className="hidden cursor-not-allowed opacity-50 hover:bg-transparent sm:inline-flex"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{label}</p>
        <p className="opacity-80">{reason}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function SoftphoneButton() {
  return (
    <DisabledAction label="Softphone" reason="Voice is not connected.">
      <Phone />
    </DisabledAction>
  );
}

export function NotificationsMenu({ unread }: { unread: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Sun className="size-6 text-bb-honey" aria-hidden />
          <p className="text-sm font-medium">You&apos;re all caught up.</p>
          <p className="text-xs text-muted-foreground">
            Mentions, approvals and assignments will show up here.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function UserMenu({
  name,
  initials,
  roleLabel,
  email,
}: {
  name: string;
  initials: string;
  roleLabel: string;
  email: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="User menu">
          <Avatar className="size-7">
            <AvatarFallback className="bg-bb-forest text-xs font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="font-semibold">{name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{email}</p>
          <p className="text-xs font-normal text-muted-foreground">{roleLabel}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspace">
            <Sun aria-hidden /> Workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
