/**
 * Default job name "Lastname – City – Work types" (same shape the lead
 * conversion uses). Pure, unit-tested. Empty parts are left out.
 */
export function defaultJobName(parts: {
  lastName?: string | null;
  firstName?: string | null;
  accountName?: string | null;
  city?: string | null;
  workTypeLabels: readonly string[];
}): string {
  const who = parts.lastName?.trim() || parts.firstName?.trim() || parts.accountName?.trim() || "";
  const city = parts.city?.trim() ?? "";
  const work = parts.workTypeLabels
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  return [who, city, work].filter(Boolean).join(" – ").slice(0, 200);
}
