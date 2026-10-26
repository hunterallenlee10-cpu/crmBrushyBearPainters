import { type RelatedRecord, type SendStatus } from "@/lib/integrations/core";

export type CalendarAttendee = { email: string; name?: string };

export type CalendarEventInput = {
  calendarId: string;
  /** Provider event id; present → update, absent → create. */
  externalId?: string;
  title: string;
  /** ISO 8601 instant in UTC (stored UTC, displayed America/Los_Angeles). */
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: readonly CalendarAttendee[];
  related?: RelatedRecord | null;
};

export type CalendarDeleteInput = {
  calendarId: string;
  externalId: string;
  related?: RelatedRecord | null;
};

export type CalendarWriteResult = {
  status: SendStatus;
  externalId?: string;
  outboxId?: string;
  error?: string;
};

export interface CalendarProvider {
  readonly provider: string;
  upsertEvent(input: CalendarEventInput): Promise<CalendarWriteResult>;
  deleteEvent(input: CalendarDeleteInput): Promise<CalendarWriteResult>;
}
