"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { syncLabel } from "@/lib/offline/queue-core";
import { useOfflineSync } from "./offline-sync";

/**
 * "Offline ready · Last synced 4:51 PM" (SPEC §2, §8.5 header). Shows what's
 * waiting to upload when offline, for one job or the whole device.
 */
export function SyncIndicator({ jobId, className }: { jobId?: string; className?: string }) {
  const sync = useOfflineSync();
  if (!sync.ready) return null;
  const pending = sync.items.filter(
    (i) => i.state !== "failed" && (!jobId || i.jobId === jobId),
  ).length;
  const text = syncLabel(sync.lastSyncedAt, pending, sync.online);
  const Icon = !sync.online ? CloudOff : pending ? Loader2 : Cloud;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${sync.online ? "text-muted-foreground" : "font-medium text-warning"} ${className ?? ""}`}
      role="status"
      aria-live="polite"
      data-testid="sync-indicator"
    >
      <Icon className={`size-3.5 ${pending && sync.online ? "animate-spin" : ""}`} aria-hidden />
      {text}
    </span>
  );
}
