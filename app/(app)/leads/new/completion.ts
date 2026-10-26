/**
 * New Lead wizard "Completion %" meter (SPEC §8.4): the share of useful fields
 * filled in. Pure so it can be unit-tested and shared by the client and tests.
 * Optional extras that don't apply to every lead (company, unit, sub-source)
 * are left out so a complete residential lead can reach 100%.
 */

export type CompletionInput = {
  first_name?: string | null;
  last_name?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  year_built?: string | number | null;
  home_built?: string | null;
  property_type?: string | null;
  stories?: string | number | null;
  siding_type?: string | null;
  has_hoa?: boolean | null;
  services?: readonly string[] | null;
  timeline?: string | null;
  lead_source?: string | null;
  customer_notes?: string | null;
  photoCount?: number;
};

export type Completion = {
  /** 0–100, rounded. */
  percent: number;
  filled: number;
  total: number;
  /** Plain-language names of the fields still empty, in form order. */
  missing: string[];
};

const has = (v: string | number | null | undefined): boolean =>
  v !== null && v !== undefined && String(v).trim() !== "";

const CHECKS: readonly { label: string; filled: (v: CompletionInput) => boolean }[] = [
  { label: "First name", filled: (v) => has(v.first_name) },
  { label: "Last name", filled: (v) => has(v.last_name) },
  { label: "Phone number", filled: (v) => has(v.mobile) || has(v.phone) },
  { label: "Email", filled: (v) => has(v.email) },
  { label: "Street", filled: (v) => has(v.street) },
  { label: "City", filled: (v) => has(v.city) },
  { label: "ZIP", filled: (v) => has(v.zip) },
  { label: "When the home was built", filled: (v) => has(v.year_built) || has(v.home_built) },
  { label: "Property type", filled: (v) => has(v.property_type) },
  { label: "Stories", filled: (v) => has(v.stories) },
  { label: "Siding type", filled: (v) => has(v.siding_type) },
  { label: "HOA", filled: (v) => v.has_hoa === true || v.has_hoa === false },
  { label: "Services", filled: (v) => (v.services?.length ?? 0) > 0 },
  { label: "Timeline", filled: (v) => has(v.timeline) },
  { label: "Source", filled: (v) => has(v.lead_source) },
  { label: "Notes", filled: (v) => has(v.customer_notes) },
  { label: "Photos", filled: (v) => (v.photoCount ?? 0) > 0 },
];

export function leadCompletion(input: CompletionInput): Completion {
  const missing: string[] = [];
  let filled = 0;
  for (const c of CHECKS) {
    if (c.filled(input)) filled++;
    else missing.push(c.label);
  }
  const total = CHECKS.length;
  return { percent: Math.round((filled / total) * 100), filled, total, missing };
}
