import { encodeFilter, type FilterSpec } from "@/lib/lists/filters";
import { JOB_LIST_PATH, stageListQuery } from "@/lib/lists/modules/jobs";
import type { JobStageId } from "@/lib/domain/stages";
import type { PipelineHealthRow } from "@/lib/metrics/registry";
import type { PeriodRange } from "./periods";

/**
 * Drill-down links from the Jobs Dashboard into the Job List (SPEC §8: every
 * card and chart opens the filtered list). They use the list's own URL state:
 * `tab`, `chips` and `f` (advanced filter, see lib/lists/modules/jobs.ts).
 */

export function jobListHref({
  tab,
  chips,
  filter,
}: {
  tab?: string;
  chips?: readonly string[];
  filter?: FilterSpec;
} = {}): string {
  const p = new URLSearchParams();
  if (tab && tab !== "active") p.set("tab", tab);
  if (chips?.length) p.set("chips", chips.join(","));
  const f = filter ? encodeFilter(filter) : "";
  if (f) p.set("f", f);
  const qs = p.toString();
  return qs ? `${JOB_LIST_PATH}?${qs}` : JOB_LIST_PATH;
}

/** A stage row: closed stages open the All tab (Active hides them). */
export function stageHref(stage: JobStageId): string {
  return jobListHref(stageListQuery(stage));
}

/** Days of the period, inclusive, for a date rule ("between first and last day"). */
function inPeriod(field: "closed" | "sold", range: PeriodRange): FilterSpec {
  return {
    match: "all",
    rules: [{ field, op: "between", value: range.firstDay, value2: range.lastDay }],
  };
}

/** Jobs closed won (or lost) during the period. */
export function closedHref(stage: "closed_won" | "closed_lost", range: PeriodRange): string {
  return jobListHref({ tab: "all", chips: [stage], filter: inPeriod("closed", range) });
}

/** Jobs sold (estimate accepted) during the period. */
export function soldHref(range: PeriodRange): string {
  return jobListHref({ tab: "all", filter: inPeriod("sold", range) });
}

export function pipelineHealthHref(key: PipelineHealthRow["key"], range: PeriodRange): string {
  switch (key) {
    case "open":
      return jobListHref();
    case "in_progress":
      return stageHref("in_progress");
    case "closed_won":
    case "closed_lost":
      return closedHref(key, range);
  }
}
