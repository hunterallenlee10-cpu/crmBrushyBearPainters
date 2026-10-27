"use client";

import type { ListModuleId } from "@/lib/lists/params";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { FieldDef, FilterSpec } from "@/lib/lists/filters";
import {
  PAGE_SIZES,
  stateToViewConfig,
  viewConfigToQuery,
  type ChipDef,
  type ColumnDef,
  type ListDefaults,
  type ListState,
  type PageSize,
} from "@/lib/lists/params";
import { AdvancedFilter } from "@/components/lists/advanced-filter";
import { ColumnsDialog } from "@/components/lists/columns-dialog";
import { ViewsMenu, type SavedViewItem } from "@/components/lists/views-menu";
import { useListNavigation } from "@/components/lists/use-list-navigation";

/**
 * Shared list framework (SPEC §8 "Lists"), built once for Leads, Accounts,
 * Contacts and later Jobs. Server components fetch the rows (server-side
 * paging, sorting and filtering) and render each cell; this component owns
 * the controls, selection and the preview drawer. All state is in the URL.
 */

export type ListRow = {
  id: string;
  label: string;
  cells: Record<string, React.ReactNode>;
  /** Card shown instead of the table row when `layout` is "cards" (Jobs). */
  card?: React.ReactNode;
};
export type TabWithCount = { id: string; label: string; count: number | null };

export type ListShellProps = {
  moduleId: ListModuleId;
  state: ListState;
  defaults: ListDefaults;
  tabs: readonly TabWithCount[];
  chips: readonly ChipDef[];
  fields: readonly FieldDef[];
  allColumns: readonly ColumnDef[];
  visibleColumns: readonly ColumnDef[];
  rows: readonly ListRow[];
  total: number | null;
  savedViews: readonly SavedViewItem[];
  searchPlaceholder: string;
  /** Module-specific quick selects (Source, City, Health…). */
  quickFilters?: React.ReactNode;
  emptyState: React.ReactNode;
  /** Bulk actions for the selected ids. Omit to hide selection. */
  bulkActions?: (ids: string[], clear: () => void) => React.ReactNode;
  renderPreview?: (id: string) => React.ReactNode;
  /** Name of one record, for screen readers ("lead"). */
  noun: string;
  /** "cards" renders each row's `card` in a grid instead of the table. Default "table". */
  layout?: "table" | "cards";
  /** Live count shown on each quick-filter chip, by chip id. */
  chipCounts?: Readonly<Record<string, number>>;
  /** Extra URL params kept on every navigation (e.g. the Jobs list/card toggle). */
  persistParams?: Readonly<Record<string, string>>;
};

function formatCount(n: number | null): string {
  return n === null ? "" : n.toLocaleString("en-US");
}

