import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NotificationMatrix } from "@/components/notifications/notification-matrix";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCompanyRows } from "@/lib/notifications/settings";

export const metadata: Metadata = { title: "Notification Settings" };

/**
 * Admin → Notification Settings (SPEC §8.19): the company default per event
 * (in-app, email, text) and whether people may turn the in-app alert off.
 * People change their own in Settings → Notifications.
 */
export default async function NotificationSettingsPage() {
  const viewer = await requirePermission("settings:manage");
  const supabase = await createSupabaseServerClient();
  const rows = await loadCompanyRows(supabase);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notification Settings"
        description="Company defaults for each event. People can change their own in Settings → Notifications, except that a Required in-app alert stays on. Email and text copies are recorded as “Simulated – not sent” until those channels are connected."
      />
      <NotificationMatrix rows={rows} company readOnly={viewer.impersonating} />
    </div>
  );
}
