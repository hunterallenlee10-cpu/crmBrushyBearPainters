import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toBusinessHours } from "@/lib/domain/company-settings";
import { centsToDollars } from "@/lib/validation/common";
import { toFormHours, type CompanySettingsInput } from "@/lib/validation/company-settings";
import { CompanySettingsForm } from "./company-settings-form";

export const metadata: Metadata = { title: "Company Settings" };

export default async function CompanySettingsPage() {
  await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const { data: s } = await supabase.from("company_settings").select("*").single();
  if (!s) notFound();

  const defaults: CompanySettingsInput = {
    company_name: s.company_name,
    tagline: s.tagline ?? "",
    website_url: s.website_url ?? "",
    service_area_note: s.service_area_note ?? "",
    phone: s.phone,
    email: s.email,
    hours_text: s.hours_text,
    lni_number: s.lni_number,
    ubi_number: s.ubi_number,
    rrp_firm_certification: s.rrp_firm_certification ?? "",
    rrp_firm_cert_expires_on: s.rrp_firm_cert_expires_on ?? "",
    business_hours: toFormHours(toBusinessHours(s.business_hours)),
    text_back_sla_minutes: s.text_back_sla_minutes,
    estimate_sla_hours: s.estimate_sla_hours,
    estimate_sla_warn_hours: s.estimate_sla_warn_hours,
    on_time_guarantee: centsToDollars(s.on_time_guarantee_cents),
    exterior_season_start: s.exterior_season_start,
    exterior_season_end: s.exterior_season_end,
    deposit_percent: Number(s.deposit_percent),
    estimate_expiry_days: s.estimate_expiry_days,
    auto_convert_on_walkthrough: s.auto_convert_on_walkthrough,
    review_link: s.review_link ?? "",
    referral_reward: centsToDollars(s.referral_reward_cents),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Company Settings"
        description="Used on proposals, contracts, invoices, customer messages and SLA timers. Changes save to the audit log."
      />
      <CompanySettingsForm
        defaults={defaults}
        taxConfigured={Object.keys(s.tax_config ?? {}).length > 0}
      />
    </div>
  );
}
