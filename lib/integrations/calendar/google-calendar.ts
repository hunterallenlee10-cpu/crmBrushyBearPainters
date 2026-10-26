// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type CalendarDeleteInput,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarWriteResult,
} from "@/lib/integrations/calendar/types";
import { getString, requestJson } from "@/lib/integrations/http";

export type GoogleCalendarConfig = {
  /** OAuth access token (calendar.events scope). Refreshing it is the connect flow's job. */
  accessToken: string;
  /** IANA zone sent with event times. Defaults to America/Los_Angeles. */
  timeZone?: string;
};

const API = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarProvider implements CalendarProvider {
  readonly provider = "google_calendar";
  private readonly fetch: typeof fetch;
  private readonly config: GoogleCalendarConfig;

  constructor(options: { fetch: typeof fetch; config: GoogleCalendarConfig }) {
    if (!options.config.accessToken) throw new Error("Google Calendar needs an accessToken.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private eventsUrl(calendarId: string, eventId?: string): string {
    const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  async upsertEvent(input: CalendarEventInput): Promise<CalendarWriteResult> {
    const timeZone = this.config.timeZone ?? "America/Los_Angeles";
    const body: Record<string, unknown> = {
      summary: input.title,
      start: { dateTime: input.start, timeZone },
      end: { dateTime: input.end, timeZone },
    };
    if (input.location !== undefined) body.location = input.location;
    if (input.description !== undefined) body.description = input.description;
    if (input.attendees) {
      body.attendees = input.attendees.map((a) =>
        a.name ? { email: a.email, displayName: a.name } : { email: a.email },
      );
    }
    // The CRM owns customer messaging, so Google never emails invitations.
    const url = `${this.eventsUrl(input.calendarId, input.externalId)}?sendUpdates=none`;
    const res = await requestJson(this.fetch, url, {
      method: input.externalId ? "PATCH" : "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    return { status: "sent", externalId: getString(res.data, "id") ?? input.externalId };
  }

  async deleteEvent(input: CalendarDeleteInput): Promise<CalendarWriteResult> {
    const url = `${this.eventsUrl(input.calendarId, input.externalId)}?sendUpdates=none`;
    const res = await requestJson(this.fetch, url, { method: "DELETE", headers: this.headers() });
    // 410 Gone: already deleted — treat as success (idempotent handlers).
    if (!res.ok && res.status !== 410) return { status: "failed", error: res.error };
    return { status: "sent", externalId: input.externalId };
  }
}
