"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { isoDate } from "@/lib/validation/production";

/**
 * Resources (SPEC §8.6, §5.4): crews, members, skills, time off and company
 * blackout dates. Person's own session; row security needs crews:manage
 * (time off also schedule:manage). Audit and events from triggers; crew
 * changes refresh the "on the job" lists of their jobs in the database.
 */

const id = z.uuid();
const PATH = "/schedule/resources";
const done = () => {
  revalidatePath("/schedule", "layout");
  return { ok: true };
};
const missing = () => new ActionFailure(actionError("not_found", "That crew isn't available."));

export const saveCrew = defineAction({
  name: "resources.crew.save",
  schema: z
    .object({
      id: id.optional(),
      name: z.string().trim().min(1, "Name the crew.").max(80),
      crewType: z.enum(["employee", "subcontractor"]),
      subcontractorId: id.nullable(),
      leadUserId: id.nullable(),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .nullable(),
      homeTerritoryId: id.nullable(),
      maxJobsPerDay: z.coerce.number().int().min(1).max(5),
      dailyCapacityHours: z.coerce.number().min(1).max(24),
      active: z.boolean(),
    })
    .refine((v) => v.crewType === "employee" || v.subcontractorId, {
      message: "Pick the subcontractor this crew belongs to.",
      path: ["subcontractorId"],
    }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase, viewer }) => {
    const row = {
      name: v.name,
      crew_type: v.crewType,
      subcontractor_id: v.crewType === "subcontractor" ? v.subcontractorId : null,
      lead_user_id: v.leadUserId,
      color: v.color,
      home_territory_id: v.homeTerritoryId,
      max_jobs_per_day: v.maxJobsPerDay,
      daily_capacity_hours: v.dailyCapacityHours,
      active: v.active,
    };
    if (v.id) {
      const rows = check(await supabase.from("crews").update(row).eq("id", v.id).select("id"));
      if (!rows?.length) throw missing();
    } else {
      const { error } = await supabase.from("crews").insert({ ...row, org_id: viewer.orgId });
      if (error?.code === "23505")
        throw new ActionFailure(actionError("conflict", "There's already a crew with that name."));
      check({ data: null, error });
    }
    revalidatePath(PATH);
    return done();
  },
});

export const addCrewMember = defineAction({
  name: "resources.member.add",
  schema: z
    .object({
      crewId: id,
      userId: id.optional(),
      displayName: z.string().trim().max(120).optional(),
      role: z.enum(["lead", "painter", "helper"]),
    })
    .refine((v) => v.userId || v.displayName, {
      message: "Pick a teammate or type a name.",
      path: ["userId"],
    }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase, viewer }) => {
    const { error } = await supabase.from("crew_members").insert({
      org_id: viewer.orgId,
      crew_id: v.crewId,
      user_id: v.userId ?? null,
      display_name: v.userId ? null : (v.displayName ?? null),
      role: v.role,
    });
    if (error?.code === "23505")
      throw new ActionFailure(actionError("conflict", "They're already on this crew."));
    check({ data: null, error });
    return done();
  },
});

export const removeCrewMember = defineAction({
  name: "resources.member.remove",
  schema: z.object({ memberId: id }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase }) => {
    check(await supabase.from("crew_members").delete().eq("id", v.memberId));
    return done();
  },
});

export const setCrewSkill = defineAction({
  name: "resources.skill.set",
  schema: z.object({
    crewId: id,
    skillId: id,
    has: z.boolean(),
    expiresOn: isoDate.nullable().optional(),
  }),
  permissions: ["crews:manage"],
  handler: async (v, { supabase, viewer }) => {
    if (!v.has) {
      check(
        await supabase
          .from("crew_skills")
          .delete()
          .eq("crew_id", v.crewId)
          .eq("skill_id", v.skillId),
      );
      return done();
    }
    check(
      await supabase
        .from("crew_skills")
        .upsert(
          {
            org_id: viewer.orgId,
            crew_id: v.crewId,
            skill_id: v.skillId,
            expires_on: v.expiresOn ?? null,
          },
          { onConflict: "crew_id,skill_id" },
        ),
    );
    return done();
  },
});

export const addTimeOff = defineAction({
  name: "resources.time_off.add",
  schema: z
    .object({
      kind: z.enum(["time_off", "blackout"]),
      crewId: id.optional(),
      userId: id.optional(),
      startsOn: isoDate,
      endsOn: isoDate,
      reason: z.string().trim().max(300).optional(),
    })
    .refine((v) => v.endsOn >= v.startsOn, {
      message: "The last day is before the first.",
      path: ["endsOn"],
    })
    .refine((v) => v.kind === "blackout" || v.crewId || v.userId, {
      message: "Pick a crew or a person.",
      path: ["crewId"],
    }),
  permissions: [],
  handler: async (v, { supabase, viewer }) => {
    if (!viewer.can("crews:manage") && !viewer.can("schedule:manage")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't add time off."));
    }
    check(
      await supabase.from("crew_availability").insert({
        org_id: viewer.orgId,
        kind: v.kind,
        crew_id: v.kind === "blackout" ? null : (v.crewId ?? null),
        user_id: v.kind === "blackout" ? null : (v.userId ?? null),
        starts_on: v.startsOn,
        ends_on: v.endsOn,
        reason: v.reason || null,
      }),
    );
    return done();
  },
});

export const removeTimeOff = defineAction({
  name: "resources.time_off.remove",
  schema: z.object({ id }),
  permissions: [],
  handler: async (v, { supabase, viewer }) => {
    if (!viewer.can("crews:manage") && !viewer.can("schedule:manage")) {
      throw new ActionFailure(actionError("forbidden", "Your role can't change time off."));
    }
    // The row stops being visible once deleted, so don't ask for it back.
    check(
      await supabase
        .from("crew_availability")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", v.id),
    );
    return done();
  },
});
