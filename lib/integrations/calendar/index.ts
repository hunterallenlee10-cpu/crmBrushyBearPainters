import {
  type GoogleCalendarConfig,
  GoogleCalendarProvider,
} from "@/lib/integrations/calendar/google-calendar";
import { createOutboxCalendarProvider } from "@/lib/integrations/calendar/outbox";
import { type CalendarProvider } from "@/lib/integrations/calendar/types";
import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";

export * from "@/lib/integrations/calendar/types";
export { createOutboxCalendarProvider } from "@/lib/integrations/calendar/outbox";
export {
  GoogleCalendarProvider,
  type GoogleCalendarConfig,
} from "@/lib/integrations/calendar/google-calendar";

export type CalendarCredentials = { google_calendar?: GoogleCalendarConfig };
export type CalendarProviderOptions = ProviderFactoryOptions<CalendarCredentials>;

/** Calendar provider for the org. Outbox unless the three-condition gate allows Google Calendar. */
export function getCalendarProvider(
  ctx: IntegrationContext,
  options: CalendarProviderOptions = {},
): CalendarProvider {
  const choice = resolveDomainProvider("calendar", options);
  if (!choice.real) return createOutboxCalendarProvider(ctx);
  if (choice.provider !== "google_calendar") {
    throw new Error(`No calendar adapter for "${choice.provider}".`);
  }
  return new GoogleCalendarProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.google_calendar),
  );
}
