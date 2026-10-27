import { describe, expect, it, vi } from "vitest";
import {
  MemoryQueueStore,
  OfflineQueue,
  outcomeForStatus,
  retryDelayMs,
  syncLabel,
  type UploadOutcome,
} from "./queue-core";

function setup(outcomes: (UploadOutcome | Error)[]) {
  let now = 1_000_000;
  const clock = () => now;
  const store = new MemoryQueueStore();
  const upload = vi.fn(async () => {
    const next = outcomes.shift() ?? { ok: true as const };
    if (next instanceof Error) throw next;
    return next;
  });
  const queue = new OfflineQueue(store, { photo: upload }, clock);
  return { queue, store, upload, advance: (ms: number) => (now += ms) };
}

const item = (id: string, kind = "photo") => ({
  id,
  kind,
  jobId: "job-1",
  meta: { category: "before" },
});

describe("offline queue", () => {
  it("uploads queued items in order and removes them", async () => {
    const { queue, upload } = setup([]);
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b"));
    const r = await queue.flush();
    expect(r).toEqual({ uploaded: ["a", "b"], failed: [], waiting: 0 });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(await queue.items()).toEqual([]);
  });

  it("keeps an item after a network error, backs off, and stops the run", async () => {
    const { queue, advance } = setup([new Error("offline")]);
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b"));
    const r = await queue.flush();
    expect(r).toEqual({ uploaded: [], failed: [], waiting: 2 });
    const [a] = await queue.items();
    expect(a).toMatchObject({ id: "a", state: "queued", attempts: 1, lastError: "offline" });
    // "a" isn't due yet; "b" never failed, so it goes now.
    expect((await queue.flush()).uploaded).toEqual(["b"]);
    advance(retryDelayMs(1));
    expect((await queue.flush()).uploaded).toEqual(["a"]);
  });

  it("forced flush ignores the backoff", async () => {
    const { queue } = setup([{ ok: false, retry: true, error: "503" }]);
    await queue.enqueue(item("a"));
    await queue.flush();
    expect((await queue.flush({ force: true })).uploaded).toEqual(["a"]);
  });

  it("marks refused items failed, skips them later, and can retry or discard", async () => {
    const { queue } = setup([{ ok: false, retry: false, error: "Not allowed" }]);
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b"));
    const r = await queue.flush();
    expect(r).toEqual({ uploaded: ["b"], failed: ["a"], waiting: 0 });
    expect((await queue.items())[0]).toMatchObject({ state: "failed", lastError: "Not allowed" });
    expect((await queue.flush()).uploaded).toEqual([]);
    await queue.retry("a");
    await queue.retry("missing");
    expect((await queue.flush()).uploaded).toEqual(["a"]);
    await queue.enqueue(item("c"));
    await queue.discard("c");
    expect(await queue.items()).toEqual([]);
  });

  it("skips kinds nobody uploads and shares one run between callers", async () => {
    const { queue, upload } = setup([]);
    await queue.enqueue(item("x", "daily_log"));
    await queue.enqueue(item("a"));
    const [r1, r2] = await Promise.all([queue.flush(), queue.flush()]);
    expect(r1).toBe(r2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(r1.waiting).toBe(1);
  });
});

describe("helpers", () => {
  it("backs off 5 s, 10 s, 20 s … up to 5 minutes", () => {
    expect(retryDelayMs(0)).toBe(5_000);
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(20)).toBe(300_000);
  });

  it("retries timeouts, rate limits and server errors; not refusals", () => {
    expect(outcomeForStatus(201, "")).toEqual({ ok: true });
    expect(outcomeForStatus(503, "")).toEqual({
      ok: false,
      retry: true,
      error: "Upload failed (503).",
    });
    expect(outcomeForStatus(429, "slow down")).toMatchObject({ retry: true, error: "slow down" });
    expect(outcomeForStatus(0, "")).toMatchObject({ retry: true });
    expect(outcomeForStatus(408, "")).toMatchObject({ retry: true });
    expect(outcomeForStatus(403, "No")).toEqual({ ok: false, retry: false, error: "No" });
  });

  it("labels the sync state", () => {
    const at = Date.parse("2026-10-27T23:51:00Z"); // 4:51 PM Pacific
    expect(syncLabel(at, 0, true)).toBe("Offline ready · Last synced 4:51 PM");
    expect(syncLabel(null, 0, true)).toBe("Offline ready");
    expect(syncLabel(at, 2, true)).toBe("Uploading 2…");
    expect(syncLabel(at, 2, false)).toBe("Offline · 2 waiting to upload");
    expect(syncLabel(at, 0, false)).toBe("Offline · Last synced 4:51 PM");
    expect(syncLabel(null, 0, false)).toBe("Offline");
  });
});
