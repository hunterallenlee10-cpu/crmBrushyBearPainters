/**
 * Territories and ZIP codes (SPEC §5.1). A lead whose ZIP isn't in any active
 * service territory is flagged Out of area, never rejected.
 */

export type TerritoryLite = {
  id: string;
  name: string;
  zipCodes: readonly string[];
  isServiceArea: boolean;
  active: boolean;
};

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;

/** Pulls the 5-digit ZIP out of "98033", "98033-1234" or a full address. */
export function normalizeZip(input: string | null | undefined): string | null {
  if (!input) return null;
  const matches = [...input.matchAll(new RegExp(ZIP_RE, "g"))];
  // In a full address the ZIP comes last ("123 Main St 98033"), after any house number.
  const last = matches.at(-1);
  return last?.[1] ?? null;
}

/** Parses a comma/space/newline separated ZIP list into sorted unique 5-digit ZIPs. */
export function parseZipList(input: string): { zips: string[]; invalid: string[] } {
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const zips = new Set<string>();
  const invalid: string[] = [];
  for (const t of tokens) {
    if (/^\d{5}$/.test(t)) zips.add(t);
    else invalid.push(t);
  }
  return { zips: [...zips].sort(), invalid };
}

export function territoryForZip<T extends TerritoryLite>(
  territories: readonly T[],
  zipOrAddress: string | null | undefined,
): T | null {
  const zip = normalizeZip(zipOrAddress);
  if (!zip) return null;
  return territories.find((t) => t.active && t.isServiceArea && t.zipCodes.includes(zip)) ?? null;
}

/** ZIPs in `zips` already claimed by a different territory. */
export function findZipConflicts(
  territories: readonly TerritoryLite[],
  zips: readonly string[],
  excludeId?: string,
): { zip: string; territory: string }[] {
  const out: { zip: string; territory: string }[] = [];
  for (const t of territories) {
    if (t.id === excludeId) continue;
    for (const z of zips) if (t.zipCodes.includes(z)) out.push({ zip: z, territory: t.name });
  }
  return out;
}
