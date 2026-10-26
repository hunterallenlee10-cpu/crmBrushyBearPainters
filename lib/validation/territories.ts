import { z } from "zod";
import { requiredText } from "@/lib/validation/common";
import {
  normalizeZip,
  parseZipList,
  territoryForZip,
  type TerritoryLite,
} from "@/lib/domain/territory";

/**
 * Territories admin (SPEC §5.1, §8.19 Schedule Admin → Territories). ZIPs are
 * typed as free text and normalized to sorted, unique 5-digit codes. A ZIP can
 * belong to only one territory; the database re-checks on save.
 */

export const territoryFormSchema = z.object({
  id: z.uuid({ message: "Missing territory." }).optional(),
  name: requiredText("Name", 80),
  zipText: z
    .string()
    .max(5000, "That's too many ZIP codes for one territory.")
    .transform((text, ctx) => {
      const { zips, invalid } = parseZipList(text);
      if (invalid.length > 0) {
        ctx.addIssue({ code: "custom", message: invalidZipMessage(invalid) });
        return z.NEVER;
      }
      return zips;
    }),
  isServiceArea: z.boolean(),
  active: z.boolean(),
});
export type TerritoryFormInput = z.input<typeof territoryFormSchema>;
export type TerritoryFormValues = z.output<typeof territoryFormSchema>;

export const deleteTerritorySchema = z.object({
  id: z.uuid({ message: "Missing territory." }),
  reason: z
    .string()
    .trim()
    .min(3, "Say briefly why (at least 3 characters).")
    .max(500, "Keep it under 500 characters."),
});
export type DeleteTerritoryInput = z.input<typeof deleteTerritorySchema>;

export function invalidZipMessage(invalid: readonly string[]): string {
  const shown = invalid.slice(0, 6).map((t) => `"${t}"`);
  const more = invalid.length > 6 ? ` and ${invalid.length - 6} more` : "";
  return `ZIP codes must be 5 digits. Fix ${shown.join(", ")}${more}.`;
}

/** Textarea default for an existing territory. */
export function formatZipList(zips: readonly string[]): string {
  return [...zips].sort().join(", ");
}

/** Groups conflicts per territory: "98004 and 98005 already belong to Bellevue." */
export function describeZipConflicts(
  conflicts: readonly { zip: string; territory: string }[],
): string[] {
  const byTerritory = new Map<string, string[]>();
  for (const c of conflicts) {
    const list = byTerritory.get(c.territory) ?? [];
    if (!list.includes(c.zip)) list.push(c.zip);
    byTerritory.set(c.territory, list);
  }
  return [...byTerritory.entries()].map(([territory, zips]) => {
    const sorted = [...zips].sort();
    const list =
      sorted.length === 1
        ? sorted[0]
        : `${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1) ?? ""}`;
    return `${list} already ${sorted.length === 1 ? "belongs" : "belong"} to ${territory}.`;
  });
}

export type ZipLookupResult =
  | { kind: "empty" }
  | { kind: "no_zip" }
  | { kind: "in_area"; zip: string; territory: string }
  | { kind: "out_of_area"; zip: string; listedUnder: string | null };

/**
 * Which territory a ZIP or address maps to, matching how leads are routed:
 * only active service-area territories count. `listedUnder` names a turned-off
 * or non-service territory that lists the ZIP, so the result isn't confusing.
 */
export function lookupZip(territories: readonly TerritoryLite[], input: string): ZipLookupResult {
  if (input.trim() === "") return { kind: "empty" };
  const zip = normalizeZip(input);
  if (!zip) return { kind: "no_zip" };
  const match = territoryForZip(territories, zip);
  if (match) return { kind: "in_area", zip, territory: match.name };
  const listed = territories.find((t) => t.zipCodes.includes(zip));
  return { kind: "out_of_area", zip, listedUnder: listed?.name ?? null };
}

export function territoryConflictMessage(
  dbMessage: string | null | undefined,
  name: string,
): string | null {
  if ((dbMessage ?? "").includes("territories_org_name_uidx")) {
    return `There's already a territory named "${name}".`;
  }
  return null;
}
