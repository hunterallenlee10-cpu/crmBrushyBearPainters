import { describe, expect, it } from "vitest";
import {
  countFeed,
  customerJobCounts,
  feedCategory,
  filterFeed,
  lifetimeContractCents,
  sortFeed,
  taskTitleFromPost,
  type FeedItem,
} from "./feed-utils";

const note = (id: string, at: string, extra: Partial<FeedItem & { kind: "note" }> = {}) =>
  ({
    kind: "note",
    id,
    at,
    fromLead: false,
    authorName: "Olive Owner",
    body: "Gate is on the left side",
    pinned: false,
    priority: "normal",
    updatedAt: at,
    mine: true,
    ...extra,
  }) as FeedItem;

const items: FeedItem[] = [
  note("n1", "2026-10-20T10:00:00Z"),
  note("n2", "2026-10-21T10:00:00Z", { pinned: true, body: "Dog in the backyard" }),
  {
    kind: "comment",
    id: "c1",
    at: "2026-10-22T10:00:00Z",
    fromLead: false,
    authorName: "Otto Office",
    body: "Can you confirm colors?",
    category: "production",
    mentions: [{ id: "u2", name: "Pat Painter" }],
    editedAt: null,
    mine: false,
  },
  {
    kind: "event",
    id: "e1",
    at: "2026-10-23T10:00:00Z",
    fromLead: true,
    authorName: null,
    type: "lead_created",
    summary: "Lead created from the website",
  },
  {
    kind: "event",
    id: "e2",
    at: "2026-10-24T10:00:00Z",
    fromLead: false,
    authorName: null,
    type: "appointment_booked",
    summary: "Walkthrough booked",
  },
  {
    kind: "message",
    id: "m1",
    at: "2026-10-25T10:00:00Z",
    fromLead: false,
    authorName: "Otto Office",
    channel: "sms",
    direction: "outbound",
    status: "simulated",
    to: "+14255550101",
    subject: null,
    body: "See you Tuesday",
    callOutcome: null,
    callDurationSeconds: null,
  },
];

describe("feed categories and counts", () => {
  it("puts every entry in exactly one chip", () => {
    expect(items.map(feedCategory)).toEqual([
      "notes",
      "notes",
      "comments",
      "activity",
      "appointments",
      "messages",
    ]);
  });

  it("counts per chip, with documents and photos empty until Phase 5", () => {
    expect(countFeed(items)).toEqual({
      all: 6,
      comments: 1,
      notes: 2,
      activity: 1,
      documents: 0,
      photos: 0,
      appointments: 1,
      messages: 1,
    });
  });
});

describe("filterFeed", () => {
  it("filters by chip", () => {
    expect(filterFeed(items, "notes", "").map((i) => i.id)).toEqual(["n1", "n2"]);
    expect(filterFeed(items, "all", "")).toHaveLength(6);
  });

  it("searches bodies, summaries, authors and mentions (all words, any case)", () => {
    expect(filterFeed(items, "all", "DOG backyard").map((i) => i.id)).toEqual(["n2"]);
    expect(filterFeed(items, "all", "@pat").map((i) => i.id)).toEqual(["c1"]);
    expect(filterFeed(items, "all", "from the lead").map((i) => i.id)).toEqual(["e1"]);
    expect(filterFeed(items, "comments", "dog")).toEqual([]);
  });
});

describe("sortFeed", () => {
  it("keeps pinned notes on top, then newest first", () => {
    expect(sortFeed(items).map((i) => i.id)).toEqual(["n2", "m1", "e2", "e1", "c1", "n1"]);
  });
});

describe("taskTitleFromPost", () => {
  it("makes a one-line follow-up title and trims long posts", () => {
    expect(taskTitleFromPost("Call  about\nthe trim")).toBe("Follow up: Call about the trim");
    const long = taskTitleFromPost("x".repeat(300));
    expect(long.length).toBe(120);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("customer numbers", () => {
  it("counts won, open (including on hold) and lost jobs", () => {
    expect(
      customerJobCounts([
        { status: "open" },
        { status: "on_hold" },
        { status: "won" },
        { status: "lost" },
      ]),
    ).toEqual({ total: 4, open: 2, won: 1, lost: 1 });
  });

  it("sums contract baselines in cents, skipping lost jobs and missing amounts", () => {
    expect(
      lifetimeContractCents([
        { contractCents: 1_250_000, status: "won" },
        { contractCents: 480_050, status: "open" },
        { contractCents: 999_999, status: "lost" },
        { contractCents: null, status: "open" },
      ]),
    ).toBe(1_730_050);
    expect(lifetimeContractCents([])).toBe(0);
  });
});
