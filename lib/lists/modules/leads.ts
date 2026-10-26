import type { FieldDef, QueryOp } from "@/lib/lists/filters";
import type { ListContext, ListModule } from "@/lib/lists/params";
import { quote } from "@/lib/lists/filters";
import {
  HOME_BUILT,
  HOME_BUILT_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  OPEN_LEAD_STATUSES,
  SERVICES,
  SERVICE_LABELS,
  STALE_AFTER_DAYS,
  TIMELINES,
  TIMELINE_LABELS,
} from "@/lib/domain/leads/constants";

/** Lead List definition (SPEC §8.4). */

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

export const LEAD_FIELDS: readonly FieldDef[] = [
  { key: "name", label: "Name", type: "text", column: "first_name", searchColumn: "search_text" },
  { key: "email", label: "Email", type: "text", column: "email" },
  { key: "phone", label: "Phone", type: "text", column: "phone_digits" },
  { key: "city", label: "City", type: "text", column: "city" },
  { key: "zip", label: "ZIP", type: "text", column: "zip" },
  {
    key: "status",
    label: "Status",
    type: "enum",
    column: "status",
    options: opts(LEAD_STATUSES, LEAD_STATUS_LABELS),
  },
  {
    key: "disposition",
    label: "Disposition",
    type: "enum",
    column: "disposition",
    optionSource: "picklist:lead_disposition",
  },
  {
    key: "source",
    label: "Source",
    type: "enum",
    column: "lead_source",
    optionSource: "picklist:lead_source",
  },
  {
    key: "sub_source",
    label: "Sub-source",
    type: "enum",
    column: "lead_sub_source",
    optionSource: "picklist:lead_sub_source",
  },
  {
    key: "service",
    label: "Service",
    type: "array",
    column: "services",
    options: opts(SERVICES, SERVICE_LABELS),
  },
  {
    key: "timeline",
    label: "Timeline",
    type: "enum",
    column: "timeline",
    options: opts(TIMELINES, TIMELINE_LABELS),
  },
  {
    key: "home_built",
    label: "Home built",
    type: "enum",
    column: "home_built",
    options: opts(HOME_BUILT, HOME_BUILT_LABELS),
  },
  {
    key: "territory",
    label: "Territory",
    type: "enum",
    column: "territory_id",
    optionSource: "territories",
  },
  { key: "out_of_area", label: "Out of area", type: "boolean", column: "out_of_area" },
  { key: "owner", label: "Owner", type: "user", column: "owner_id", optionSource: "users" },
  {
    key: "lead_set_by",
    label: "Lead set by",
    type: "user",
    column: "lead_set_by",
    optionSource: "users",
  },
  { key: "score", label: "Score", type: "number", column: "score" },
  {
    key: "grade",
    label: "Grade",
    type: "enum",
    column: "grade",
    options: ["A", "B", "C", "D", "F"].map((g) => ({ value: g, label: g })),
  },
  {
    key: "temperature",
    label: "Temperature",
    type: "enum",
    column: "temperature",
    options: [
      { value: "hot", label: "Hot" },
      { value: "warm", label: "Warm" },
      { value: "cold", label: "Cold" },
    ],
  },
  { key: "created", label: "Created", type: "date", column: "created_at" },
  { key: "last_activity", label: "Last activity", type: "date", column: "last_activity_at" },
  { key: "walkthrough", label: "Walkthrough date", type: "date", column: "walkthrough_at" },
  { key: "first_contacted", label: "First contacted", type: "date", column: "first_contacted_at" },
];

const OPEN_IN = `(${OPEN_LEAD_STATUSES.join(",")})`;
const openOnly: QueryOp = { kind: "filter", column: "status", op: "in", value: OPEN_IN };

const GOOGLE = ["google_ads", "google_business_profile", "local_services_ads"];

function sourceOr(sources: string[], subSources: string[]): QueryOp {
  const parts = [
    sources.length ? `lead_source.in.(${sources.map(quote).join(",")})` : null,
    subSources.length ? `lead_sub_source.in.(${subSources.map(quote).join(",")})` : null,
  ].filter(Boolean);
  return { kind: "or", expr: parts.join(",") };
}

function daysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export const LEADS_LIST: ListModule = {
  id: "leads",
  label: "Leads",
  fields: LEAD_FIELDS,
  columns: [
    { id: "name", label: "Name", defaultVisible: true, sortColumn: "first_name", locked: true },
    { id: "score", label: "Score", defaultVisible: true, sortColumn: "score" },
    { id: "services", label: "Services", defaultVisible: true },
    { id: "contact", label: "Contact", defaultVisible: true },
    { id: "city", label: "City", defaultVisible: true, sortColumn: "city" },
    { id: "status", label: "Status", defaultVisible: true, sortColumn: "status" },
    { id: "walkthrough", label: "Walkthrough", defaultVisible: true, sortColumn: "walkthrough_at" },
    { id: "source", label: "Source", defaultVisible: true, sortColumn: "lead_source" },
    { id: "created", label: "Created", defaultVisible: true, sortColumn: "created_at" },
    {
      id: "last_activity",
      label: "Last activity",
      defaultVisible: true,
      sortColumn: "last_activity_at",
    },
    { id: "owner", label: "Owner", defaultVisible: true },
    { id: "disposition", label: "Disposition", defaultVisible: false, sortColumn: "disposition" },
    { id: "timeline", label: "Timeline", defaultVisible: false, sortColumn: "timeline" },
    { id: "home_built", label: "Home built", defaultVisible: false },
    { id: "zip", label: "ZIP", defaultVisible: false, sortColumn: "zip" },
    {
      id: "speed_to_lead",
      label: "Speed to lead",
      defaultVisible: false,
      sortColumn: "speed_to_lead_seconds",
    },
  ],
  tabs: [
    { id: "active", label: "Active", countKey: "active" },
    { id: "new", label: "New", countKey: "new" },
    { id: "contacted", label: "Contacted", countKey: "contacted" },
    {
      id: "walkthrough_scheduled",
      label: "Walkthrough Scheduled",
      countKey: "walkthrough_scheduled",
    },
    { id: "nurture", label: "Nurture", countKey: "nurture" },
    { id: "mine", label: "My Leads", countKey: "mine" },
    { id: "all", label: "All", countKey: "total" },
  ],
  chips: [
    { id: "hot", label: "🔥 Hot" },
    { id: "unassigned", label: "Unassigned" },
    { id: "stale", label: "Stale" },
    { id: "last_7_days", label: "Last 7 days" },
    { id: "website", label: "Website", group: "source" },
    { id: "google", label: "Google", group: "source" },
    { id: "facebook", label: "Facebook/Instagram", group: "source" },
    { id: "nextdoor", label: "Nextdoor", group: "source" },
    { id: "referral", label: "Referral", group: "source" },
    { id: "past_customer", label: "Past Customer", group: "source" },
  ],
  defaultTab: "active",
  defaultSort: { column: "created_at", dir: "desc" },
  searchPlaceholder: "Search name, email, phone, address, source…",
  searchOps: (q) => {
    const digits = q.replace(/\D/g, "");
    const term = q
      .toLowerCase()
      .replace(/[*%(),"\\]/g, " ")
      .trim();
    const parts: string[] = [];
    if (term) parts.push(`search_text.ilike.${quote(`*${term}*`)}`);
    if (digits.length >= 4) parts.push(`phone_digits.ilike.${quote(`*${digits}*`)}`);
    if (term) parts.push(`lead_source.ilike.${quote(`*${term.replace(/\s+/g, "_")}*`)}`);
    return parts.length ? [{ kind: "or", expr: parts.join(",") }] : [];
  },
  tabOps: (tab, ctx: ListContext) => {
    switch (tab) {
      case "active":
        return [openOnly];
      case "mine":
        return [openOnly, { kind: "filter", column: "owner_id", op: "eq", value: ctx.userId }];
      case "all":
        return [];
      default:
        return [{ kind: "filter", column: "status", op: "eq", value: tab }];
    }
  },
  chipOps: (chip, ctx: ListContext) => {
    switch (chip) {
      case "hot":
        return [{ kind: "filter", column: "temperature", op: "eq", value: "hot" }];
      case "unassigned":
        return [{ kind: "filter", column: "owner_id", op: "is", value: "null" }];
      case "stale":
        return [
          openOnly,
          {
            kind: "filter",
            column: "last_activity_at",
            op: "lt",
            value: daysAgo(STALE_AFTER_DAYS, ctx.now),
          },
        ];
      case "last_7_days":
        return [{ kind: "filter", column: "created_at", op: "gte", value: daysAgo(7, ctx.now) }];
      case "website":
        return [{ kind: "filter", column: "lead_source", op: "eq", value: "website" }];
      case "google":
        return [sourceOr(GOOGLE, GOOGLE)];
      case "facebook":
        return [sourceOr(["facebook_instagram"], ["facebook_instagram"])];
      case "nextdoor":
        return [sourceOr(["nextdoor"], ["nextdoor"])];
      case "referral":
        return [sourceOr(["customer_referral", "partner_vendor_referral"], ["referral_link"])];
      case "past_customer":
        return [{ kind: "filter", column: "lead_source", op: "eq", value: "past_customer" }];
      default:
        return [];
    }
  },
};
