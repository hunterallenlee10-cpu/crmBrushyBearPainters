import "server-only";
import { ActionFailure, actionError } from "@/lib/actions/errors";
import type { ActionContext } from "@/lib/actions/define-action";
import type { AccountChoice } from "./schema";

/** A customer's properties and contacts for the New Job form (row security applies). */
export async function loadAccountChoice(
  supabase: ActionContext["supabase"],
  id: string,
): Promise<AccountChoice | null> {
  const [account, properties, contacts] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, display_name, primary_contact_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("id, street, unit, city, is_primary")
      .eq("account_id", id)
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .order("created_at")
      .limit(100),
    supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .eq("account_id", id)
      .is("deleted_at", null)
      .order("created_at")
      .limit(100),
  ]);
  if (account.error) throw new ActionFailure(actionError("server"));
  if (!account.data) return null;
  const a = account.data;
  return {
    id: a.id,
    name: a.display_name,
    primaryContactId: a.primary_contact_id,
    properties: (properties.data ?? []).map((p) => ({
      id: p.id,
      label:
        [[p.street, p.unit].filter(Boolean).join(" "), p.city].filter(Boolean).join(", ") ||
        "Address not entered",
      city: p.city,
      isPrimary: p.is_primary,
    })),
    contacts: (contacts.data ?? []).map((c) => ({
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      firstName: c.first_name,
      lastName: c.last_name,
    })),
  };
}
