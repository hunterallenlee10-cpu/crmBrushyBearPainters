import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { readPreferences, type OwnProfileInput } from "@/lib/validation/users";
import { SettingsTabs } from "./settings-tabs";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const supabase = await createSupabaseServerClient();
  const { data: me } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, phone, title, department, signature, calendar_color, preferences",
    )
    .eq("id", viewer.id)
    .maybeSingle();
  if (!me) notFound();

  const profile: OwnProfileInput = {
    full_name: me.full_name,
    phone: me.phone ?? "",
    title: me.title ?? "",
    calendar_color: me.calendar_color ?? "",
    signature: me.signature ?? "",
  };

  return (
    <PageContainer className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Your profile, sign-in security and preferences. Changes apply only to you."
      />
      <SettingsTabs
        readOnly={viewer.impersonating}
        email={me.email}
        department={me.department}
        roleName={viewer.role.name}
        profile={profile}
        preferences={readPreferences(me.preferences)}
        requiresMfa={viewer.real.role.requiresMfa}
      />
    </PageContainer>
  );
}
