/**
 * The 11 integration domains (SPEC §2.1). Every one ships disconnected: the
 * default provider writes to `integration_outbox` (status `simulated`) instead of
 * calling anything real. Interfaces, outbox providers and disabled real stubs
 * arrive in Phase 1; this registry drives the Integrations pill and cards.
 */

export type IntegrationKey =
  | "sms_voice"
  | "email"
  | "calendar"
  | "accounting"
  | "payments"
  | "esign"
  | "geo"
  | "weather"
  | "photos"
  | "reviews"
  | "ai";

export type IntegrationDefinition = {
  key: IntegrationKey;
  name: string;
  purpose: string;
  /** TypeScript interface(s) each provider implements. */
  interfaces: readonly string[];
  /** Env flag(s) selecting the provider. */
  envVars: readonly string[];
  /** Provider used while disconnected. */
  defaultProvider: string;
  /** Real providers scaffolded as disabled stubs. */
  realProviders: readonly string[];
};

export const INTEGRATIONS = [
  {
    key: "sms_voice",
    name: "SMS & Voice",
    purpose: "Instant text-back, customer texts, call logging and the softphone.",
    interfaces: ["SmsProvider", "VoiceProvider"],
    envVars: ["INTEGRATION_SMS_PROVIDER", "INTEGRATION_VOICE_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["twilio"],
  },
  {
    key: "email",
    name: "Email",
    purpose: "Confirmations, proposals, invoices, daily updates and campaigns.",
    interfaces: ["EmailProvider"],
    envVars: ["INTEGRATION_EMAIL_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["resend", "sendgrid"],
  },
  {
    key: "calendar",
    name: "Calendar",
    purpose: "Walkthroughs and production days on estimator and crew calendars.",
    interfaces: ["CalendarProvider"],
    envVars: ["INTEGRATION_CALENDAR_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_calendar"],
  },
  {
    key: "accounting",
    name: "Accounting",
    purpose: "Sync invoices and payments to the books.",
    interfaces: ["AccountingProvider"],
    envVars: ["INTEGRATION_ACCOUNTING_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["quickbooks_online"],
  },
  {
    key: "payments",
    name: "Payments",
    purpose: "Payment links on invoices and payment webhooks.",
    interfaces: ["PaymentsProvider"],
    envVars: ["INTEGRATION_PAYMENTS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["stripe"],
  },
  {
    key: "esign",
    name: "E-signature",
    purpose: "Proposal acceptance and contract signing (built-in BearSign by default).",
    interfaces: ["ESignProvider"],
    envVars: ["INTEGRATION_ESIGN_PROVIDER"],
    defaultProvider: "builtin",
    realProviders: ["docusign", "dropbox_sign"],
  },
  {
    key: "geo",
    name: "Address & Maps",
    purpose: "Address autocomplete, geocoding and drive-time estimates.",
    interfaces: ["GeoProvider"],
    envVars: ["INTEGRATION_GEO_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_places", "mapbox"],
  },
  {
    key: "weather",
    name: "Weather",
    purpose: "Rain probability and dew point for exterior and deck days.",
    interfaces: ["WeatherProvider"],
    envVars: ["INTEGRATION_WEATHER_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["nws", "openweather"],
  },
  {
    key: "photos",
    name: "Photos",
    purpose: "Sync job photos from a field photo app.",
    interfaces: ["PhotoSyncProvider"],
    envVars: ["INTEGRATION_PHOTOS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["companycam"],
  },
  {
    key: "reviews",
    name: "Reviews",
    purpose: "Google review requests and review tracking.",
    interfaces: ["ReviewsProvider"],
    envVars: ["INTEGRATION_REVIEWS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_business_profile"],
  },
  {
    key: "ai",
    name: "AI Assistant (optional)",
    purpose: "Ask box and summaries, always grounded in computed metrics.",
    interfaces: ["AiProvider"],
    envVars: ["INTEGRATION_AI_PROVIDER"],
    defaultProvider: "disabled",
    realProviders: ["anthropic"],
  },
] as const satisfies readonly IntegrationDefinition[];

export const INTEGRATION_COUNT = INTEGRATIONS.length;

/**
 * Number of connected integrations. Always 0 in this build: nothing connects
 * until an owner configures it (Phase 1 reads `integration_connections`).
 */
export function connectedIntegrationCount(): number {
  return 0;
}
