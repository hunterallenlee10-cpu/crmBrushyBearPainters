/** Friendly names for production-rate surface keys, taken from the catalog items that use them. */
export function surfaceLabels(
  items: readonly { surface: string | null; name: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of items) if (i.surface && !out.has(i.surface)) out.set(i.surface, i.name);
  return out;
}

export function humanize(key: string): string {
  const s = key.replace(/^(int|ext|cab)_/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
