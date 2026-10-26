import "server-only";
import type { Database } from "@/lib/db/types";
import type { ActionContext } from "@/lib/actions/define-action";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/log";
import {
  consentPatch,
  type ConsentState,
  type ContactValues,
  type PropertyValues,
} from "@/lib/validation/accounts";

/**
 * Server helpers shared by the account and contact actions: map validated form
 * values to table columns, read the encryption key, and write timeline rows.
 */

type Tables = Database["public"]["Tables"];
type ContactColumns = Omit<Tables["contacts"]["Update"], "id" | "org_id" | "account_id">;
type PropertyColumns = Omit<Tables["properties"]["Update"], "id" | "org_id" | "account_id">;

export function contactColumns(
  c: ContactValues,
  prev: ConsentState | null,
  now: Date = new Date(),
): ContactColumns {
  return {
    first_name: c.first_name,
    last_name: c.last_name,
    role: c.role,
    mobile: c.mobile,
    phone: c.phone,
    email: c.email,
    preferred_channel: c.preferred_channel,
    language: c.language,
    notes: c.notes,
    ...consentPatch(c, prev, now),
  };
}

export function propertyColumns(p: PropertyValues): PropertyColumns {
  return {
    street: p.street,
    unit: p.unit,
    city: p.city,
    state: p.state,
    zip: p.zip,
    year_built: p.year_built,
    home_built: p.home_built,
    property_type: p.property_type,
    siding_type: p.siding_type,
    stories: p.stories,
    approx_sqft: p.approx_sqft,
    has_hoa: p.has_hoa,
    hoa_name: p.hoa_name,
    hoa_contact: p.hoa_contact,
    hoa_color_approval_required: p.hoa_color_approval_required,
    access_notes: p.access_notes,
    pets: p.pets,
    parking: p.parking,
    alarm: p.alarm,
    occupancy: p.occupancy,
    water_power_access: p.water_power_access,
  };
}

/** The gate-code key, or null when it isn't configured (never throws). */
export function fieldEncryptionKey(): string | null {
  try {
    return serverEnv().FIELD_ENCRYPTION_KEY ?? null;
  } catch {
    return null;
  }
}

export const MISSING_KEY_MESSAGE = "Gate codes can't be saved until FIELD_ENCRYPTION_KEY is set.";

/** One-line address for timelines and headings ("123 Main St, Kirkland"). */
export function shortAddress(p: {
  street: string | null;
  city: string | null;
  zip?: string | null;
}) {
  return [p.street, p.city].filter(Boolean).join(", ") || p.zip || "the property";
}

/**
 * Timeline entry on an account. Users can't write activity rows directly, so
 * this uses the service client after the action's own checks. Best effort: a
 * failed timeline write never undoes the change itself.
 */
export async function logAccountActivity(
  ctx: ActionContext,
  accountId: string,
  type: string,
  summary: string,
  payload: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    const svc = await ctx.service();
    const { error } = await svc.from("activity").insert({
      org_id: ctx.viewer.orgId,
      subject_type: "account",
      subject_id: accountId,
      type,
      summary,
      payload,
      actor_id: ctx.viewer.real.id,
    });
    if (error) throw error;
  } catch (error) {
    logError("accounts.activity", error);
  }
}
