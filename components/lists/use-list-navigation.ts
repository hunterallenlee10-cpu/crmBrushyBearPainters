"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { listStateToQuery, type ListDefaults, type ListState } from "@/lib/lists/params";

/**
 * Moves a list to a new state by updating the URL (server components re-render
 * with the new rows). Any change other than paging returns to page 1.
 */
export function useListNavigation(state: ListState, defaults: ListDefaults) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  // Quick successive clicks build on the newest requested state, not the one
  // still on screen (otherwise a second click would undo the first).
  const latest = React.useRef<ListState>(state);
  React.useEffect(() => {
    latest.current = state;
  }, [state]);

  const go = React.useCallback(
    (patch: Partial<ListState>, opts: { keepView?: boolean } = {}) => {
      const base = latest.current;
      const resetsPage = Object.keys(patch).some((k) => k !== "page" && k !== "size");
      const next: ListState = {
        ...base,
        ...patch,
        page: patch.page ?? (resetsPage ? 1 : base.page),
        view: opts.keepView || "view" in patch ? (patch.view ?? base.view) : base.view,
      };
      latest.current = next;
      startTransition(() => {
        router.push(`${pathname}${listStateToQuery(next, defaults)}`, { scroll: false });
      });
    },
    [defaults, router, pathname],
  );

  const goToQuery = React.useCallback(
    (query: string) => {
      startTransition(() => router.push(`${pathname}${query}`, { scroll: false }));
    },
    [router, pathname],
  );

  return { go, goToQuery, pending };
}
