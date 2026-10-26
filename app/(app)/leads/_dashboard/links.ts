import { encodeFilter, type FilterSpec, type Rule } from "@/lib/lists/filters";
import { OPEN_LEAD_STATUSES, type LeadStatus } from "@/lib/domain/leads/constants";
import { pacificIsoDate } from "@/lib/format/dates";
import type { AgingRow, FunnelStep } from "@/lib/metrics/registry";

/**
 * Drill-down links from the Lead Dashboard into the Lead List (SPEC §8: every
 * card and chart opens the filtered list). They use the list's own URL state:
 * `tab`, `chips` and `f` (advanced filter, see lib/lists/modules/leads.ts).
 */

export const LEAD_LIST_PATH = "/leads/list";

export function leadListHref({
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
  return qs ? `${LEAD_LIST_PATH}?${qs}` : LEAD_LIST_PATH;
}

const all = (...rules: Rule[]): FilterSpec => ({ match: "all", rules });
const any = (...rules: Rule[]): FilterSpec => ({ match: "any", rules });

/** A status bar: open statuses have their own tab; end states filter the All tab. */
export function statusHref(status: LeadStatus): string {
  if (OPEN_LEAD_STATUSES.includes(status)) return leadListHref({ tab: status });
  return leadListHref({
    tab: "all",
    filter: all({ field: "status", op: "equals", value: status }),
  });
}

/** A funnel step: leads that ever reached it (same definition as `lead_stats`). */
export function funnelHref(step: FunnelStep["key"]): string {
  switch (step) {
    case "leads":
      return leadListHref({ tab: "all" });
    case "contacted":
      return leadListHref({
        tab: "all",
        filter: any(
          { field: "first_contacted", op: "is_not_empty" },
          { field: "status", op: "in", value: ["contacted", "walkthrough_scheduled", "converted"] },
        ),
      });
    case "walkthrough":
      return leadListHref({
        tab: "all",
        filter: any(
          { field: "walkthrough", op: "is_not_empty" },
          { field: "status", op: "in", value: ["walkthrough_scheduled", "converted"] },
        ),
      });
    case "converted":
      return statusHref("converted");
  }
}

export function sourceHref(source: string | null): string {
  return leadListHref({
    tab: "all",
    filter: source
      ? all({ field: "source", op: "equals", value: source })
      : all({ field: "source", op: "is_empty" }),
  });
}

/** Names `lead_stats` uses for leads without a service-area city. */
export const OUTSIDE_AREA_CITY = "Outside service area";
export const UNKNOWN_CITY = "Unknown";

/** A city bar. `territories` maps territory names to ids; unknown names get no link. */
export function cityHref(
  city: string,
  territories: readonly { value: string; label: string }[],
): string | undefined {
  if (city === OUTSIDE_AREA_CITY) {
    return leadListHref({
      tab: "all",
      filter: all({ field: "out_of_area", op: "equals", value: "true" }),
    });
  }
  if (city === UNKNOWN_CITY) {
    return leadListHref({
      tab: "all",
      filter: all(
        { field: "territory", op: "is_empty" },
        { field: "out_of_area", op: "equals", value: "false" },
      ),
    });
  }
  const t = territories.find((x) => x.label === city);
  return t
    ? leadListHref({
        tab: "all",
        filter: all({ field: "territory", op: "equals", value: t.value }),
      })
    : undefined;
}

const DAY_MS = 86_400_000;

/**
 * An aging bucket: open leads by created date. The list filters by Pacific
 * calendar day, so a bucket's edges can differ from the chart by part of a day.
 */
export function agingHref(bucket: AgingRow["key"], now: Date = new Date()): string {
  const day = (n: number) => pacificIsoDate(new Date(now.getTime() - n * DAY_MS));
  const between = (olderDays: number, newerDays: number) =>
    all({ field: "created", op: "between", value: day(olderDays), value2: day(newerDays) });
  switch (bucket) {
    case "0_3":
      return leadListHref({ filter: all({ field: "created", op: "in_last_days", value: "3" }) });
    case "4_7":
      return leadListHref({ filter: between(6, 3) });
    case "8_14":
      return leadListHref({ filter: between(13, 7) });
    case "15_30":
      return leadListHref({ filter: between(29, 14) });
    case "30_plus":
      return leadListHref({ filter: all({ field: "created", op: "lt", value: day(29) }) });
  }
}
