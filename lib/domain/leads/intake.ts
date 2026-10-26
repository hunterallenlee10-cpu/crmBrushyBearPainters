import type { HomeBuilt, Service, Timeline } from "@/lib/domain/leads/constants";

/**
 * Mapping the website's /estimate form to CRM fields (SPEC §14). The form sends
 * the labels people click; this turns them into stored keys and infers the
 * sub-source, city and intent from UTM tags, the referrer and the page path.
 */

const SERVICE_ALIASES: Record<string, Service> = {
  interior: "interior",
  "interior painting": "interior",
  exterior: "exterior",
  "exterior painting": "exterior",
  cabinets: "cabinets",
  "cabinet painting": "cabinets",
  "cabinet refinishing": "cabinets",
  "deck or fence": "deck_fence",
  "deck & fence": "deck_fence",
  "deck and fence": "deck_fence",
  deck_fence: "deck_fence",
  deck: "deck_fence",
  fence: "deck_fence",
  "something else": "other",
  other: "other",
};

export function mapServices(values: readonly string[] | null | undefined): Service[] {
  const out = new Set<Service>();
  for (const v of values ?? []) {
    const key = SERVICE_ALIASES[v.trim().toLowerCase()];
    if (key) out.add(key);
  }
  return [...out];
}

const TIMELINE_ALIASES: Record<string, Timeline> = {
  asap: "asap",
  "as soon as possible": "asap",
  "1_3_months": "1_3_months",
  "in 1–3 months": "1_3_months",
  "in 1-3 months": "1_3_months",
  "1-3 months": "1_3_months",
  "3_plus_months": "3_plus_months",
  "3+ months out": "3_plus_months",
  "3+ months": "3_plus_months",
  just_planning: "just_planning",
  "just planning": "just_planning",
};

export function mapTimeline(value: string | null | undefined): Timeline | null {
  if (!value) return null;
  return TIMELINE_ALIASES[value.trim().toLowerCase()] ?? null;
}

const HOME_BUILT_ALIASES: Record<string, HomeBuilt> = {
  before_1978: "before_1978",
  "before 1978": "before_1978",
  "1978_or_later": "1978_or_later",
  "1978 or later": "1978_or_later",
  not_sure: "not_sure",
  "not sure": "not_sure",
};

export function mapHomeBuilt(value: string | null | undefined): HomeBuilt | null {
  if (!value) return null;
  return HOME_BUILT_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** Service pages tell us intent: /services/exterior-painting → exterior. */
export function serviceFromPagePath(path: string | null | undefined): Service | null {
  const m = /^\/services\/([a-z0-9-]+)/.exec((path ?? "").toLowerCase());
  if (!m) return null;
  const slug = m[1]!;
  if (slug.includes("interior")) return "interior";
  if (slug.includes("exterior")) return "exterior";
  if (slug.includes("cabinet")) return "cabinets";
  if (slug.includes("deck") || slug.includes("fence")) return "deck_fence";
  return null;
}

/** City pages tell us the city: /painters/kirkland-wa → "Kirkland". */
export function cityFromPagePath(path: string | null | undefined): string | null {
  const m = /^\/painters\/([a-z-]+?)(?:-wa)?\/?$/.exec((path ?? "").toLowerCase());
  if (!m) return null;
  return m[1]!
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export type Attribution = {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  referrer?: string | null;
  ref?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
};

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Website sub-source (SPEC §14 item 4): Organic, Google Ads, Google Business
 * Profile, Local Services Ads, Facebook/Instagram, Nextdoor, Yelp, Referral
 * link, Direct. Keys match the seeded `lead_sub_source` picklist.
 */
export function inferWebsiteSubSource(a: Attribution): string {
  const source = (a.utm_source ?? "").toLowerCase();
  const medium = (a.utm_medium ?? "").toLowerCase();
  const campaign = (a.utm_campaign ?? "").toLowerCase();
  const host = hostOf(a.referrer);

  if (a.ref) return "referral_link";
  if (source.includes("lsa") || campaign.includes("local_services") || campaign.includes("lsa")) {
    return "local_services_ads";
  }
  if (
    source === "gbp" ||
    source.includes("business_profile") ||
    source.includes("gmb") ||
    medium === "gbp"
  ) {
    return "google_business_profile";
  }
  if (
    a.gclid ||
    (source.includes("google") && ["cpc", "ppc", "paid", "paidsearch"].includes(medium))
  ) {
    return "google_ads";
  }
  if (
    a.fbclid ||
    ["facebook", "fb", "instagram", "ig", "meta"].some((s) => source.includes(s)) ||
    /(^|\.)(facebook|instagram)\.com$|^l\.facebook\.com$|^lm\.facebook\.com$/.test(host)
  ) {
    return "facebook_instagram";
  }
  if (source.includes("nextdoor") || host.endsWith("nextdoor.com")) return "nextdoor";
  if (source.includes("yelp") || host.endsWith("yelp.com")) return "yelp";
  if (
    /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)yahoo\.com$/.test(host)
  ) {
    return "organic";
  }
  if (source === "google" && (medium === "organic" || medium === "")) return "organic";
  return "direct";
}

/**
 * Lead source for a website submission: always Website, except referral links,
 * which carry the champion's code (Bear Champions, Phase 8).
 */
export function inferLeadSource(a: Attribution): { source: string; subSource: string } {
  const subSource = inferWebsiteSubSource(a);
  return { source: "website", subSource };
}
