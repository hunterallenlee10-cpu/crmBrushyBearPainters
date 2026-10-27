/** Integer cents → "$12,500.00" (negative amounts as "−$80.00"). Money is cents everywhere. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const abs = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.abs(cents) / 100,
  );
  return cents < 0 ? `−${abs}` : abs;
}

/** Whole dollars: "$12,500". */
export function formatDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const abs = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(Math.abs(cents) / 100));
  return cents < 0 ? `−${abs}` : abs;
}
