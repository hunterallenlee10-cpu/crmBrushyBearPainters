"use client";

import * as React from "react";
import { Bell, Eye } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type OwnProfileInput, type PreferencesValues } from "@/lib/validation/users";
import { OwnProfileForm } from "./own-profile-form";
import { PreferencesForm } from "./preferences-form";
import { SecurityPanel } from "./security-panel";

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "security", label: "Security" },
  { value: "preferences", label: "Preferences" },
  { value: "notifications", label: "Notifications" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function SettingsTabs({
  readOnly,
  email,
  department,
  roleName,
  profile,
  preferences,
  requiresMfa,
}: {
  readOnly: boolean;
  email: string;
  department: string | null;
  roleName: string;
  profile: OwnProfileInput;
  preferences: PreferencesValues;
  requiresMfa: boolean;
}) {
  const [tab, setTab] = React.useState<Tab>("profile");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
      <TabsList
        aria-label="Settings sections"
        className="grid h-auto! w-full grid-cols-2 gap-1 sm:flex sm:w-fit"
      >
        {TABS.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="min-h-11 px-3 text-foreground/85 sm:min-h-8"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {readOnly && (
        <p className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <Eye className="size-4" aria-hidden /> You&apos;re viewing as another user, so these
          settings are read-only.
        </p>
      )}

      <TabsContent value="profile">
        <OwnProfileForm
          defaults={profile}
          email={email}
          department={department}
          roleName={roleName}
          readOnly={readOnly}
        />
      </TabsContent>
      <TabsContent value="security">
        <SecurityPanel requiresMfa={requiresMfa} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="preferences">
        <PreferencesForm defaults={preferences} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="notifications">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bell className="size-4" aria-hidden /> Notifications
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Notification preferences arrive with notifications (Phase 3). You&apos;ll choose, per
            event, whether to get an in-app alert, an email or a text.
          </p>
        </section>
      </TabsContent>
    </Tabs>
  );
}
