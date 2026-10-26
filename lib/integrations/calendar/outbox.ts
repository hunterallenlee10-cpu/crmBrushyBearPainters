import {
  type CalendarDeleteInput,
  type CalendarEventInput,
  type CalendarProvider,
} from "@/lib/integrations/calendar/types";
import { type IntegrationContext, recordSimulated } from "@/lib/integrations/core";

/** Default calendar provider: records event writes to `integration_outbox`. */
export function createOutboxCalendarProvider(ctx: IntegrationContext): CalendarProvider {
  return {
    provider: "outbox",
    async upsertEvent(input: CalendarEventInput) {
      const lines = [`${input.title}`, `${input.start} → ${input.end}`];
      if (input.location) lines.push(`Location: ${input.location}`);
      if (input.attendees?.length) {
        lines.push(`Attendees: ${input.attendees.map((a) => a.email).join(", ")}`);
      }
      if (input.description) lines.push("", input.description);
      return recordSimulated(ctx, {
        domain: "calendar",
        provider: "outbox",
        operation: "calendar.upsert_event",
        recipient: input.calendarId,
        subject: input.title,
        renderedBody: lines.join("\n"),
        payload: { ...input },
        related: input.related ?? null,
      });
    },
    async deleteEvent(input: CalendarDeleteInput) {
      return recordSimulated(ctx, {
        domain: "calendar",
        provider: "outbox",
        operation: "calendar.delete_event",
        recipient: input.calendarId,
        renderedBody: `Delete event ${input.externalId}`,
        payload: { ...input },
        related: input.related ?? null,
      });
    },
  };
}
