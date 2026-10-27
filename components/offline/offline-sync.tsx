"use client";

import * as React from "react";
import {
  OfflineQueue,
  outcomeForStatus,
  type QueueItem,
  type Uploader,
} from "@/lib/offline/queue-core";
import { createQueueStore } from "@/lib/offline/idb-store";

/**
 * Offline sync for the whole app (SPEC §2): registers the service worker,
 * keeps the IndexedDB upload queue, uploads when the connection comes back
 * (and every 30 s while anything waits), and tells pages when an item for
 * their job has synced. Uploaders: "photo" and "daily_log" (the log with its
 * cleanup photo; extra photos follow as "photo" items linked by the log id).
 */

const LAST_SYNCED_KEY = "bb:lastSynced";
const RETRY_EVERY_MS = 30_000;

/** Photo upload: the same route the online camera uses (idempotent by client id). */
export const uploadPhoto: Uploader = async (item) => {
  if (!item.blob) return { ok: false, retry: false, error: "The photo file is missing." };
  const form = new FormData();
  const name = typeof item.meta.fileName === "string" ? item.meta.fileName : "photo.jpg";
  form.set("file", item.blob, name);
  form.set("clientId", item.id);
  for (const k of [
    "category",
    "area",
    "caption",
    "checklistKey",
    "takenAt",
    "source",
    "dailyLogId",
    "workOrderId",
  ]) {
    const v = item.meta[k];
    if (typeof v === "string" && v) form.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(`/api/jobs/${item.jobId}/photos`, { method: "POST", body: form });
  } catch {
    return { ok: false, retry: true, error: "No connection." };
  }
  let message = "";
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    message = body?.error ?? "";
  }
  return outcomeForStatus(res.status, message);
};

/** Daily log (with its cleanup photo): idempotent by client id, which is the log's id. */
export const uploadDailyLog: Uploader = async (item) => {
  if (!item.blob) return { ok: false, retry: false, error: "The cleanup photo is missing." };
  const form = new FormData();
  form.set("cleanupPhoto", item.blob, "cleanup.jpg");
  form.set("clientId", item.id);
  form.set("cleanupDone", "true");
  for (const k of [
    "logDate",
    "workOrderId",
    "finishedToday",
    "nextUp",
    "issues",
    "weatherObserved",
    "hours",
    "source",
  ]) {
    const v = item.meta[k];
    if (typeof v === "string" && v) form.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(`/api/jobs/${item.jobId}/daily-logs`, { method: "POST", body: form });
  } catch {
    return { ok: false, retry: true, error: "No connection." };
  }
  let message = "";
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    message = body?.error ?? "";
  }
  return outcomeForStatus(res.status, message);
};

const UPLOADERS: Record<string, Uploader> = { photo: uploadPhoto, daily_log: uploadDailyLog };

type SyncState = {
  ready: boolean;
  online: boolean;
  items: QueueItem[];
  lastSyncedAt: number | null;
  /** True when the service worker controls this page (the app shell works offline). */
  offlineReady: boolean;
};

type Ctx = SyncState & {
  enqueue: (
    input: Omit<QueueItem, "createdAt" | "attempts" | "nextAttemptAt" | "state">,
  ) => Promise<void>;
  flush: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  /** Called with the job id whenever an item for that job finishes uploading. */
  onSynced: (listener: (jobIds: string[]) => void) => () => void;
};

const OfflineContext = React.createContext<Ctx | null>(null);

function readLastSynced(): number | null {
  try {
    const v = window.localStorage.getItem(LAST_SYNCED_KEY);
    return v ? Number(v) || null : null;
  } catch {
    return null;
  }
}

