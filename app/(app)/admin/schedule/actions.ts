"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { LOCKED_RULES, isWorkRuleKey } from "@/lib/domain/scheduling/rules";
import { policiesSchema, skillKey, skillSchema, workRuleSchema, workTypeSchema } from "./schema";

/**
 * Admin → Schedule Admin (SPEC §8.19): policies, work types, work rules and
 * skills. Writes go through the person's own session; row security allows
 * them only with settings:manage. Audit rows and events come from triggers.
 */

const PATH = "/admin/schedule";

function none(): never {
  throw new ActionFailure(actionError("forbidden", "Only owners can change Schedule Admin."));
}

export const savePolicies = defineAction({
  name: "schedule_admin.policies",
  schema: policiesSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const rows = check(
      await supabase
        .from("schedule_settings")
        .update({
          production_days: [...new Set(v.productionDays)].sort(),
          day_start: v.dayStart,
          arrival_window_minutes: v.arrivalWindowMinutes,
          crew_day_hours: v.crewDayHours,
          recommendations_require_approval: v.requireApproval,
          recommendations_auto_execute: v.autoExecute,
          undo_window_minutes: v.undoWindowMinutes,
        })
        .eq("org_id", viewer.orgId)
        .select("org_id"),
    );
    if (!rows?.length) none();
    revalidatePath(PATH);
    return { ok: true };
  },
});

export const saveWorkType = defineAction({
  name: "schedule_admin.work_type",
  schema: workTypeSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("work_types")
        .update({
          label: v.label,
          default_minutes: v.defaultMinutes,
          assigned_role: v.assignedRole,
          required_skill_key: v.requiredSkillKey,
          active: v.active,
        })
        .eq("key", v.key)
        .select("id"),
    );
    if (!rows?.length) none();
    revalidatePath(PATH);
    return { ok: true };
  },
});

export const saveWorkRule = defineAction({
  name: "schedule_admin.work_rule",
  schema: workRuleSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase }) => {
    if (!isWorkRuleKey(v.key)) throw new ActionFailure(actionError("not_found", "Unknown rule."));
    if (LOCKED_RULES.has(v.key) && !v.enabled) {
      throw new ActionFailure(
        actionError("validation", "Holds always stop scheduling, so this rule stays on."),
      );
    }
    const rows = check(
      await supabase
        .from("work_rules")
        .update({
          label: v.label,
          description: v.description || null,
          enabled: v.enabled,
          severity: v.severity,
          owner_override: v.ownerOverride,
          params: v.params,
        })
        .eq("key", v.key)
        .select("id"),
    );
    if (!rows?.length) none();
    revalidatePath(PATH);
    return { ok: true };
  },
});

export const saveSkill = defineAction({
  name: "schedule_admin.skill",
  schema: skillSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    if (v.id) {
      const rows = check(
        await supabase
          .from("skills")
          .update({
            label: v.label,
            description: v.description || null,
            is_certification: v.isCertification,
            active: v.active,
          })
          .eq("id", v.id)
          .select("id"),
      );
      if (!rows?.length) none();
    } else {
      const { error } = await supabase.from("skills").insert({
        org_id: viewer.orgId,
        key: skillKey(v.label),
        label: v.label,
        description: v.description || null,
        is_certification: v.isCertification,
        active: v.active,
        sort_order: 1000,
      });
      if (error?.code === "23505") {
        throw new ActionFailure(actionError("conflict", "There's already a skill with that name."));
      }
      if (error) check({ data: null, error });
    }
    revalidatePath(PATH);
    return { ok: true };
  },
});
