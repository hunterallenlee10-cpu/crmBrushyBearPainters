"use client";

import * as React from "react";
import { Eye, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startViewAs, stopViewAs } from "@/app/(app)/view-as/actions";

export type ViewAsUser = { id: string; name: string; role: string };

/** Owners only: pick a user to see the app exactly as they do (read-only). */
export function ViewAsButton({ users }: { users: readonly ViewAsUser[] }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const filtered = users.filter((u) =>
    `${u.name} ${u.role}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function choose(user: ViewAsUser) {
    setPending(user.id);
    const result = await startViewAs({ targetUserId: user.id });
    setPending(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    // Full load: every server-rendered part of the shell must redraw with the new permissions.
    window.location.assign("/");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="View as user"
              className="hidden sm:inline-flex"
            >
              <Eye />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>View as user</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>View as user</DialogTitle>
          <DialogDescription>
            See the app with someone else&apos;s permissions. It&apos;s read-only, lasts up to an
            hour, and is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search people"
          aria-label="Search people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="max-h-72 overflow-y-auto" aria-label="Users">
          {filtered.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {users.length === 0
                ? "No other active users yet. Invite someone from Admin → Users."
                : "No matches."}
            </li>
          )}
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => choose(u)}
                disabled={pending !== null}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-medium">{u.name}</span>
                  <span className="block text-xs text-muted-foreground">{u.role}</span>
                </span>
                {pending === u.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Eye className="size-4 text-muted-foreground" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Visible on every page while viewing as someone else. */
export function ViewAsBanner({ name, role }: { name: string; role: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-bb-honey px-4 py-2 text-center text-sm font-medium text-bb-ink"
    >
      <span>
        <Eye className="mr-1 inline size-4 align-[-3px]" aria-hidden />
        Viewing as <strong>{name}</strong> ({role}) · read-only
      </span>
      <Button
        size="xs"
        variant="outline"
        className="border-bb-ink bg-white/70 text-bb-ink hover:bg-white"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await stopViewAs();
            window.location.assign("/");
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        Exit view as
      </Button>
    </div>
  );
}
