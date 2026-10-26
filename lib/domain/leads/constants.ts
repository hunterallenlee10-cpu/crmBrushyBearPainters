/**
 * Fixed lead vocabularies (SPEC §5.2, §6.1). Admin-editable choices (sources,
 * dispositions…) live in Field Picklists instead.
 */

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "walkthrough_scheduled",
  "nurture",
  "unqualified",
  "converted",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  walkthrough_scheduled: "Walkthrough Scheduled",
  nurture: "Nurture",
  unqualified: "Unqualified",
  converted: "Converted",
  lost: "Lost",
};

/** Statuses that still need work (everything except the end states). */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "walkthrough_scheduled",
  "nurture",
];

export function isOpenStatus(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

/**
 * Statuses a person can pick by hand. "Converted" only comes from Convert to Job
 * (Phase 3), and "Walkthrough Scheduled" from booking a walkthrough.
 */
export const MANUAL_STATUS_CHOICES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "nurture",
  "unqualified",
  "lost",
];

export const SERVICES = ["interior", "exterior", "cabinets", "deck_fence", "other"] as const;
export type Service = (typeof SERVICES)[number];
export const SERVICE_LABELS: Record<Service, string> = {
  interior: "Interior",
  exterior: "Exterior",
  cabinets: "Cabinets",
  deck_fence: "Deck or fence",
  other: "Something else",
};

export const TIMELINES = ["asap", "1_3_months", "3_plus_months", "just_planning"] as const;
export type Timeline = (typeof TIMELINES)[number];
export const TIMELINE_LABELS: Record<Timeline, string> = {
  asap: "As soon as possible",
  "1_3_months": "In 1–3 months",
  "3_plus_months": "3+ months out",
  just_planning: "Just planning",
};

export const HOME_BUILT = ["before_1978", "1978_or_later", "not_sure"] as const;
export type HomeBuilt = (typeof HOME_BUILT)[number];
export const HOME_BUILT_LABELS: Record<HomeBuilt, string> = {
  before_1978: "Before 1978",
  "1978_or_later": "1978 or later",
  not_sure: "Not sure",
};

export const TEMPERATURE_LABELS = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;
export type Temperature = keyof typeof TEMPERATURE_LABELS;
export type Grade = "A" | "B" | "C" | "D" | "F";

/** Sources that count as referrals for scoring and chips (SPEC §6.6). */
export const REFERRAL_SOURCES: readonly string[] = [
  "customer_referral",
  "past_customer",
  "partner_vendor_referral",
  "realtor_property_manager",
];

/** Lead aging buckets for the dashboard (SPEC §8.4). */
export const AGING_BUCKETS = [
  { key: "0_3", label: "0–3 days" },
  { key: "4_7", label: "4–7 days" },
  { key: "8_14", label: "8–14 days" },
  { key: "15_30", label: "15–30 days" },
  { key: "30_plus", label: "30+ days" },
] as const;

/** A lead with no activity for this long is "stale" (SPEC §8.4 Needs Attention). */
export const STALE_AFTER_DAYS = 14;

/** Same phone or email within this window is treated as the same lead (SPEC §14). */
export const DEDUPE_WINDOW_DAYS = 180;