export function ListShell(props: ListShellProps) {
  const { state, defaults, moduleId } = props;
  const { go, goToQuery, pending } = useListNavigation(state, defaults, props.persistParams);
  const [query, setQuery] = React.useState(state.q);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const headerCheckbox = React.useRef<HTMLInputElement>(null);
  // Set once the list is interactive (hydrated); tests wait for it before clicking.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);

  // Keep the box in sync when navigating (Back button, views).
  React.useEffect(() => setQuery(state.q), [state.q]);
  // Selection belongs to the rows on screen.
  const rowIds = props.rows.map((r) => r.id).join(",");
  React.useEffect(() => setSelected(new Set()), [rowIds]);

  // Debounced search.
  React.useEffect(() => {
    if (query === state.q) return;
    const t = setTimeout(() => go({ q: query.trim() }), 350);
    return () => clearTimeout(t);
  }, [query, state.q, go]);

  const allSelected = props.rows.length > 0 && props.rows.every((r) => selected.has(r.id));
  const someSelected = props.rows.some((r) => selected.has(r.id));
  React.useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const from = props.total === 0 ? 0 : (state.page - 1) * state.size + 1;
  const to = (state.page - 1) * state.size + props.rows.length;
  const lastPage =
    props.total === null ? state.page : Math.max(1, Math.ceil(props.total / state.size));

  function toggleChip(chip: ChipDef) {
    const on = state.chips.includes(chip.id);
    let next = state.chips.filter((c) => c !== chip.id);
    if (!on) {
      // Chips in the same group (e.g. lead source) are either/or.
      if (chip.group) {
        const sameGroup = new Set(
          props.chips.filter((c) => c.group === chip.group).map((c) => c.id),
        );
        next = next.filter((c) => !sameGroup.has(c));
      }
      next = [...next, chip.id];
    }
    go({ chips: next });
  }

  function sortBy(col: ColumnDef) {
    if (!col.sortColumn) return;
    const dir = state.sort === col.sortColumn && state.dir === "desc" ? "asc" : "desc";
    go({ sort: col.sortColumn, dir });
  }

  const selectable = Boolean(props.bulkActions);
  const ids = [...selected];
  const clear = () => setSelected(new Set());
  const hasFilters = state.q !== "" || state.chips.length > 0 || state.filter.rules.length > 0;

  return (
    <div className="flex flex-col gap-3" data-list-ready={ready ? "true" : undefined}>
      {/* Status tabs with live counts */}
      <nav aria-label={`${props.noun} status`} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b px-1">
          {props.tabs.map((t) => {
            const active = t.id === state.tab;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => go({ tab: t.id })}
                  className={cn(
                    "-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium",
                    active
                      ? "border-bb-forest text-bb-forest"
                      : "border-transparent text-foreground/80 hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.count !== null && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs tabular-nums",
                        active ? "bg-bb-forest text-white" : "bg-muted text-foreground/80",
                      )}
                    >
                      {formatCount(t.count)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label={`Search ${props.noun}s`}
            placeholder={props.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <ViewsMenu
          moduleId={moduleId}
          views={props.savedViews}
          currentViewId={state.view}
          currentConfig={stateToViewConfig(
            state,
            props.visibleColumns.map((c) => c.id),
          )}
          onApply={(v) => goToQuery(viewConfigToQuery(v.config, v.id))}
          onClear={() => goToQuery("")}
        />
        {props.quickFilters}
        <AdvancedFilter
          fields={props.fields}
          filter={state.filter}
          onApply={(f: FilterSpec) => go({ filter: f })}
        />
        <ColumnsDialog
          moduleId={moduleId}
          allColumns={props.allColumns}
          visibleIds={props.visibleColumns.map((c) => c.id)}
        />
        {pending && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
        )}
      </div>

      {/* Quick-filter chips */}
      {props.chips.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Quick filters"
        >
          {props.chips.map((chip) => {
            const on = state.chips.includes(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleChip(chip)}
                className={cn(
                  "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                  on
                    ? "border-bb-forest bg-bb-forest text-white"
                    : "border-border bg-card text-foreground hover:border-bb-forest/50",
                )}
              >
                {chip.label}
                {props.chipCounts?.[chip.id] !== undefined && (
                  <span
                    className={cn(
                      "ml-1.5 rounded-full px-1.5 tabular-nums",
                      on ? "bg-white/20" : "bg-muted text-foreground/80",
                    )}
                  >
                    {formatCount(props.chipCounts[chip.id] ?? 0)}
                  </span>
                )}
              </button>
            );
          })}
          {hasFilters && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => go({ q: "", chips: [], filter: { match: "all", rules: [] } })}
              className="ml-1"
            >
              <X aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Bulk bar */}
      {selectable && ids.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-bb-forest/30 bg-bb-cream px-3 py-2 shadow-sm"
        >
          <span className="text-sm font-medium">{ids.length} selected</span>
          {props.bulkActions?.(ids, clear)}
          <Button variant="ghost" size="sm" onClick={clear} className="ml-auto">
            Clear selection
          </Button>
        </div>
      )}

      {/* Table */}
      {props.rows.length === 0 ? (
        props.emptyState
      ) : props.layout === "cards" ? (
        <ul
          aria-label={`${props.noun}s, page ${state.page}`}
          className={cn(
            "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
            pending && "opacity-70",
          )}
        >
          {props.rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "relative rounded-2xl",
                selected.has(row.id) && "ring-2 ring-bb-forest/40",
              )}
            >
              {row.card ?? row.label}
              {(selectable || props.renderPreview) && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {selectable && (
                    <label className="grid size-8 place-items-center rounded-md hover:bg-muted">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.label}`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </label>
                  )}
                  {props.renderPreview && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Preview ${row.label}`}
                      onClick={() => setPreviewId(row.id)}
                    >
                      <Eye aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div
          className={cn(
            "relative overflow-x-auto rounded-xl border bg-card",
            pending && "opacity-70",
          )}
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              {props.noun}s, page {state.page}
            </caption>
            <thead className="border-b bg-muted/40 text-left text-xs font-semibold text-foreground/80">
              <tr>
                {selectable && (
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      ref={headerCheckbox}
                      type="checkbox"
                      aria-label={
                        allSelected ? "Unselect all on this page" : "Select all on this page"
                      }
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(props.rows.map((r) => r.id)))
                      }
                    />
                  </th>
                )}
                {props.visibleColumns.map((col) => {
                  const sorted = col.sortColumn && state.sort === col.sortColumn;
                  return (
                    <th
                      key={col.id}
                      scope="col"
                      className="px-3 py-2 whitespace-nowrap"
                      aria-sort={
                        sorted ? (state.dir === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {col.sortColumn ? (
                        <button
                          type="button"
                          onClick={() => sortBy(col)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {col.label}
                          {sorted ? (
                            state.dir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            )
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  );
                })}
                {props.renderPreview && (
                  <th scope="col" className="w-12 px-3 py-2">
                    <span className="sr-only">Preview</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/30",
                    selected.has(row.id) && "bg-bb-cream/60",
                  )}
                >
                  {selectable && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.label}`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                  )}
                  {props.visibleColumns.map((col) => (
                    <td key={col.id} className="px-3 py-2 align-middle">
                      {row.cells[col.id] ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                  {props.renderPreview && (
                    <td className="px-2 py-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Preview ${row.label}`}
                        onClick={() => setPreviewId(row.id)}
                      >
                        <Eye aria-hidden />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {props.rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {props.total === null
              ? `${from}–${to}`
              : `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${props.total.toLocaleString("en-US")}`}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-muted-foreground">
              Rows
              <select
                className="h-8 rounded-md border bg-card px-2 text-foreground"
                value={state.size}
                onChange={(e) => go({ size: Number(e.target.value) as PageSize, page: 1 })}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={state.page <= 1}
              onClick={() => go({ page: state.page - 1 })}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular-nums">
              Page {state.page} of {lastPage}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={state.page >= lastPage}
              onClick={() => go({ page: state.page + 1 })}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Quick preview drawer */}
      {props.renderPreview && (
        <Sheet open={previewId !== null} onOpenChange={(open) => !open && setPreviewId(null)}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>
                {props.rows.find((r) => r.id === previewId)?.label ?? "Preview"}
              </SheetTitle>
              <SheetDescription className="sr-only">Quick preview</SheetDescription>
            </SheetHeader>
            {previewId && <div className="px-4 pb-6">{props.renderPreview(previewId)}</div>}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
