import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MessagingSettingsForm } from "@/components/templates/messaging-settings-form";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";

export const metadata: Metadata = { title: "Messaging settings" };

export default async function MessagingSettingsPage() {
  const viewer = await requirePermission("templates:manage");
  const supabase = await createSupabaseServerClient();
  const { data: s } = await supabase.from("messaging_settings").select("*").maybeSingle();
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/templates" className="flex w-fit items-center gap-1 text-sm text-bb-forest hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Messaging &amp; Templates
      </Link>
      <PageHeader
        title="Messaging settings"
        description="Quiet hours, marketing footers and the delays workflows use. Changes apply to the next message."
      />
      <MessagingSettingsForm
        readOnly={viewer.impersonating}
        initial={{
          quietHoursEnabled: s?.quiet_hours_enabled ?? true,
          quietHoursStart: (s?.quiet_hours_start ?? "20:00").slice(0, 5),
          quietHoursEnd: (s?.quiet_hours_end ?? "08:00").slice(0, 5),
          customerThreadHours: s?.customer_thread_hours ?? 24,
          smsOptOutText: s?.sms_opt_out_text ?? "Reply STOP to opt out.",
          emailFooter: s?.email_footer ?? "",
          reviewDelayDays: s?.review_delay_days ?? 2,
          referralInviteDelayDays: s?.referral_invite_delay_days ?? 14,
          caseSlaBusinessDays: s?.case_sla_business_days ?? 2,
        }}
      />
    </div>
  );
}
