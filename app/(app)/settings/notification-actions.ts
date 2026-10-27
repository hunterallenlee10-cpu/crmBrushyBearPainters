"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check, mapDbError } from "@/lib/actions/errors";
import { companyNotificationsSchema, myNotificationsSchema } from "@/lib/validation/notifications";

/**
 * Notifications (SPEC §8.18 Settings → Notifications, §8.19 Admin →
 * Notification Settings). People change only their own choices; the company
 * defaults need settings:manage. A database trigger on `notifications` applies
 * them (email and text copies go to the outbox, simulated).
 */

export const saveMyNotifications = defineAction({
  name: "settings.notifications",
  schema: myNotificationsSchema,
  permissions: null,
  handler: async (v, { supabase, viewer }) => {
    const { error } = await supabase.from("notification_preferences").upsert(
      v.items.map((i) => ({
        org_id: viewer.orgId,
        user_id: viewer.id,
        type: i.type,
        in_app: i.inApp,
        email: i.email,
        sms: i.sms,
      })),
      { onConflict: "user_id,type" },
    );
    if (error) throw new ActionFailure(mapDbError(error));
    revalidatePath("/settings");
    return { saved: v.items.length };
  },
});

export const saveCompanyNotifications = defineAction({
  name: "admin.notifications",
  schema: companyNotificationsSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase }) => {
    for (const i of v.items) {
      check(
        await supabase
          .from("notification_settings")
          .update({ in_app: i.inApp || i.locked, email: i.email, sms: i.sms, locked: i.locked })
          .eq("type", i.type)
          .select("type"),
      );
    }
    revalidatePath("/admin/notifications");
    revalidatePath("/settings");
    return { saved: v.items.length };
  },
});
