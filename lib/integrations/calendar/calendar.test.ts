import { describe, expect, it } from "vitest";
import {
  GoogleCalendarProvider,
  createOutboxCalendarProvider,
  getCalendarProvider,
} from "@/lib/integrations/calendar";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const event = {
  calendarId: "estimator@example.test",
  title: "Walkthrough – Sample Customer",
  start: "2026-11-02T17:00:00.000Z",
  end: "2026-11-02T18:00:00.000Z",
  location: "123 Sample St, Anytown",
  description: "Interior repaint walkthrough",
  attendees: [{ email: "customer@example.com", name: "Sample Customer" }],
};

describe("outbox calendar provider", () => {
  it("records calendar.upsert_event", async () => {
    const sink = createMemoryOutboxSink();
    const cal = createOutboxCalendarProvider({ orgId: "org-1", sink });
    const result = await cal.upsertEvent({ ...event, related: { type: "job", id: "job-1" } });
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries[0]).toMatchObject({
      domain: "calendar",
      operation: "calendar.upsert_event",
      recipient: "estimator@example.test",
      subject: "Walkthrough – Sample Customer",
      related: { type: "job", id: "job-1" },
      payload: { start: event.start, end: event.end, attendees: event.attendees },
    });
    expect(sink.entries[0]?.renderedBody).toContain("Location: 123 Sample St, Anytown");
  });

  it("records calendar.delete_event", async () => {
    const sink = createMemoryOutboxSink();
    const cal = createOutboxCalendarProvider({ orgId: "org-1", sink });
    const result = await cal.deleteEvent({ calendarId: "c1", externalId: "evt-1" });
    expect(result.status).toBe("simulated");
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      operation: "calendar.delete_event",
      payload: { calendarId: "c1", externalId: "evt-1" },
    });
  });
});

describe("GoogleCalendarProvider (disabled stub)", () => {
  const config = { accessToken: "ya29.test" };

  it("inserts a new event with POST", async () => {
    const fetch = createFakeFetch({ json: { id: "evt-new", status: "confirmed" } });
    const result = await new GoogleCalendarProvider({ fetch, config }).upsertEvent(event);
    expect(result).toEqual({ status: "sent", externalId: "evt-new" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/estimator%40example.test/events?sendUpdates=none",
    );
    expect(req?.headers.get("authorization")).toBe("Bearer ya29.test");
    expect(jsonBody(req)).toEqual({
      summary: "Walkthrough – Sample Customer",
      location: "123 Sample St, Anytown",
      description: "Interior repaint walkthrough",
      start: { dateTime: "2026-11-02T17:00:00.000Z", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-11-02T18:00:00.000Z", timeZone: "America/Los_Angeles" },
      attendees: [{ email: "customer@example.com", displayName: "Sample Customer" }],
    });
  });

  it("patches an existing event when externalId is set", async () => {
    const fetch = createFakeFetch({ json: { id: "evt-1" } });
    const result = await new GoogleCalendarProvider({ fetch, config }).upsertEvent({
      ...event,
      externalId: "evt-1",
    });
    expect(result.externalId).toBe("evt-1");
    expect(fetch.requests[0]?.method).toBe("PATCH");
    expect(fetch.requests[0]?.url).toContain("/events/evt-1?sendUpdates=none");
  });

  it("deletes events and treats 410 as already gone", async () => {
    const ok = createFakeFetch({ status: 204 });
    const cal = new GoogleCalendarProvider({ fetch: ok, config });
    expect(await cal.deleteEvent({ calendarId: "c1", externalId: "evt-1" })).toEqual({
      status: "sent",
      externalId: "evt-1",
    });
    expect(ok.requests[0]?.method).toBe("DELETE");
    const gone = createFakeFetch({ status: 410, json: { error: { code: 410, message: "Gone" } } });
    expect(
      (
        await new GoogleCalendarProvider({ fetch: gone, config }).deleteEvent({
          calendarId: "c1",
          externalId: "e",
        })
      ).status,
    ).toBe("sent");
  });

  it("maps errors to failed", async () => {
    const fetch = createFakeFetch({
      status: 403,
      json: { error: { code: 403, message: "Insufficient Permission" } },
    });
    expect(await new GoogleCalendarProvider({ fetch, config }).upsertEvent(event)).toEqual({
      status: "failed",
      error: "HTTP 403: Insufficient Permission",
    });
  });
});

describe("getCalendarProvider", () => {
  const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
  it("only returns Google Calendar when fully allowed", () => {
    const opts = {
      envProvider: "google_calendar",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { google_calendar: { accessToken: "t" } },
    };
    expect(getCalendarProvider(ctx).provider).toBe("outbox");
    expect(getCalendarProvider(ctx, opts).provider).toBe("outbox");
    expect(getCalendarProvider(ctx, { ...opts, locked: false })).toBeInstanceOf(
      GoogleCalendarProvider,
    );
  });
});
