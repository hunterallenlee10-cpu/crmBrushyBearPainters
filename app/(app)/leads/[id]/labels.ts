import type { LeadOptions } from "@/lib/leads/service";

export type PicklistKey = keyof LeadOptions["picklists"];
export type Labeler = (list: PicklistKey, value: string | null | undefined) => string | null;

/** Picklist value → label lookup (falls back to the stored key). */
export function makeLabeler(options: LeadOptions): Labeler {
  const maps = new Map<PicklistKey, Map<string, string>>();
  for (const [key, list] of Object.entries(options.picklists) as [
    PicklistKey,
    LeadOptions["picklists"][PicklistKey],
  ][]) {
    maps.set(key, new Map(list.map((o) => [o.value, o.label])));
  }
  return (list, value) => (value ? (maps.get(list)?.get(value) ?? value) : null);
}

/** Active choices for a picklist, keeping the record's current value even if retired. */
export function choices(
  options: LeadOptions,
  list: PicklistKey,
  current?: string | null,
): { value: string; label: string }[] {
  return options.picklists[list]
    .filter((o) => o.active !== false || o.value === current)
    .map((o) => ({ value: o.value, label: o.label }));
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";
