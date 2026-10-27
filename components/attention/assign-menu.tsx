"use client";

import { ChevronDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PersonOption } from "./types";

const UNASSIGNED = "__unassigned";

/** Assign an item to an active team member (or leave it unassigned). */
export function AssignMenu({
  people,
  ownerId,
  onAssign,
  className,
}: {
  people: readonly PersonOption[];
  ownerId: string | null;
  onAssign: (ownerId: string | null) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-11 sm:h-8", className)}>
          <UserPlus aria-hidden />
          Assign
          <ChevronDown className="size-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
        <DropdownMenuLabel>Assign to…</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={ownerId ?? UNASSIGNED}
          onValueChange={(v) => {
            const next = v === UNASSIGNED ? null : v;
            if (next !== ownerId) onAssign(next);
          }}
        >
          {people.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id} className="min-h-11 sm:min-h-8">
              {p.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={UNASSIGNED} className="min-h-11 sm:min-h-8">
            Unassigned
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
