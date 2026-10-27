import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  parseStoredLayout,
  resolveLayout,
  toCustomFieldDef,
  toValidationRule,
  type CustomFieldDef,
  type CustomFieldModule,
  type ResolvedSection,
  type ValidationRule,
} from "@/lib/domain/custom-fields";

type Db = SupabaseClient<Database>;

/** A module's custom field definitions (all, ordered); filter `active` for forms. */
export async function loadCustomFields(
  db: Db,
  module: CustomFieldModule,
): Promise<CustomFieldDef[]> {
  const { data } = await db
    .from("custom_field_definitions")
    .select(
      "id, module, api_name, label, field_type, options, required, help_text, show_in_list, sort_order, active",
    )
    .eq("module", module)
    .order("sort_order")
    .order("label");
  return (data ?? []).flatMap((r) => toCustomFieldDef(r) ?? []);
}

export async function loadValidationRules(
  db: Db,
  module: CustomFieldModule,
): Promise<ValidationRule[]> {
  const { data } = await db
    .from("validation_rules")
    .select("id, module, field, rule_type, value, message, active")
    .eq("module", module)
    .order("sort_order")
    .order("created_at");
  return (data ?? []).flatMap((r) => toValidationRule(r) ?? []);
}

/** The module's detail-page sections in the company's order, with visibility. */
export async function loadLayout(db: Db, module: CustomFieldModule): Promise<ResolvedSection[]> {
  const { data } = await db
    .from("module_layouts")
    .select("sections")
    .eq("module", module)
    .maybeSingle();
  return resolveLayout(module, parseStoredLayout(data?.sections));
}
