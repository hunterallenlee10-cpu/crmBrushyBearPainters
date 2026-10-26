import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  CompanyCamPhotoProvider,
  createOutboxPhotoSyncProvider,
  getPhotoSyncProvider,
} from "@/lib/integrations/photos";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const project = {
  name: "Job 1042 – Sample Customer",
  address: {
    street1: "123 Sample St",
    city: "Anytown",
    state: "WA",
    postalCode: "98000",
  },
};

describe("outbox photo-sync provider", () => {
  it("listPhotos is not connected and writes nothing", async () => {
    const sink = createMemoryOutboxSink();
    const photos = createOutboxPhotoSyncProvider({ orgId: "o", sink });
    expect(await photos.listPhotos({ projectExternalId: "p1" })).toMatchObject({
      connected: false,
    });
    expect(sink.entries).toHaveLength(0);
  });

  it("createProject records photos.create_project", async () => {
    const sink = createMemoryOutboxSink();
    const photos = createOutboxPhotoSyncProvider({ orgId: "o", sink });
    const result = await photos.createProject({
      ...project,
      related: { type: "job", id: "job-1042" },
    });
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      domain: "photos",
      operation: "photos.create_project",
      subject: "Job 1042 – Sample Customer",
      renderedBody: "Job 1042 – Sample Customer\n123 Sample St, Anytown, WA 98000",
      related: { type: "job", id: "job-1042" },
      payload: { name: project.name, address: project.address },
    });
  });
});

describe("CompanyCamPhotoProvider (disabled stub)", () => {
  const config = { apiToken: "cc-token" };

  it("lists project photos since a timestamp", async () => {
    const fetch = createFakeFetch({
      json: [
        {
          id: "9001",
          captured_at: 1793638800,
          description: "North wall prep",
          coordinates: { lat: 47.6, lon: -122.1 },
          uris: [
            { type: "original", uri: "https://img.example.test/o.jpg" },
            { type: "web", uri: "https://img.example.test/w.jpg" },
            { type: "thumbnail", uri: "https://img.example.test/t.jpg" },
          ],
        },
        { id: 9002, uris: [{ type: "web", url: "https://img.example.test/w2.jpg" }] },
        { id: "bad", uris: [] },
      ],
    });
    const result = await new CompanyCamPhotoProvider({ fetch, config }).listPhotos({
      projectExternalId: "555",
      since: "2026-11-01T00:00:00Z",
    });
    expect(result).toEqual({
      connected: true,
      photos: [
        {
          externalId: "9001",
          url: "https://img.example.test/o.jpg",
          thumbnailUrl: "https://img.example.test/t.jpg",
          takenAt: "2026-11-02T17:00:00.000Z",
          caption: "North wall prep",
          lat: 47.6,
          lng: -122.1,
        },
        { externalId: "9002", url: "https://img.example.test/w2.jpg" },
      ],
    });
    const req = fetch.requests[0];
    expect(req?.method).toBe("GET");
    const url = new URL(req?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.companycam.com/v2/projects/555/photos");
    expect(url.searchParams.get("start_date")).toBe("1793491200");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(req?.headers.get("authorization")).toBe("Bearer cc-token");
  });

  it("creates a project", async () => {
    const fetch = createFakeFetch({ status: 201, json: { id: "777", name: project.name } });
    const result = await new CompanyCamPhotoProvider({ fetch, config }).createProject(project);
    expect(result).toEqual({ status: "sent", externalId: "777" });
    expect(fetch.requests[0]?.method).toBe("POST");
    expect(fetch.requests[0]?.url).toBe("https://api.companycam.com/v2/projects");
    expect(jsonBody(fetch.requests[0])).toEqual({
      project: {
        name: project.name,
        address: {
          street_address_1: "123 Sample St",
          city: "Anytown",
          state: "WA",
          postal_code: "98000",
          country: "US",
        },
      },
    });
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({ status: 422, json: { errors: ["Name can't be blank"] } });
    const cc = new CompanyCamPhotoProvider({ fetch, config });
    expect(await cc.createProject(project)).toEqual({
      status: "failed",
      error: "HTTP 422: Name can't be blank",
    });
    expect(await cc.listPhotos({ projectExternalId: "1" })).toEqual({
      connected: true,
      photos: [],
      error: "HTTP 422: Name can't be blank",
    });
  });
});

describe("getPhotoSyncProvider", () => {
  it("only returns CompanyCam when fully allowed", () => {
    const ctx = { orgId: "o", sink: createMemoryOutboxSink() };
    const opts = {
      envProvider: "companycam",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { companycam: { apiToken: "t" } },
    };
    expect(getPhotoSyncProvider(ctx).provider).toBe("outbox");
    expect(getPhotoSyncProvider(ctx, opts).provider).toBe("outbox");
    expect(getPhotoSyncProvider(ctx, { ...opts, locked: false })).toBeInstanceOf(
      CompanyCamPhotoProvider,
    );
  });
});
