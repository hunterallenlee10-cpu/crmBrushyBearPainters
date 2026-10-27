"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { loadCustomFields, loadValidationRules } from "@/lib/custom-fields/server";
import {
  checkRules,
  mergeCustomValues,
  readCustomInputs,
  toCustomValues,
  type CustomFieldModule,
} from "@/lib/domain/custom-fields";
import type { Permission } from "@/lib/permissions";
import { customValuesSchema } from "@/lib/validation/module-manager";

const UPDATE_PERMISSION: Record<CustomFieldModule, Permission> = {
  leads: "leads:update",
  jobs: "jobs:update",
  accounts: "accounts:update",
  contacts: "contacts:update",
};

const PATHS: Record<CustomFieldModule, (id: string) => string> = {
  leads: (id) => `/leads/${id}`,
  jobs: (id) => `/jobs/${id}`,
  accounts: (id) => `/accounts/${id}`,
  contacts: (id) => `/contacts/${id}`,
};

/**
 * Saves a record's custom field values (the "More fields" card on lead, job,
 * account and contact pages). Checks the module's update permission, parses
 * and validates every value (required, type, rules) and stores only the
 * company's active fields; row security, the database check and the audit
 * log apply to the update.
 */
export const saveCustomValues = defineAction({
  name: "custom_fields.save_values",
  schema: customValuesSchema,
  permissions: null,
  handler: async ({ module, record_id, values }, { supabase, viewer }) => {
    if (!viewer.can(UPDATE_PERMISSION[module])) {
      throw new ActionFailure(actionError("forbidden", "You can't edit this record."));
    }
    const [defs, rules, current] = await Promise.all([
      loadCustomFields(supabase, module),
      loadValidationRules(supabase, module),
      supabase.from(module).select("id, custom_field_values").eq("id", record_id).maybeSingle(),
    ]);
    if (!current.data)
      throw new ActionFailure(actionError("not_found", "That record isn't available."));
    const { values: patch, errors } = readCustomInputs(defs, values);
    const merged = mergeCustomValues(toCustomValues(current.data.custom_field_values), patch);
    const ruleErrors = checkRules(
      rules.filter((r) => r.field.startsWith("cf:")),
      { custom_field_values: merged },
    );
    const fieldErrors: Record<string, string[]> = {};
    for (const [k, msg] of Object.entries(errors)) fieldErrors[k] = [msg];
    for (const [k, msg] of Object.entries(ruleErrors)) (fieldErrors[k.slice(3)] ??= []).push(msg);
    if (Object.keys(fieldErrors).length) {
      throw new ActionFailure(
        actionError("validation", Object.values(fieldErrors)[0]![0], fieldErrors),
      );
    }
    const rows = check(
      await supabase
        .from(module)
        .update({ custom_field_values: merged })
        .eq("id", record_id)
        .select("id"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("forbidden", "You can't edit this record."));
    revalidatePath(PATHS[module](record_id));
    return { id: record_id };
  },
});
