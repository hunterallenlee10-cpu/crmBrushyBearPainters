"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { FileText, History, SearchIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HOME, allPages } from "@/lib/nav";

/**
 * Universal search (SPEC §8.1). Phase 0 is the shell: scope chips, recent
 * records (empty), and page shortcuts. Record search (accounts, contacts,
 * leads, jobs, invoices, phones, addresses, emails, mentions) arrives in Phase 2.
 */

const SCOPES = ["All", "Accounts", "Contacts", "Leads", "Jobs", "Invoices", "Mentions"] as const;
type Scope = (typeof SCOPES)[number];

type SearchContextValue = { open: boolean; setOpen: (open: boolean) => void };
const SearchContext = React.createContext<SearchContextValue | null>(null);

function useSearch(): SearchContextValue {
  const ctx = React.useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used inside <SearchProvider>");
  return ctx;
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SearchContext.Provider value={{ open, setOpen }}>
      {children}
      <SearchDialog />
    </SearchContext.Provider>
  );
}

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const { setOpen } = useSearch();
  if (compact) {
    return (
      <Button variant="ghost" size="icon" aria-label="Search" onClick={() => setOpen(true)}>
        <SearchIcon />
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 w-56 items-center gap-2 rounded-lg border bg-muted/60 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted xl:w-72"
    >
      <SearchIcon className="size-4" aria-hidden />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border bg-card px-1.5 font-sans text-[11px] font-medium">Ctrl K</kbd>
    </button>
  );
}

function SearchDialog() {
  const { open, setOpen } = useSearch();
  const router = useRouter();
  const [scope, setScope] = React.useState<Scope>("All");
  const pages = React.useMemo(() => [HOME, ...allPages()], []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search accounts, contacts, leads, jobs, invoices, phone numbers, addresses, emails, and
          mentions.
        </DialogDescription>
        <Command loop>
          <div className="flex items-center gap-2 border-b pr-12 pl-4">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <CommandPrimitive.Input
              autoFocus
              aria-label="Search"
              placeholder="Search names, phones, addresses, emails, job #…"
              className="h-14 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
          </div>
          <div
            className="flex flex-wrap gap-1.5 border-b px-4 py-2.5"
            role="radiogroup"
            aria-label="Search scope"
          >
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  scope === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>
              No matches. Record search turns on once leads and jobs exist (Phase 2).
            </CommandEmpty>
            <CommandGroup heading="Recent records">
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <History className="size-4" aria-hidden />
                No recent records yet. Records you open will show up here.
              </div>
            </CommandGroup>
            <CommandGroup heading="Go to page">
              {pages.map((p) => (
                <CommandItem
                  key={p.href}
                  value={`${p.label} ${p.description}`}
                  onSelect={() => go(p.href)}
                >
                  <FileText aria-hidden />
                  <span className="font-medium">{p.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.description}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