function writeLastSynced(at: number) {
  try {
    window.localStorage.setItem(LAST_SYNCED_KEY, String(at));
  } catch {
    // Private mode: the label just won't survive a reload.
  }
}

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const queueRef = React.useRef<OfflineQueue | null>(null);
  const listeners = React.useRef(new Set<(jobIds: string[]) => void>());
  const [state, setState] = React.useState<SyncState>({
    ready: false,
    online: true,
    items: [],
    lastSyncedAt: null,
    offlineReady: false,
  });

  const refresh = React.useCallback(async () => {
    const q = queueRef.current;
    if (!q) return;
    const items = await q.items();
    setState((s) => ({ ...s, items }));
  }, []);

  const flush = React.useCallback(async () => {
    const q = queueRef.current;
    if (!q || !navigator.onLine) return;
    const before = await q.items();
    const result = await q.flush();
    if (result.uploaded.length) {
      const at = Date.now();
      writeLastSynced(at);
      setState((s) => ({ ...s, lastSyncedAt: at }));
      const jobs = [
        ...new Set(before.filter((i) => result.uploaded.includes(i.id)).map((i) => i.jobId)),
      ];
      for (const l of listeners.current) l(jobs);
    } else if (result.waiting === 0 && before.length === 0) {
      const at = Date.now();
      writeLastSynced(at);
      setState((s) => ({ ...s, lastSyncedAt: at }));
    }
    await refresh();
  }, [refresh]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await createQueueStore();
      if (!alive) return;
      queueRef.current = new OfflineQueue(store, UPLOADERS);
      setState((s) => ({
        ...s,
        ready: true,
        online: navigator.onLine,
        lastSyncedAt: readLastSynced(),
      }));
      await refresh();
      await flush();
    })();
    return () => {
      alive = false;
    };
  }, [flush, refresh]);

  React.useEffect(() => {
    const up = () => {
      setState((s) => ({ ...s, online: true }));
      void flush();
    };
    const down = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = window.setInterval(() => void flush(), RETRY_EVERY_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [flush]);

  // Service worker: caches the app's static files and an offline page.
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const mark = () =>
      setState((s) => ({ ...s, offlineReady: Boolean(navigator.serviceWorker.controller) }));
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then(mark)
      .catch(() => undefined);
    navigator.serviceWorker.addEventListener("controllerchange", mark);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", mark);
  }, []);

  const enqueue = React.useCallback<Ctx["enqueue"]>(
    async (input) => {
      const q = queueRef.current;
      if (!q) throw new Error("The upload queue isn't ready yet.");
      await q.enqueue(input);
      await refresh();
      void flush();
    },
    [refresh, flush],
  );
  const retry = React.useCallback(
    async (id: string) => {
      await queueRef.current?.retry(id);
      await refresh();
      void flush();
    },
    [refresh, flush],
  );
  const discard = React.useCallback(
    async (id: string) => {
      await queueRef.current?.discard(id);
      await refresh();
    },
    [refresh],
  );
  const onSynced = React.useCallback((listener: (jobIds: string[]) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = React.useMemo<Ctx>(
    () => ({ ...state, enqueue, flush, retry, discard, onSynced }),
    [state, enqueue, flush, retry, discard, onSynced],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/** The offline queue and connection state. Outside the provider it reports "not ready". */
export function useOfflineSync(): Ctx {
  const ctx = React.useContext(OfflineContext);
  if (ctx) return ctx;
  return {
    ready: false,
    online: true,
    items: [],
    lastSyncedAt: null,
    offlineReady: false,
    enqueue: async () => {
      throw new Error("Offline uploads aren't available here.");
    },
    flush: async () => undefined,
    retry: async () => undefined,
    discard: async () => undefined,
    onSynced: () => () => undefined,
  };
}

/** Queue items for one job (photos waiting or failed). */
export function useJobQueue(jobId: string, kind = "photo") {
  const sync = useOfflineSync();
  const jobItems = React.useMemo(
    () => sync.items.filter((i) => i.jobId === jobId && i.kind === kind),
    [sync.items, jobId, kind],
  );
  return { ...sync, jobItems };
}
