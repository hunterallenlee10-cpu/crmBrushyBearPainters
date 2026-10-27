"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useParamNavigation } from "./use-param-navigation";

/** Header actions: Refresh (re-runs the server query) and the "Only mine" toggle (URL param). */
export function AttentionToolbar({
  mine,
  mineParam = "mine",
}: {
  mine: boolean;
  mineParam?: string;
}) {
  const router = useRouter();
  const { setParams, pending: navigating } = useParamNavigation();
  const [refreshing, startRefresh] = React.useTransition();
  const id = React.useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex h-11 items-center gap-2 rounded-md border bg-card px-3 sm:h-9">
        <Switch
          id={`${id}-mine`}
          checked={mine}
          disabled={navigating}
          onCheckedChange={(on) => setParams({ [mineParam]: on ? "1" : null })}
        />
        <Label htmlFor={`${id}-mine`} className="cursor-pointer">
          Only mine
        </Label>
      </div>
      <Button
        variant="outline"
        className="h-11 sm:h-9"
        onClick={() => startRefresh(() => router.refresh())}
        disabled={refreshing}
      >
        {refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        Refresh
      </Button>
    </div>
  );
}
