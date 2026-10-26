"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { serverEnv } from "@/lib/env";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { logError } from "@/lib/log";
import {
  changeRoleSchema,
  invitationEmail,
  inviteUserSchema,
  laborCostSchema,
  overrideSchema,
  parseOpenWorkCounts,
  removeOverrideSchema,
  setActiveSchema,
  userIdSchema,
  userProfileSchema,
} from "@/lib/validation/users";

/**
 * Admin → Users (SPEC §4, §8.19). Mutations run through the user-scoped client
 * so RLS and the profiles guard decide; the service role is used only for
 * Supabase Auth admin calls and the invite's profile insert (no insert policy by
 * design). Audit rows and `user.*` events come from database triggers.
 */

/** "Forever" for Supabase Auth bans (100 years). */
const BAN_FOREVER = "876000h";

function refresh(userId?: string) {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export const inviteUser = defineAction({
  name: "users.invite",
  schema: inviteUserSchema,
  permissions: ["users:manage"],
  handler: async (v, { supabase, viewer, service }) => {
    const template = check(
      await supabase
        .from("role_templates")
        .select("id, name, grants_all")
        .eq("id", v.role_template_id)
        .maybeSingle(),
    );
    if (!template) {
      throw new ActionFailure(
        actionError("validation", "That role no longer exists.", {
          role_template_id: ["Pick a role."],
        }),
      );
    }
    if (template.grants_all && !viewer.isOwner) {
      throw new ActionFailure(
        actionError("forbidden", "Only an owner can invite someone as an Owner.", {
          role_template_id: ["Only an owner can choose Owner."],
        }),
      );
    }

    const existing = check(
      await supabase.from("profiles").select("id, is_active").eq("email", v.email).maybeSingle(),
    );
    if (existing) {
      const message = existing.is_active
        ? "Someone with that email is already a user."
        : "That email belongs to a deactivated user. Reactivate them instead.";
      throw new ActionFailure(actionError("conflict", message, { email: [message] }));
    }

    const admin = await service();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: v.email,
      email_confirm: true,
    });
    if (createError || !created.user) {
      if (createError && /already|exists|registered/i.test(createError.message)) {
        const message = "That email already has a sign-in. Ask an owner to check the user list.";
        throw new ActionFailure(actionError("conflict", message, { email: [message] }));
      }
      throw createError ?? new Error("createUser returned no user");
    }
    const userId = created.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id: userId,
      org_id: viewer.orgId,
      email: v.email,
      full_name: v.full_name,
      role_template_id: template.id,
      title: v.title,
      department: v.department,
      invited_at: new Date().toISOString(),
      invited_by: viewer.id,
    });
    if (profileError) {
      // Never leave a sign-in without a profile.
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) logError("users.invite:cleanup", cleanupError);
      throw new ActionFailure(mapDbError(profileError));
    }

    // Simulated invitation (never sent in this build — SPEC §2.1).
    let emailRecorded = true;
    try {
      const env = serverEnv();
      const email = invitationEmail({
        inviterName: viewer.real.fullName,
        appUrl: env.APP_URL,
        email: v.email,
      });
      await getEmailProvider(
        { orgId: viewer.orgId, actorId: viewer.id, sink: createSupabaseOutboxSink(admin) },
        { envProvider: env.INTEGRATION_EMAIL_PROVIDER },
      ).send({
        to: v.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        related: { type: "user", id: userId },
        messageType: "transactional",
      });
    } catch (error) {
      emailRecorded = false;
      logError("users.invite:email", error);
    }

    refresh();
    return { id: userId, emailRecorded };
  },
});

export const updateUserProfile = defineAction({
  name: "users.update_profile",
  schema: userProfileSchema,
  permissions: ["users:manage"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("profiles")
        .update({
          full_name: v.full_name,
          phone: v.phone,
          title: v.title,
          department: v.department,
          default_territory_id: v.default_territory_id,
          calendar_color: v.calendar_color,
          signature: v.signature,
        })
        .eq("id", v.user_id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    refresh(v.user_id);
    return { saved: true };
  },
});

export const changeUserRole = defineAction({
  name: "users.change_role",
  schema: changeRoleSchema,
  permissions: ["users:manage"],
  handler: async (v, { supabase }) => {
    // The profiles guard blocks non-owners from assigning Owner; the deferred
    // "at least one active owner" check fails at commit and comes back here.
    const rows = check(
      await supabase
        .from("profiles")
        .update({ role_template_id: v.role_template_id })
        .eq("id", v.user_id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));
    refresh(v.user_id);
    return { saved: true };
  },
});

export const saveLaborCost = defineAction({
  name: "users.save_labor_cost",
  schema: laborCostSchema,
  permissions: ["hr:manage"],
  handler: async (v, { supabase, viewer }) => {
    check(
      await supabase
        .from("profile_compensation")
        .upsert(
          { profile_id: v.user_id, org_id: viewer.orgId, hourly_cost_cents: v.hourly_cost },
          { onConflict: "profile_id" },
        )
        .select("profile_id"),
    );
    refresh(v.user_id);
    return { saved: true };
  },
});

export const getOpenWork = defineAction({
  name: "users.open_work",
  schema: userIdSchema,
  permissions: ["users:manage"],
  handler: async (v, { supabase }) => {
    const raw = check(await supabase.rpc("open_work_counts", { p_user_id: v.user_id }));
    return { items: parseOpenWorkCounts(raw) };
  },
});

export const setUserActive = defineAction({
  name: "users.set_active",
  schema: setActiveSchema,
  permissions: ["users:manage"],
  handler: async (v, { supabase, viewer, service }) => {
    if (v.user_id === viewer.id && !v.active) {
      throw new ActionFailure(actionError("forbidden", "You cannot deactivate yourself."));
    }
    const rows = check(
      await supabase
        .from("profiles")
        .update({ is_active: v.active })
        .eq("id", v.user_id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("forbidden"));

    const admin = await service();
    const { error: banError } = await admin.auth.admin.updateUserById(v.user_id, {
      ban_duration: v.active ? "none" : BAN_FOREVER,
    });
    if (banError) {
      // Keep the profile and the sign-in in step: undo the status change.
      await supabase.from("profiles").update({ is_active: !v.active }).eq("id", v.user_id);
      logError("users.set_active:ban", banError);
      throw new ActionFailure(
        actionError("server", "Couldn't update their sign-in. Nothing was changed; try again."),
      );
    }
    refresh(v.user_id);
    return { active: v.active };
  },
});

export const addPermissionOverride = defineAction({
  name: "users.add_override",
  schema: overrideSchema,
  permissions: ["roles:manage"],
  handler: async (v, { supabase, viewer }) => {
    const { error } = await supabase.from("user_permission_overrides").insert({
      org_id: viewer.orgId,
      user_id: v.user_id,
      permission: v.permission,
      effect: v.effect,
      scope: v.scope,
      reason: v.reason,
    });
    if (error?.code === "23505") {
      const message = "This person already has an override for that permission. Remove it first.";
      throw new ActionFailure(actionError("conflict", message, { permission: [message] }));
    }
    if (error) throw new ActionFailure(mapDbError(error));
    refresh(v.user_id);
    return { saved: true };
  },
});

export const removePermissionOverride = defineAction({
  name: "users.remove_override",
  schema: removeOverrideSchema,
  permissions: ["roles:manage"],
  handler: async (v, { supabase }) => {
    const rows = check(
      await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("id", v.override_id)
        .eq("user_id", v.user_id)
        .select("id"),
    );
    if (!rows?.length) throw new ActionFailure(actionError("not_found"));
    refresh(v.user_id);
    return { removed: true };
  },
});
