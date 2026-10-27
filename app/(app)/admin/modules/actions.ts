"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, checkOne } from "@/lib/actions/errors";
import { LAYOUT_SECTIONS, ruleSettingsError } from "@/lib/domain/custom-fields";
import {
  customFieldSchema,
  idSchema,
  layoutSchema,
  reorderFieldsSchema,
  validationRuleSchema,
} from "@/lib/validation/module-manager";

/**
 * Admin → Module Manager (SPEC §8.19): custom fields, page layouts and
 * validation rules per module. settings:manage; row security and the
 * database guards check again; audit rows and custom_field.* /
 * validation_rule.* / module_layout.* events come from triggers.
 */

function done(module: string) {
  revalidatePath("/admin/modules");
  revalidatePath(`/${module}`, "layout");
}

export const saveCustomField = defineAction({
  name: "modules.save_field",
  schema: customFieldSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const row = {
      label: v.label,
      options: ["picklist", "multi_picklist"].includes(v.field_type) ? v.options : [],
      required: v.required,
      help_text: v.help_text,
      show_in_list: v.show_in_list,
      active: v.active,
    };
    if (v.id) {
      const rows = check(
        await supabase.from("custom_field_definitions").update(row).eq("id", v.id).select("id"),
      );
      if (!rows?.length)
        throw new ActionFailure(actionError("not_found", "That field no longer exists."));
      done(v.module);
      return { id: v.id };
    }
    const { count } = await supabase
      .from("custom_field_definitions")
      .select("id", { count: "exact", head: true })
      .eq("module", v.module);
    if ((count ?? 0) >= 100) {
      throw new ActionFailure(
        actionError("validation", "A module can have up to 100 custom fields."),
      );
    }
    const created = checkOne(
      await supabase
        .from("custom_field_definitions")
        .insert({
          ...row,
          org_id: viewer.orgId,
          module: v.module,
          api_name: v.api_name,
          field_type: v.field_type,
          sort_order: (count ?? 0) * 10,
        })
        .select("id")
        .single(),
    );
    done(v.module);
    return { id: created.id };
  },
});

export const reorderCustomFields = defineAction({
  name: "modules.reorder_fields",
  schema: reorderFieldsSchema,
  permissions: ["settings:manage"],
  handler: async ({ module, ids }, { supabase }) => {
    for (const [i, id] of ids.entries()) {
      check(
        await supabase
          .from("custom_field_definitions")
          .update({ sort_order: i * 10 })
          .eq("id", id)
          .eq("module", module),
      );
    }
    done(module);
    return { count: ids.length };
  },
});

export const saveValidationRule = defineAction({
  name: "modules.save_rule",
  schema: validationRuleSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const { data: defs } = await supabase
      .from("custom_field_definitions")
      .select("api_name")
      .eq("module", v.module);
    const problem = ruleSettingsError(
      { module: v.module, field: v.field, type: v.rule_type, value: v.value, message: v.message },
      (defs ?? []).map((d) => d.api_name),
    );
    if (problem) throw new ActionFailure(actionError("validation", problem));
    const row = {
      field: v.field,
      rule_type: v.rule_type,
      value: v.rule_type === "required" ? null : v.value,
      message: v.message,
      active: v.active,
    };
    if (v.id) {
      check(await supabase.from("validation_rules").update(row).eq("id", v.id));
      done(v.module);
      return { id: v.id };
    }
    const created = checkOne(
      await supabase
        .from("validation_rules")
        .insert({ ...row, org_id: viewer.orgId, module: v.module })
        .select("id")
        .single(),
    );
    done(v.module);
    return { id: created.id };
  },
});

export const deleteValidationRule = defineAction({
  name: "modules.delete_rule",
  schema: idSchema,
  permissions: ["settings:manage"],
  handler: async ({ id }, { supabase }) => {
    const rows = check(
      await supabase.from("validation_rules").delete().eq("id", id).select("module"),
    );
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That rule no longer exists."));
    done(rows[0]!.module);
    return { id };
  },
});

export const saveLayout = defineAction({
  name: "modules.save_layout",
  schema: layoutSchema,
  permissions: ["settings:manage"],
  handler: async ({ module, sections }, { supabase, viewer }) => {
    const known = new Map(LAYOUT_SECTIONS[module].map((s) => [s.key, s]));
    const clean = sections
      .filter((s) => known.has(s.key))
      .map((s) => ({ key: s.key, visible: known.get(s.key)!.locked ? true : s.visible }));
    check(
      await supabase
        .from("module_layouts")
        .upsert({ org_id: viewer.orgId, module, sections: clean }, { onConflict: "org_id,module" }),
    );
    done(module);
    return { module };
  },
});
