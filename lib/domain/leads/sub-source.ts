/**
 * Lead sub-source rule (SPEC §5.1 "Lead Sub-Source" picklist with parents).
 * Pure; shared by the New Lead wizard and Edit lead, in the browser and on
 * the server.
 */

export type SubSourceOption = { value: string; parent?: string | null; active?: boolean };

export const SUB_SOURCE_REQUIRED = "Pick a sub-source.";
export const SUB_SOURCE_MISMATCH = "That sub-source doesn't go with this source.";

/** Sub-sources that belong under a source (active ones only, for the picker). */
export function subSourcesFor<T extends SubSourceOption>(
  source: string | null | undefined,
  subSources: readonly T[],
): T[] {
  if (!source) return [];
  return subSources.filter((o) => o.parent === source && o.active !== false);
}

/**
 * Sub-source is required only when the chosen source has sub-sources, and a
 * given sub-source must belong to that source (or to no source). Returns the
 * message, or null when it's fine.
 */
export function subSourceIssue(
  source: string | null | undefined,
  subSource: string | null | undefined,
  subSources: readonly SubSourceOption[],
): string | null {
  if (!source) return null;
  if (subSource) {
    const fits = subSources.some(
      (o) => o.value === subSource && (o.parent === source || o.parent == null),
    );
    return fits ? null : SUB_SOURCE_MISMATCH;
  }
  return subSourcesFor(source, subSources).length > 0 ? SUB_SOURCE_REQUIRED : null;
}
