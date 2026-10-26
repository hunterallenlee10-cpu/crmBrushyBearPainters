import { formatPhone } from "@/lib/domain/leads/normalize";
import type { AccountInput, ContactInput, PropertyInput } from "@/lib/validation/accounts";

/**
 * Form defaults: empty values for new records, and DB rows → form values for
 * edits. Plain data only (rows come from server components as props).
 */

export type AccountRowForForm = {
  display_name: string;
  account_type: string;
  status: string;
  owner_id: string | null;
  is_referral_champion: boolean;
  tags: string[];
  notes: string | null;
};

export type ContactRowForForm = {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  preferred_channel: string | null;
  language: string;
  sms_opt_in: boolean;
  sms_opt_in_at: string | null;
  sms_opt_in_source: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
  email_opt_in_source: string | null;
  opted_out_at: string | null;
  do_not_contact: boolean;
  notes: string | null;
};

export type PropertyRowForForm = {
  id: string;
  is_primary: boolean;
  street: string | null;
  unit: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  year_built: number | null;
  home_built: string | null;
  property_type: string | null;
  siding_type: string | null;
  stories: number | null;
  approx_sqft: number | null;
  has_hoa: boolean;
  hoa_name: string | null;
  hoa_contact: string | null;
  hoa_color_approval_required: boolean;
  access_notes: string | null;
  pets: string | null;
  parking: string | null;
  alarm: string | null;
  occupancy: string | null;
  water_power_access: string | null;
};

export function emptyAccount(ownerId: string | null): AccountInput {
  return {
    display_name: "",
    account_type: "residential",
    status: "prospect",
    owner_id: ownerId ?? "",
    is_referral_champion: false,
    tags: "",
    notes: "",
  };
}

export function emptyContact(role: ContactInput["role"] = "primary"): ContactInput {
  return {
    first_name: "",
    last_name: "",
    role,
    mobile: "",
    phone: "",
    email: "",
    preferred_channel: "",
    language: "en",
    sms_opt_in: false,
    sms_opt_in_source: "",
    email_opt_in: false,
    email_opt_in_source: "",
    do_not_contact: false,
    notes: "",
  };
}

export function emptyProperty(isPrimary = false): PropertyInput {
  return {
    is_primary: isPrimary,
    street: "",
    unit: "",
    city: "",
    state: "WA",
    zip: "",
    year_built: "",
    home_built: "",
    property_type: "",
    siding_type: "",
    stories: "",
    approx_sqft: "",
    has_hoa: false,
    hoa_name: "",
    hoa_contact: "",
    hoa_color_approval_required: false,
    access_notes: "",
    pets: "",
    parking: "",
    alarm: "",
    occupancy: "",
    water_power_access: "",
  };
}

export function accountToInput(a: AccountRowForForm): AccountInput {
  return {
    display_name: a.display_name,
    account_type: a.account_type as AccountInput["account_type"],
    status: a.status as AccountInput["status"],
    owner_id: a.owner_id ?? "",
    is_referral_champion: a.is_referral_champion,
    tags: a.tags.join(", "),
    notes: a.notes ?? "",
  };
}

export function contactToInput(c: ContactRowForForm): ContactInput {
  return {
    first_name: c.first_name,
    last_name: c.last_name ?? "",
    role: c.role as ContactInput["role"],
    mobile: c.mobile ? formatPhone(c.mobile) : "",
    phone: c.phone ? formatPhone(c.phone) : "",
    email: c.email ?? "",
    preferred_channel: (c.preferred_channel ?? "") as ContactInput["preferred_channel"],
    language: c.language,
    sms_opt_in: c.sms_opt_in,
    sms_opt_in_source: c.sms_opt_in_source ?? "",
    email_opt_in: c.email_opt_in,
    email_opt_in_source: c.email_opt_in_source ?? "",
    do_not_contact: c.do_not_contact,
    notes: c.notes ?? "",
  };
}

const STORIES = { 1: "1", 2: "2", 3: "3" } as const;

export function propertyToInput(p: PropertyRowForForm): PropertyInput {
  return {
    is_primary: p.is_primary,
    street: p.street ?? "",
    unit: p.unit ?? "",
    city: p.city ?? "",
    state: p.state,
    zip: p.zip ?? "",
    year_built: p.year_built === null ? "" : String(p.year_built),
    home_built: (p.home_built ?? "") as PropertyInput["home_built"],
    property_type: p.property_type ?? "",
    siding_type: p.siding_type ?? "",
    stories: p.stories === 1 || p.stories === 2 || p.stories === 3 ? STORIES[p.stories] : "",
    approx_sqft: p.approx_sqft === null ? "" : String(p.approx_sqft),
    has_hoa: p.has_hoa,
    hoa_name: p.hoa_name ?? "",
    hoa_contact: p.hoa_contact ?? "",
    hoa_color_approval_required: p.hoa_color_approval_required,
    access_notes: p.access_notes ?? "",
    pets: p.pets ?? "",
    parking: p.parking ?? "",
    alarm: p.alarm ?? "",
    occupancy: (p.occupancy ?? "") as PropertyInput["occupancy"],
    water_power_access: p.water_power_access ?? "",
  };
}
