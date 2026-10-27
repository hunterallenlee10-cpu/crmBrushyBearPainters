"use client";

import * as React from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useParamNavigation } from "./use-param-navigation";

export type FilterSelect = {
  /** URL parameter name. */
  param: string;
  label: string;
  value: string;
  /** "" is the default ("Any …"). */
  options: readonly { value: string; label: string }[];
};

const selectClass =
  "h-11 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:h-9";

/**
 * Attention filters: quick selects plus a title search, all kept in the URL
 * (server-side filtering and paging).
 */
export function AttentionFilters({
  selects,
  search,
  searchParam = "q",
  clearParams,
  className,
}: {
  selects: readonly FilterSelect[];
  search: string;
  searchParam?: string;
  /** Params "Clear filters" removes. Shown when any of them is set. */
  clearParams: readonly string[];
  className?: string;
}) {
  const { params, setParams, pending } = useParamNavigation();
  const [text, setText] = React.useState(search);
  const id = React.useId();

  React.useEffect(() => setText(search), [search]);

  const active = clearParams.some((p) => params.get(p));

  return (
    <section
      aria-label="Filters"
      className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:p-4", className)}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
        {selects.map((s) => (
          <div key={s.param} className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${id}-${s.param}`} className="text-xs text-muted-foreground">
              {s.label}
            </Label>
            <select
              id={`${id}-${s.param}`}
              className={selectClass}
              value={s.value}
              onChange={(e) => setParams({ [s.param]: e.target.value || null })}
            >
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <form
          role="search"
          className="flex min-w-0 flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ [searchParam]: text.trim() || null });
          }}
        >
          <Label htmlFor={`${id}-search`} className="text-xs text-muted-foreground">
            Search titles
          </Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id={`${id}-search`}
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Name, job number…"
                maxLength={100}
                className="h-11 pl-8 sm:h-9"
              />
            </div>
            <Button type="submit" variant="outline" className="h-11 sm:h-9">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Search
            </Button>
          </div>
        </form>
      </div>
      {active && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => {
              setText("");
              setParams(Object.fromEntries(clearParams.map((p) => [p, null])));
            }}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        </div>
      )}
    </section>
  );
}
