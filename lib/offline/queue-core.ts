/**
 * Offline upload queue (SPEC §2 PWA): photos taken without signal, and in
 * Phase 6 daily logs, wait in IndexedDB and upload when the connection is
 * back. This file is the storage-agnostic core (unit-tested with an in-memory
 * store); `idb-store.ts` is the browser store and `offline-sync.tsx` the React
 * provider.
 *
 * Every item carries a client id that the server uses as an idempotency key,
 * so a retry after a lost response never creates a duplicate.
 */

export type QueueItemState = "queued" | "uploading" | "failed";

export type QueueItem = {
  /** Client id (uuid); the server's idempotency key. */
  id: string;
  /** Which uploader handles it ("photo", later "daily_log"). */
  kind: string;
  jobId: string;
  /** Small JSON-safe details (category, area, file name…). */
  meta: Record<string, string | number | boolean | null>;
  blob?: Blob;
  createdAt: number;
  attempts: number;
  /** Epoch ms before which it isn't retried. */
  nextAttemptAt: number;
  state: QueueItemState;
  lastError?: string;
};

export interface QueueStore {
  put(item: QueueItem): Promise<void>;
  delete(id: string): Promise<void>;
  all(): Promise<QueueItem[]>;
}

export type UploadOutcome =
  | { ok: true }
  /** retry=false: the server refused it (permission, validation); keep it for the person to see. */
  | { ok: false; retry: boolean; error: string };

export type Uploader = (item: QueueItem) => Promise<UploadOutcome>;

/** Backoff after a failed attempt: 5 s, 10 s, 20 s … capped at 5 minutes. */
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(5 * 60_000, 5_000 * 2 ** (n - 1));
}

/** How an HTTP status should be handled. */
export function outcomeForStatus(status: number, message: string): UploadOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  // Timeouts, rate limits and server errors are worth retrying; the rest won't change.
  const retry = status === 0 || status === 408 || status === 429 || status >= 500;
  return { ok: false, retry, error: message || `Upload failed (${status}).` };
}

export type FlushResult = { uploaded: string[]; failed: string[]; waiting: number };

export class OfflineQueue {
  private flushing: Promise<FlushResult> | null = null;

  constructor(
    private readonly store: QueueStore,
    private readonly uploaders: Readonly<Record<string, Uploader>>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async enqueue(
    input: Omit<QueueItem, "createdAt" | "attempts" | "nextAttemptAt" | "state">,
  ): Promise<QueueItem> {
    const item: QueueItem = {
      ...input,
      createdAt: this.clock(),
      attempts: 0,
      nextAttemptAt: 0,
      state: "queued",
    };
    await this.store.put(item);
    return item;
  }

  async items(): Promise<QueueItem[]> {
    return (await this.store.all()).sort((a, b) => a.createdAt - b.createdAt);
  }

  async discard(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /** Puts a failed item back in line now. */
  async retry(id: string): Promise<void> {
    const item = (await this.store.all()).find((i) => i.id === id);
    if (!item) return;
    await this.store.put({ ...item, state: "queued", nextAttemptAt: 0, lastError: undefined });
  }

  /**
   * Uploads every due item, one at a time (phones on weak signal do better
   * with one upload than with six). Concurrent calls share one run.
   */
  flush(opts: { force?: boolean } = {}): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.run(opts.force === true).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(force: boolean): Promise<FlushResult> {
    const uploaded: string[] = [];
    const failed: string[] = [];
    const now = this.clock();
    for (const item of await this.items()) {
      if (item.state === "failed") continue;
      if (!force && item.nextAttemptAt > now) continue;
      const upload = this.uploaders[item.kind];
      if (!upload) continue;
      await this.store.put({ ...item, state: "uploading" });
      let outcome: UploadOutcome;
      try {
        outcome = await upload(item);
      } catch (e) {
        outcome = {
          ok: false,
          retry: true,
          error: e instanceof Error ? e.message : "Network error",
        };
      }
      if (outcome.ok) {
        await this.store.delete(item.id);
        uploaded.push(item.id);
        continue;
      }
      const attempts = item.attempts + 1;
      if (outcome.retry) {
        await this.store.put({
          ...item,
          state: "queued",
          attempts,
          nextAttemptAt: this.clock() + retryDelayMs(attempts),
          lastError: outcome.error,
        });
        // Still offline or the server is down: the rest would fail the same way.
        break;
      }
      await this.store.put({ ...item, state: "failed", attempts, lastError: outcome.error });
      failed.push(item.id);
    }
    const waiting = (await this.store.all()).filter((i) => i.state !== "failed").length;
    return { uploaded, failed, waiting };
  }
}

/** In-memory store (tests, and browsers where IndexedDB is unavailable). */
export class MemoryQueueStore implements QueueStore {
  private readonly map = new Map<string, QueueItem>();
  async put(item: QueueItem): Promise<void> {
    this.map.set(item.id, item);
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
  async all(): Promise<QueueItem[]> {
    return [...this.map.values()];
  }
}

/** "Last synced 4:51 PM" (Pacific). */
export function syncLabel(lastSyncedAt: number | null, pending: number, online: boolean): string {
  const time =
    lastSyncedAt === null
      ? null
      : new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Los_Angeles",
        }).format(new Date(lastSyncedAt));
  if (!online) {
    return pending
      ? `Offline · ${pending} waiting to upload`
      : `Offline${time ? ` · Last synced ${time}` : ""}`;
  }
  if (pending) return `Uploading ${pending}…`;
  return time ? `Offline ready · Last synced ${time}` : "Offline ready";
}
