import type { CustomFieldModule } from "@/lib/domain/custom-fields/types";

/**
 * Page layouts (Module Manager): the order and visibility of the sections on
 * each module's detail page. Stored per company in `module_layouts.sections`
 * as [{ key, visible }]. Sections the code adds later appear at the end,
 * visible; locked sections can be moved but never hidden. Pure.
 */

export type LayoutSection = { key: string; label: string; locked?: boolean };

export const LAYOUT_SECTIONS: Record<CustomFieldModule, readonly LayoutSection[]> = {
  jobs: [
    { key: "overview", label: "Overview", locked: true },
    { key: "onboarding", label: "Onboarding" },
    { key: "schedule", label: "Schedule" },
    { key: "estimate", label: "Estimate & Scope" },
    { key: "financial", label: "Financial" },
    { key: "photos", label: "Photos" },
    { key: "documents", label: "Documents" },
    { key: "work_orders", label: "Work Orders" },
    { key: "daily_logs", label: "Daily Logs" },
    { key: "customer", label: "Customer" },
    { key: "messages", label: "Messages" },
    { key: "tasks", label: "Tasks & Checklists" },
    { key: "punch_list", label: "Punch List" },
    { key: "notes", label: "Notes" },
    { key: "activity", label: "Activity Log" },
    { key: "custom_fields", label: "More fields card (on Overview)" },
    { key: "admin", label: "Admin", locked: true },
  ],
  leads: [
    { key: "details", label: "Details", locked: true },
    { key: "custom_fields", label: "More fields card (on Details)" },
    { key: "activity", label: "Activity" },
    { key: "notes", label: "Notes" },
    { key: "comments", label: "Comments" },
    { key: "tasks", label: "Tasks" },
  ],
  accounts: [
    { key: "contacts", label: "Contacts" },
    { key: "properties", label: "Properties" },
    { key: "leads", label: "Leads" },
    { key: "documents", label: "Documents" },
    { key: "details", label: "Details", locked: true },
    { key: "custom_fields", label: "More fields (custom)" },
    { key: "timeline", label: "Timeline" },
  ],
  contacts: [
    { key: "info", label: "Contact info", locked: true },
    { key: "custom_fields", label: "More fields (custom)" },
    { key: "leads", label: "Leads" },
    { key: "consent", label: "Consent", locked: true },
    { key: "timeline", label: "Timeline" },
  ],
};

/** Job section ids in the URL use dashes; layout keys use underscores. */
export function layoutKey(sectionId: string): string {
  return sectionId.replace(/-/g, "_");
}

export type StoredLayout = readonly { key: string; visible: boolean }[];
export type ResolvedSection = LayoutSection & { visible: boolean };

/**
 * The page's sections in the saved order with visibility. Unknown saved keys
 * are dropped; sections missing from the saved layout are appended visible;
 * locked sections are always visible.
 */
export function resolveLayout(
  module: CustomFieldModule,
  stored: StoredLayout | null | undefined,
): ResolvedSection[] {
  const catalog = LAYOUT_SECTIONS[module];
  const byKey = new Map(catalog.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const out: ResolvedSection[] = [];
  for (const s of stored ?? []) {
    const def = byKey.get(s.key);
    if (!def || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ ...def, visible: def.locked ? true : s.visible });
  }
  for (const def of catalog) if (!seen.has(def.key)) out.push({ ...def, visible: true });
  return out;
}

/** Layout to store from a resolved list (keys in order + visibility). */
export function toStoredLayout(
  sections: readonly ResolvedSection[],
): { key: string; visible: boolean }[] {
  return sections.map((s) => ({ key: s.key, visible: s.locked ? true : s.visible }));
}

/** Parses `module_layouts.sections` jsonb; drops malformed entries. */
export function parseStoredLayout(raw: unknown): StoredLayout {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s: unknown) => {
    if (!s || typeof s !== "object") return [];
    const { key, visible } = s as Record<string, unknown>;
    return typeof key === "string" && typeof visible === "boolean" ? [{ key, visible }] : [];
  });
}

/** Moves the section at `from` to `to` (drag-and-drop or up/down buttons). */
export function moveSection<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Lookup for pages that place sections in a grid: visible? and CSS order. */
export function layoutLookup(sections: readonly ResolvedSection[]): {
  visible: (key: string) => boolean;
  order: (key: string) => number;
} {
  const index = new Map(sections.map((s, i) => [s.key, i]));
  const shown = new Set(sections.filter((s) => s.visible).map((s) => s.key));
  return {
    visible: (key) => shown.has(key) || !index.has(key),
    order: (key) => index.get(key) ?? sections.length,
  };
}
