/**
 * The 11 integration domains (SPEC §2.1). Every one ships disconnected: the
 * default provider writes to `integration_outbox` (status `simulated`) instead of
 * calling anything real. Interfaces, outbox providers and disabled real stubs
 * live in `lib/integrations/<domain>/`; the provider gate is in `core.ts`.
 * This registry drives the Integrations pill, cards and setup checklists.
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
  /** How often it syncs once connected (shown on the Integrations card). */
  syncFrequency: string;
  /** Owner checklist for connecting it later (mirrors docs/INTEGRATIONS.md). */
  setupSteps: readonly string[];
};

/** Last step of every checklist: the build lock (see core.ts / docs/INTEGRATIONS.md). */
export const UNLOCK_STEP =
  "Ask the developer to lift the build lock (docs/INTEGRATIONS.md → How the lock works), then mark the connection Connected in Admin → Integrations.";

export const INTEGRATIONS = [
  {
    key: "sms_voice",
    name: "SMS & Voice",
    purpose: "Instant text-back, customer texts, call logging and the softphone.",
    interfaces: ["SmsProvider", "VoiceProvider"],
    envVars: ["INTEGRATION_SMS_PROVIDER", "INTEGRATION_VOICE_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["twilio"],
    syncFrequency: "Real time",
    setupSteps: [
      "Create a Twilio account, then buy or port the business number and complete US A2P 10DLC brand and campaign registration (required before business texting).",
      "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (see .env.example), plus INTEGRATION_SMS_PROVIDER=twilio and INTEGRATION_VOICE_PROVIDER=twilio.",
      "On the Twilio number, send incoming messages to https://<your-domain>/api/webhooks/twilio/sms and status callbacks to https://<your-domain>/api/webhooks/twilio/status (the routes are built when this integration is connected).",
      "Add the outbound-call TwiML URL to the connection's config in Admin → Integrations.",
      "Test from a preview deployment: text an owner's own phone, reply STOP and confirm the contact is opted out, then reply START.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "email",
    name: "Email",
    purpose: "Confirmations, proposals, invoices, daily updates and campaigns.",
    interfaces: ["EmailProvider"],
    envVars: ["INTEGRATION_EMAIL_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["resend", "sendgrid"],
    syncFrequency: "Real time",
    setupSteps: [
      "Choose Resend or SendGrid and create an account.",
      "Verify the sending domain in the provider (SPF and DKIM DNS records, plus a DMARC record).",
      "Set RESEND_API_KEY or SENDGRID_API_KEY and INTEGRATION_EMAIL_PROVIDER=resend|sendgrid; put the verified from address in the connection's config.",
      "Optional: point the provider's event webhook at https://<your-domain>/api/webhooks/email for bounces and spam complaints.",
      "Test: send a sample proposal email to an owner's inbox; confirm it lands outside spam and replies reach the office.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "calendar",
    name: "Calendar",
    purpose: "Walkthroughs and production days on estimator and crew calendars.",
    interfaces: ["CalendarProvider"],
    envVars: ["INTEGRATION_CALENDAR_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_calendar"],
    syncFrequency: "Real time",
    setupSteps: [
      "In Google Cloud Console, create a project, enable the Google Calendar API and configure the OAuth consent screen.",
      "Create a web OAuth client with redirect URI https://<your-domain>/api/integrations/google/callback; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      "Set INTEGRATION_CALENDAR_PROVIDER=google_calendar; each estimator and crew lead connects their own calendar from Admin → Integrations.",
      "Test on a test calendar: schedule, move and cancel a walkthrough; the event follows each change and Google sends no invitation to the customer.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "accounting",
    name: "Accounting",
    purpose: "Sync invoices and payments to the books.",
    interfaces: ["AccountingProvider"],
    envVars: ["INTEGRATION_ACCOUNTING_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["quickbooks_online"],
    syncFrequency: "Every 15 minutes",
    setupSteps: [
      "Create an Intuit Developer account and an app with the Accounting scope; start with the sandbox company.",
      "Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET and add redirect URI https://<your-domain>/api/integrations/quickbooks/callback.",
      "Set INTEGRATION_ACCOUNTING_PROVIDER=quickbooks_online and connect the company (stores the company id and tokens on the connection).",
      "With the accountant, choose the QuickBooks item(s) for painting lines and how sales tax maps; record the item id in the connection's config.",
      "Optional: add the QuickBooks webhook https://<your-domain>/api/webhooks/quickbooks.",
      "Test in the sandbox: sync an invoice and a partial payment; totals match the CRM ledger to the cent.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "payments",
    name: "Payments",
    purpose: "Payment links on invoices and payment webhooks.",
    interfaces: ["PaymentsProvider"],
    envVars: ["INTEGRATION_PAYMENTS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["stripe"],
    syncFrequency: "Real time",
    setupSteps: [
      "Create a Stripe account, complete business verification and stay in test mode.",
      "Set STRIPE_SECRET_KEY (a test key first) and INTEGRATION_PAYMENTS_PROVIDER=stripe.",
      "Add the webhook endpoint https://<your-domain>/api/webhooks/stripe (checkout.session.completed, payment_intent.payment_failed, charge.refunded) and copy its signing secret into STRIPE_WEBHOOK_SECRET.",
      "Owners decide accepted payment methods and any card-fee policy (not set in code).",
      "Test: create a link for a test invoice, pay with a Stripe test card, confirm the webhook verifies and the payment posts to the ledger once (replay the event to check idempotency).",
      UNLOCK_STEP,
    ],
  },
  {
    key: "esign",
    name: "E-signature",
    purpose: "Proposal acceptance and contract signing (built-in BearSign by default).",
    interfaces: ["ESignProvider"],
    envVars: ["INTEGRATION_ESIGN_PROVIDER"],
    defaultProvider: "builtin",
    realProviders: ["docusign", "dropbox_sign"],
    syncFrequency: "On demand",
    setupSteps: [
      "Default is the built-in BearSign (Phase 4), which needs no account; only follow these steps to use DocuSign or Dropbox Sign instead.",
      "DocuSign: create a developer account and an app (integration key) using the JWT grant; set DOCUSIGN_INTEGRATION_KEY and store the account id and base path in the connection's config.",
      "Dropbox Sign: create an API app and key; set DROPBOX_SIGN_API_KEY (requests stay in test mode until the owners approve).",
      "Set INTEGRATION_ESIGN_PROVIDER=docusign|dropbox_sign and point status webhooks at https://<your-domain>/api/webhooks/docusign or https://<your-domain>/api/webhooks/dropbox-sign.",
      "Have the contract templates approved (docs/COMPLIANCE.md) before any real signing.",
      "Test: send a sample proposal to an owner, sign it and confirm the status changes to completed.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "geo",
    name: "Address & Maps",
    purpose: "Address autocomplete, geocoding and drive-time estimates.",
    interfaces: ["GeoProvider"],
    envVars: ["INTEGRATION_GEO_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_places", "mapbox"],
    syncFrequency: "On demand",
    setupSteps: [
      "Google: in Cloud Console enable Places API (New), Geocoding API and Routes API, create an API key restricted to those APIs and set GOOGLE_MAPS_API_KEY. Mapbox: create an access token and set MAPBOX_ACCESS_TOKEN.",
      "Set a budget alert or daily quota in the provider console.",
      "Set INTEGRATION_GEO_PROVIDER=google_places|mapbox.",
      "Test: type a partial address on New Lead, pick a suggestion and confirm lat/lng, city and ZIP fill in; check drive time between two sample jobs.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "weather",
    name: "Weather",
    purpose: "Rain probability and dew point for exterior and deck days.",
    interfaces: ["WeatherProvider"],
    envVars: ["INTEGRATION_WEATHER_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["nws", "openweather"],
    syncFrequency: "Hourly",
    setupSteps: [
      "NWS (api.weather.gov) needs no account: set NWS_USER_AGENT to an app name plus a contact email the owners choose.",
      "Or OpenWeather: create an account, subscribe to One Call API 3.0 and set OPENWEATHER_API_KEY.",
      "Set INTEGRATION_WEATHER_PROVIDER=nws|openweather.",
      "Owners set the exterior and deck thresholds (rain %, dew point) in Settings; nothing is hard-coded.",
      "Test: open a scheduled exterior job and confirm the hourly rain % and dew point show.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "photos",
    name: "Photos",
    purpose: "Sync job photos from a field photo app.",
    interfaces: ["PhotoSyncProvider"],
    envVars: ["INTEGRATION_PHOTOS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["companycam"],
    syncFrequency: "Every 15 minutes",
    setupSteps: [
      "Use the owners' CompanyCam account and create an API access token in its developer settings.",
      "Set COMPANYCAM_API_TOKEN and INTEGRATION_PHOTOS_PROVIDER=companycam.",
      "Optional: add a CompanyCam webhook to https://<your-domain>/api/webhooks/companycam for new photos.",
      "Test: create a project from a test job, take a photo in the CompanyCam app and confirm it appears on the job.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "reviews",
    name: "Reviews",
    purpose: "Google review requests and review tracking.",
    interfaces: ["ReviewsProvider"],
    envVars: ["INTEGRATION_REVIEWS_PROVIDER"],
    defaultProvider: "outbox",
    realProviders: ["google_business_profile"],
    syncFrequency: "Daily",
    setupSteps: [
      "Confirm the Google Business Profile is verified, then request Business Profile API access for the Google Cloud project (Google approves it).",
      "Enable the Business Profile APIs, reuse GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET with the business.manage scope and set GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID; store the location id and Place id in the connection's config.",
      "Set INTEGRATION_REVIEWS_PROVIDER=google_business_profile.",
      "Test: list reviews on the Reviews page and open the review link from a test review request.",
      UNLOCK_STEP,
    ],
  },
  {
    key: "ai",
    name: "AI Assistant (optional)",
    purpose: "Ask box and summaries, always grounded in computed metrics.",
    interfaces: ["AiProvider"],
    envVars: ["INTEGRATION_AI_PROVIDER"],
    defaultProvider: "disabled",
    realProviders: ["anthropic"],
    syncFrequency: "On demand",
    setupSteps: [
      "Owners decide whether to turn the optional AI assistant on at all.",
      "Create an Anthropic Console account and an API key with a monthly spend limit; set ANTHROPIC_API_KEY.",
      "Set INTEGRATION_AI_PROVIDER=anthropic.",
      'Test: ask "How are sales this month?" and confirm the answer matches the metric card and lists the metrics and filters used.',
      UNLOCK_STEP,
    ],
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
