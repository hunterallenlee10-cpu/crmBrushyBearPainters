"use client";

import * as React from "react";
import { Bell, CalendarDays, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type OwnProfileInput, type PreferencesValues } from "@/lib/validation/users";
import { OwnProfileForm } from "./own-profile-form";
import { PreferencesForm } from "./preferences-form";
import { SecurityPanel } from "./security-panel";
import { NotificationMatrix, type MatrixRow } from "@/components/notifications/notification-matrix";

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "security", label: "Security" },
  { value: "preferences", label: "Preferences" },
  { value: "notifications", label: "Notifications" },
  { value: "integrations", label: "Integrations" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function SettingsTabs({
  readOnly,
  email,
  department,
  roleName,
  profile,
  preferences,
  canExecutive = true,
  requiresMfa,
  notifications,
  hasPhone,
}: {
  readOnly: boolean;
  email: string;
  department: string | null;
  roleName: string;
  profile: OwnProfileInput;
  preferences: PreferencesValues;
  /** Executive Overview needs analytics:read; without it the option is off. */
  canExecutive?: boolean;
  requiresMfa: boolean;
  notifications: MatrixRow[];
  hasPhone: boolean;
}) {
  const [tab, setTab] = React.useState<Tab>("profile");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
      <TabsList
        aria-label="Settings sections"
        className="grid h-auto! w-full grid-cols-2 gap-1 sm:flex sm:w-fit sm:flex-wrap"
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
        <PreferencesForm defaults={preferences} readOnly={readOnly} canExecutive={canExecutive} />
      </TabsContent>
      <TabsContent value="notifications">
        <section aria-labelledby="notif-title" className="flex flex-col gap-3">
          <div>
            <h2 id="notif-title" className="flex items-center gap-2 text-base font-semibold">
              <Bell className="size-4" aria-hidden /> Notifications
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose, per event, how you hear about it. Some in-app alerts are required by your
              company. While email and texting aren&apos;t connected, those copies are recorded as
              “Simulated – not sent”.
            </p>
          </div>
          <NotificationMatrix
            rows={notifications}
            readOnly={readOnly}
            note={
              hasPhone
                ? null
                : "Texts need a mobile number on your Profile (in +1 format, e.g. +14255550100)."
            }
          />
        </section>
      </TabsContent>
      <TabsContent value="integrations">
        <section aria-labelledby="personal-int" className="flex flex-col gap-3">
          <h2 id="personal-int" className="text-base font-semibold">
            Your connections
          </h2>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5">
            <CalendarDays className="size-6 text-bb-forest" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Personal calendar</p>
              <p className="text-sm text-muted-foreground">
                Puts your walkthroughs and visits on your own Google or Outlook calendar. The
                company&apos;s calendar integration isn&apos;t connected yet, so nothing is synced;
                an owner connects it in Admin → Integrations.
              </p>
            </div>
            <Badge variant="neutral">Not connected</Badge>
            <Button variant="outline" disabled aria-disabled>
              Connect
            </Button>
          </div>
        </section>
      </TabsContent>
    </Tabs>
  );
}
