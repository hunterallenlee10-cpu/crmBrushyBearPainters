import {
  decodeFilter,
  encodeFilter,
  type FieldDef,
  type FilterSpec,
  type QueryOp,
} from "@/lib/lists/filters";

/** Lists that support saved views and column choices (saved_views.module). */
export type ListModuleId = "leads" | "accounts" | "contacts" | "jobs";

/**
 * List state lives in the URL so every filtered list is a shareable link and
 * the browser Back button works: ?q=&tab=&chips=&f=&sort=&dir=&page=&size=&view=
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type ListState = {
  q: string;
  tab: string;
  chips: string[];
  filter: FilterSpec;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  size: PageSize;
  view: string | null;
};

export type ColumnDef = {
  id: string;
  label: string;
  /** Shown when the user hasn't customized columns. */
  defaultVisible: boolean;
  /** Database column used for sorting (absent = not sortable). */
  sortColumn?: string;
  /** Always visible (e.g. the name column). */
  locked?: boolean;
};

export type TabDef = { id: string; label: string; countKey: string };
export type ChipDef = { id: string; label: string; group?: string };

/** Context a module needs to translate tabs/chips into filters. */
export type ListContext = { userId: string; now: Date };

export type ListModule = {
  id: ListModuleId;
  label: string;
  fields: readonly FieldDef[];
  columns: readonly ColumnDef[];
  tabs: readonly TabDef[];
  chips: readonly ChipDef[];
  defaultTab: string;
  defaultSort: { column: string; dir: "asc" | "desc" };
  searchPlaceholder: string;
  /** Filters for the free-text search box. */
  searchOps: (q: string) => QueryOp[];
  tabOps: (tab: string, ctx: ListContext) => QueryOp[];
  chipOps: (chip: string, ctx: ListContext) => QueryOp[];
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const v = params[key];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export function parseListState(params: Params, mod: ListModule): ListState {
  const tab = get(params, "tab");
  const sort = get(params, "sort");
  const dir = get(params, "dir");
  const page = Number(get(params, "page") ?? "1");
  const size = Number(get(params, "size") ?? "25");
  const sortable = new Set(mod.columns.flatMap((c) => (c.sortColumn ? [c.sortColumn] : [])));
  const chipIds = new Set(mod.chips.map((c) => c.id));
  return {
    q: (get(params, "q") ?? "").slice(0, 200),
    tab: tab && mod.tabs.some((t) => t.id === tab) ? tab : mod.defaultTab,
    chips: (get(params, "chips") ?? "").split(",").filter((c) => chipIds.has(c)),
    filter: decodeFilter(get(params, "f")),
    sort: sort && sortable.has(sort) ? sort : mod.defaultSort.column,
    dir: dir === "asc" || dir === "desc" ? dir : mod.defaultSort.dir,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? (size as PageSize) : 25,
    view: get(params, "view"),
  };
}

export type ListDefaults = Pick<ListModule, "defaultTab" | "defaultSort">;

/** Serializes state back to a query string, leaving out defaults. */
export function listStateToQuery(state: ListState, mod: ListDefaults): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.tab !== mod.defaultTab) p.set("tab", state.tab);
  if (state.chips.length) p.set("chips", state.chips.join(","));
  const f = encodeFilter(state.filter);
  if (f) p.set("f", f);
  if (state.sort !== mod.defaultSort.column || state.dir !== mod.defaultSort.dir) {
    p.set("sort", state.sort);
    p.set("dir", state.dir);
  }
  if (state.page > 1) p.set("page", String(state.page));
  if (state.size !== 25) p.set("size", String(state.size));
  if (state.view) p.set("view", state.view);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Every filter instruction for a list request (tab + chips + search + advanced rules). */
export function listOps(
  state: ListState,
  mod: ListModule,
  ctx: ListContext,
  advanced: QueryOp[],
): QueryOp[] {
  return [
    ...mod.tabOps(state.tab, ctx),
    ...state.chips.flatMap((c) => mod.chipOps(c, ctx)),
    ...(state.q.trim() ? mod.searchOps(state.q.trim()) : []),
    ...advanced,
  ];
}

/** Visible columns in order: the user's saved choice, or the defaults. Locked columns always show. */
export function resolveColumns(
  mod: ListModule,
  saved: readonly string[] | null | undefined,
): ColumnDef[] {
  const byId = new Map(mod.columns.map((c) => [c.id, c]));
  const chosen = (saved ?? []).flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
  const base = chosen.length ? chosen : mod.columns.filter((c) => c.defaultVisible);
  const locked = mod.columns.filter((c) => c.locked && !base.includes(c));
  return [...locked, ...base];
}

/** Saved-view payload (also what "Save view" stores). */
export type ViewConfig = {
  q?: string;
  tab?: string;
  chips?: string[];
  f?: string;
  sort?: string;
  dir?: "asc" | "desc";
  columns?: string[];
};

export function stateToViewConfig(state: ListState, columns: readonly string[]): ViewConfig {
  return {
    q: state.q || undefined,
    tab: state.tab,
    chips: state.chips.length ? state.chips : undefined,
    f: encodeFilter(state.filter) || undefined,
    sort: state.sort,
    dir: state.dir,
    columns: [...columns],
  };
}

export function viewConfigToQuery(config: ViewConfig, viewId: string): string {
  const p = new URLSearchParams();
  if (config.q) p.set("q", config.q);
  if (config.tab) p.set("tab", config.tab);
  if (config.chips?.length) p.set("chips", config.chips.join(","));
  if (config.f) p.set("f", config.f);
  if (config.sort) p.set("sort", config.sort);
  if (config.dir) p.set("dir", config.dir);
  p.set("view", viewId);
  return `?${p.toString()}`;
}
