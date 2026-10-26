"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROLES_TABS, type RolesTab } from "../model";

/** Tabs kept in the URL (`?tab=`) so a tab can be linked and survives reloads. */
export function RolesTabs({ initial, children }: { initial: RolesTab; children: React.ReactNode }) {
  const [value, setValue] = React.useState<string>(initial);
  React.useEffect(() => setValue(initial), [initial]);

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(next);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", next);
        url.searchParams.delete("page");
        window.history.replaceState(null, "", url);
      }}
      className="gap-5"
    >
      <TabsList className="w-full sm:w-fit">
        {ROLES_TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="px-3">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
