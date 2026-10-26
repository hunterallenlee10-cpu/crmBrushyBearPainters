"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { companySettingsSchema, fromFormHours } from "@/lib/validation/company-settings";

/** Saves Company Settings. Audit row + `settings.updated` event come from DB triggers. */
export const saveCompanySettings = defineAction({
  name: "company_settings.save",
  schema: companySettingsSchema,
  permissions: ["settings:manage"],
  handler: async (v, { supabase, viewer }) => {
    const rows = check(
      await supabase
        .from("company_settings")
        .update({
          company_name: v.company_name,
          tagline: v.tagline,
          website_url: v.website_url,
          service_area_note: v.service_area_note,
          phone: v.phone,
          email: v.email,
          hours_text: v.hours_text,
          lni_number: v.lni_number,
          ubi_number: v.ubi_number,
          rrp_firm_certification: v.rrp_firm_certification,
          rrp_firm_cert_expires_on: v.rrp_firm_cert_expires_on,
          business_hours: fromFormHours(v.business_hours),
          text_back_sla_minutes: v.text_back_sla_minutes,
          estimate_sla_hours: v.estimate_sla_hours,
          estimate_sla_warn_hours: v.estimate_sla_warn_hours,
          on_time_guarantee_cents: v.on_time_guarantee,
          exterior_season_start: v.exterior_season_start,
          exterior_season_end: v.exterior_season_end,
          deposit_percent: v.deposit_percent,
          estimate_expiry_days: v.estimate_expiry_days,
          auto_convert_on_walkthrough: v.auto_convert_on_walkthrough,
          review_link: v.review_link,
          referral_reward_cents: v.referral_reward,
        })
        .eq("org_id", viewer.orgId)
        .select("org_id"),
    );
    if (!rows || rows.length === 0) {
      throw new ActionFailure({
        code: "forbidden",
        message: "You don't have permission to change company settings.",
      });
    }
    revalidatePath("/admin/company");
    return { saved: true };
  },
});
