"use client";

import { MemoryQueueStore, type QueueItem, type QueueStore } from "./queue-core";

/**
 * IndexedDB store for the offline queue (one object store, keyed by item id;
 * Blobs are stored as-is). Falls back to memory when IndexedDB isn't available
 * (private browsing on some phones), so capture still works for the session.
 */

const DB_NAME = "brushybear-offline";
const STORE = "uploads";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? new Error("IndexedDB error"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB aborted"));
  });
}

export class IdbQueueStore implements QueueStore {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = open();
  }
  async put(item: QueueItem): Promise<void> {
    await tx(await this.db, "readwrite", (s) => s.put(item));
  }
  async delete(id: string): Promise<void> {
    await tx(await this.db, "readwrite", (s) => s.delete(id));
  }
  async all(): Promise<QueueItem[]> {
    return (await tx(await this.db, "readonly", (s) => s.getAll())) as QueueItem[];
  }
}

/** The best store this browser offers. */
export async function createQueueStore(): Promise<QueueStore> {
  if (typeof indexedDB === "undefined") return new MemoryQueueStore();
  try {
    const store = new IdbQueueStore();
    await store.all();
    return store;
  } catch {
    return new MemoryQueueStore();
  }
}
