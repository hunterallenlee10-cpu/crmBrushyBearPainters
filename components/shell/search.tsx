"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { Contact, FileText, History, Home, Loader2, SearchIcon, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HOME, allPages } from "@/lib/nav";
import { searchRecords, type SearchHit } from "@/components/shell/shell-actions";
import { readRecentRecords, type RecentRecord } from "@/components/shell/recent-records";

/**
 * Universal search (SPEC §8.1): leads, accounts and contacts by name, phone
 * digits, email or address (server-side, limited to what the user may see),
 * recently opened records, and page shortcuts. Jobs, invoices and mentions join
 * in later phases.
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

const KIND_ICON = { lead: UserRound, account: Home, contact: Contact } as const;
const KIND_LABEL = { lead: "Lead", account: "Account", contact: "Contact" } as const;

/** Scopes with records today; the rest say which phase brings them. */
const SCOPE_TO_RPC: Partial<Record<Scope, "all" | "leads" | "accounts" | "contacts">> = {
  All: "all",
  Accounts: "accounts",
  Contacts: "contacts",
  Leads: "leads",
};
const SCOPE_PHASE: Partial<Record<Scope, string>> = {
  Jobs: "Job search arrives with Jobs (Phase 3).",
  Invoices: "Invoice search arrives with invoicing (Phase 7).",
  Mentions: "Mention search arrives with messaging (Phase 8).",
};

function SearchDialog() {
  const { open, setOpen } = useSearch();
  const router = useRouter();
  const [scope, setScope] = React.useState<Scope>("All");
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recent, setRecent] = React.useState<RecentRecord[]>([]);
  const pages = React.useMemo(() => [HOME, ...allPages()], []);
  const rpcScope = SCOPE_TO_RPC[scope];

  React.useEffect(() => {
    if (open) setRecent(readRecentRecords());
    else {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !rpcScope) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    const t = setTimeout(() => {
      void searchRecords({ query: q, scope: rpcScope }).then((r) => {
        if (!alive) return;
        setHits(r);
        setLoading(false);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, rpcScope]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const q = query.trim().toLowerCase();
  const matchingPages = q
    ? pages.filter((p) => `${p.label} ${p.description}`.toLowerCase().includes(q)).slice(0, 8)
    : pages.slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search accounts, contacts, leads, jobs, invoices, phone numbers, addresses, emails, and
          mentions.
        </DialogDescription>
        <Command loop shouldFilter={false}>
          <div className="flex items-center gap-2 border-b pr-12 pl-4">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <CommandPrimitive.Input
              autoFocus
              aria-label="Search"
              value={query}
              onValueChange={setQuery}
              placeholder="Search names, phones, addresses, emails, job #…"
              className="h-14 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {loading && (
              <Loader2
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-label="Searching"
              />
            )}
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
            {SCOPE_PHASE[scope] && (
              <p className="px-4 py-3 text-sm text-muted-foreground">{SCOPE_PHASE[scope]}</p>
            )}
            {q.length >= 2 &&
              rpcScope &&
              !loading &&
              hits.length === 0 &&
              matchingPages.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No matches. Try a phone number, an email or part of an address.
                </p>
              )}
            {hits.length > 0 && (
              <CommandGroup heading="Records">
                {hits.map((h) => {
                  const Icon = KIND_ICON[h.kind];
                  return (
                    <CommandItem
                      key={`${h.kind}:${h.id}`}
                      value={`${h.kind}:${h.id}`}
                      onSelect={() => go(h.href)}
                    >
                      <Icon aria-hidden />
                      <span className="font-medium">{h.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {KIND_LABEL[h.kind]}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {q.length < 2 && (
              <CommandGroup heading="Recent records">
                {recent.length === 0 ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <History className="size-4" aria-hidden />
                    No recent records yet. Records you open will show up here.
                  </div>
                ) : (
                  recent.map((r) => {
                    const Icon = KIND_ICON[r.kind];
                    return (
                      <CommandItem
                        key={r.href}
                        value={`recent:${r.href}`}
                        onSelect={() => go(r.href)}
                      >
                        <Icon aria-hidden />
                        <span className="font-medium">{r.title}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {KIND_LABEL[r.kind]}
                        </span>
                      </CommandItem>
                    );
                  })
                )}
              </CommandGroup>
            )}
            {matchingPages.length > 0 && (
              <CommandGroup heading="Go to page">
                {matchingPages.map((p) => (
                  <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)}>
                    <FileText aria-hidden />
                    <span className="font-medium">{p.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{p.description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
