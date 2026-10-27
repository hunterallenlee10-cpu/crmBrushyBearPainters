# Integrations

**Nothing is connected in this build.** Every domain sits behind an interface; the default provider records what _would_ have been sent in `integration_outbox` (status `simulated`), shown in the app as "Simulated – not sent". Read-style operations (address lookup, weather, reviews, photo listing, AI) return `{ connected: false, reason }` and write nothing.

| Domain         | Interface                      | Default             | Real provider stubs                | Env flag                                                 | Sync once connected |
| -------------- | ------------------------------ | ------------------- | ---------------------------------- | -------------------------------------------------------- | ------------------- |
| SMS & Voice    | `SmsProvider`, `VoiceProvider` | outbox              | Twilio                             | `INTEGRATION_SMS_PROVIDER`, `INTEGRATION_VOICE_PROVIDER` | Real time           |
| Email          | `EmailProvider`                | outbox              | Resend, SendGrid                   | `INTEGRATION_EMAIL_PROVIDER`                             | Real time           |
| Calendar       | `CalendarProvider`             | outbox              | Google Calendar                    | `INTEGRATION_CALENDAR_PROVIDER`                          | Real time           |
| Accounting     | `AccountingProvider`           | outbox              | QuickBooks Online                  | `INTEGRATION_ACCOUNTING_PROVIDER`                        | Every 15 minutes    |
| Payments       | `PaymentsProvider`             | outbox              | Stripe                             | `INTEGRATION_PAYMENTS_PROVIDER`                          | Real time           |
| E-signature    | `ESignProvider`                | built-in (BearSign) | DocuSign, Dropbox Sign             | `INTEGRATION_ESIGN_PROVIDER`                             | On demand           |
| Address & Maps | `GeoProvider`                  | outbox              | Google Places, Mapbox              | `INTEGRATION_GEO_PROVIDER`                               | On demand           |
| Weather        | `WeatherProvider`              | outbox              | NWS (api.weather.gov), OpenWeather | `INTEGRATION_WEATHER_PROVIDER`                           | Hourly              |
| Photos         | `PhotoSyncProvider`            | outbox              | CompanyCam                         | `INTEGRATION_PHOTOS_PROVIDER`                            | Every 15 minutes    |
| Reviews        | `ReviewsProvider`              | outbox              | Google Business Profile            | `INTEGRATION_REVIEWS_PROVIDER`                           | Daily               |
| AI (optional)  | `AiProvider`                   | disabled            | Anthropic                          | `INTEGRATION_AI_PROVIDER`                                | On demand           |

Source of truth in code: `lib/integrations/registry.ts` (names, env flags, frequencies and the setup checklists shown on the Admin → Integrations cards).

## How the lock works

A real provider is used only when **all three** of these hold. `resolveProviderChoice()` in `lib/integrations/core.ts` enforces it; anything short of all three returns the default provider.

1. **Env flag** selects the real provider, e.g. `INTEGRATION_SMS_PROVIDER=twilio` (with its credentials set; see `.env.example`).
2. **Connection row**: the org's `integration_connections` row for the domain has status `connected`, set by an owner in Admin → Integrations.
3. **Code lock is off**: `REAL_PROVIDERS_LOCKED` in `lib/integrations/core.ts` is `false`. It is `true` in this build, and flipping it is a deliberate, reviewed code change the owners ask for.

A database guard adds a fourth check: the trigger `app.integration_connections_guard` refuses to mark any connection `connected` in this build. Lifting it needs a new migration.

Even with all three, every real adapter takes an injected `fetch`, and the unit tests only ever pass a fake one. HTTP errors come back as `{ status: "failed", error }` (or `{ connected: true, error }` for reads) and never throw.

## Code map

- `lib/integrations/core.ts`: outbox entry and sink types, `resolveProviderChoice`, `REAL_PROVIDERS_LOCKED`, money helpers.
- `lib/integrations/outbox-sink.ts` (server-only): `createSupabaseOutboxSink(serviceClient)` writes `integration_outbox` rows.
- `lib/integrations/<domain>/`: `types.ts` (interface), `outbox.ts` (default provider), one file per real provider (disabled stub), `index.ts` (`get<Domain>Provider(ctx, options)` factory), colocated tests.
- `lib/integrations/testing.ts`: the fake `fetch` used by every stub test.

Outbox operations recorded: `sms.send`, `voice.place_call`, `email.send`, `calendar.upsert_event`, `calendar.delete_event`, `accounting.sync_invoice`, `accounting.sync_payment`, `payments.create_payment_link`, `esign.create_envelope`, `photos.create_project`. Money in payloads is integer cents. E-sign entries store the document's size and SHA-256, not the PDF itself.

## Setup checklists

`<your-domain>` stands for the production domain the owners choose. Webhook and OAuth-callback routes named below are built when each integration is connected; they do not exist yet. Per-org values that aren't secrets (company ids, location ids, from addresses, TwiML URLs) go in the connection's `config` in Admin → Integrations, not in env.

The last step for every provider: **ask the developer to lift the build lock (see above), then mark the connection Connected in Admin → Integrations.**

### SMS & Voice: Twilio

1. Create a Twilio account. Buy or port the business number, then complete US A2P 10DLC brand and campaign registration, which is required before business texting.
2. Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, plus `INTEGRATION_SMS_PROVIDER=twilio` and `INTEGRATION_VOICE_PROVIDER=twilio`.
3. Webhooks on the Twilio number: incoming messages go to `https://<your-domain>/api/webhooks/twilio/sms`; status callbacks go to `https://<your-domain>/api/webhooks/twilio/status`.
4. Add the outbound-call TwiML URL to the connection config.
5. Test from a preview deployment: text an owner's own phone. Reply STOP and confirm the contact is opted out, then reply START. Opt-out keywords: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT. Opt-in keywords: START, UNSTOP.

### Email: Resend

1. Create a Resend account.
2. Verify the sending domain: SPF and DKIM DNS records, plus a DMARC record.
3. Env: `RESEND_API_KEY`, `INTEGRATION_EMAIL_PROVIDER=resend`. Put the verified from address in the connection config.
4. Optional webhook for bounces and complaints: `https://<your-domain>/api/webhooks/email`.
5. Test: send a sample proposal to an owner's inbox. Check that it lands outside spam and that replies reach the office.

### Email: SendGrid

1. Create a SendGrid account and an API key with Mail Send permission.
2. Complete domain authentication (SPF/DKIM) and add a DMARC record.
3. Env: `SENDGRID_API_KEY`, `INTEGRATION_EMAIL_PROVIDER=sendgrid`. Put the verified from address in the connection config.
4. Optional Event Webhook: `https://<your-domain>/api/webhooks/email`.
5. Test as for Resend.

### Calendar: Google Calendar

1. In Google Cloud Console, create a project, enable the Google Calendar API and configure the OAuth consent screen.
2. Create a web OAuth client with redirect URI `https://<your-domain>/api/integrations/google/callback`. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `INTEGRATION_CALENDAR_PROVIDER=google_calendar`.
3. Each estimator and crew lead connects their own calendar from Admin → Integrations.
4. Test on a test calendar: schedule a walkthrough, move it, then cancel it. The event should follow each change, and Google should send no invitation to the customer (the adapter sends `sendUpdates=none`).

### Accounting: QuickBooks Online

1. Create an Intuit Developer account and an app with the Accounting scope. Start with the sandbox company.
2. Env: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `INTEGRATION_ACCOUNTING_PROVIDER=quickbooks_online`. Redirect URI: `https://<your-domain>/api/integrations/quickbooks/callback`.
3. Connect the company. This stores the company id (realmId) and tokens on the connection.
4. With the accountant, choose the QuickBooks item(s) for painting lines and decide how sales tax maps. Record the item id in the connection config.
5. Optional webhook: `https://<your-domain>/api/webhooks/quickbooks`.
6. Test in the sandbox: sync an invoice and a partial payment. Totals must match the CRM ledger to the cent (the adapter converts integer cents to decimal dollars only at the API boundary).

### Payments: Stripe

1. Create a Stripe account, complete business verification and stay in test mode.
2. Env: `STRIPE_SECRET_KEY` (a test key first), `INTEGRATION_PAYMENTS_PROVIDER=stripe`.
3. Webhook endpoint: `https://<your-domain>/api/webhooks/stripe` with events `checkout.session.completed`, `payment_intent.payment_failed` and `charge.refunded`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Signatures are checked with HMAC-SHA256 within a 5-minute window (`verifyStripeSignature`).
4. Owners decide the accepted payment methods and any card-fee policy. Neither is set in code.
5. Test: create a link for a test invoice and pay with a Stripe test card. Confirm the webhook verifies and the payment posts to the ledger once; replay the event to check idempotency.

### E-signature: built-in BearSign (default)

Needs no account. Built in Phase 4: the customer opens `/p/[token]` (no login), picks an option and add-ons, types their name and draws a signature. The CRM stores the signature with time, IP, user agent and the consent text, renders the signed proposal + contract PDF into the private `documents` bucket, and moves the job on. Estimate and change-order links are sent by text and email through the messaging adapters, so in this build they land in the outbox as **simulated** (the link is shown to the sender to open or copy). Have the templates approved (`docs/COMPLIANCE.md`) before any real signing.

### E-signature: DocuSign

1. Create a DocuSign developer account and an app (integration key) that uses the JWT grant.
2. Env: `DOCUSIGN_INTEGRATION_KEY`, `INTEGRATION_ESIGN_PROVIDER=docusign`. Store the API account id and base path (e.g. `https://demo.docusign.net/restapi` while testing) in the connection config.
3. Connect webhook: `https://<your-domain>/api/webhooks/docusign`.
4. Test: send a sample proposal to an owner, sign it, and confirm the status changes to completed.

### E-signature: Dropbox Sign

1. Create a Dropbox Sign API app and API key.
2. Env: `DROPBOX_SIGN_API_KEY`, `INTEGRATION_ESIGN_PROVIDER=dropbox_sign`. Requests stay in `test_mode` until the owners approve.
3. Callback URL: `https://<your-domain>/api/webhooks/dropbox-sign`.
4. Test as for DocuSign.

### Address & Maps: Google Places

1. In Google Cloud Console, enable Places API (New), Geocoding API and Routes API.
2. Create an API key restricted to those APIs. Env: `GOOGLE_MAPS_API_KEY`, `INTEGRATION_GEO_PROVIDER=google_places`.
3. Set a budget alert or a daily quota.
4. Test: type a partial address on New Lead and pick a suggestion. Lat/lng, city and ZIP should fill in. Then check the drive time between two sample jobs.

### Address & Maps: Mapbox

1. Create a Mapbox account and an access token restricted to the app's URLs.
2. Env: `MAPBOX_ACCESS_TOKEN`, `INTEGRATION_GEO_PROVIDER=mapbox`.
3. Set a usage alert.
4. Test as for Google Places.

### Weather: NWS (api.weather.gov)

1. No account is needed. Env: `NWS_USER_AGENT` (an app name plus a contact email the owners choose; NWS requires it), `INTEGRATION_WEATHER_PROVIDER=nws`.
2. Owners set the exterior and deck thresholds (rain %, dew point) in Settings. Nothing is hard-coded.
3. Test: open a scheduled exterior job and confirm the hourly rain % and dew point show. Dew point is converted from °C to °F.

### Weather: OpenWeather

1. Create an OpenWeather account and subscribe to One Call API 3.0.
2. Env: `OPENWEATHER_API_KEY`, `INTEGRATION_WEATHER_PROVIDER=openweather`.
3. Thresholds and the test are as for NWS.

### Photos: CompanyCam

1. In the owners' CompanyCam account, create an API access token in the developer settings.
2. Env: `COMPANYCAM_API_TOKEN`, `INTEGRATION_PHOTOS_PROVIDER=companycam`.
3. Optional webhook for new photos: `https://<your-domain>/api/webhooks/companycam`.
4. Test: create a project from a test job, take a photo in the CompanyCam app, and confirm it appears on the job.

### Reviews: Google Business Profile

1. Confirm the Business Profile is verified, then request Business Profile API access for the Google Cloud project. Google has to approve this.
2. Enable the Business Profile APIs and reuse `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with the `business.manage` scope. Env: `GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID`, `INTEGRATION_REVIEWS_PROVIDER=google_business_profile`. Store the location id and Place id in the connection config.
3. Test: list reviews on the Reviews page and open the review link from a test review request.

### AI (optional): Anthropic

1. Owners decide whether to turn the AI assistant on at all. It is used only for the Ask box and summaries, always grounded in computed metrics from `lib/metrics/registry.ts`.
2. Create an Anthropic Console account and an API key with a monthly spend limit. Env: `ANTHROPIC_API_KEY`, `INTEGRATION_AI_PROVIDER=anthropic`. The default model is `claude-opus-5-5`; owners can pick a cheaper model in the connection config. Calls go through the official `@anthropic-ai/sdk` with the server-side refusal fallback on.
3. Test: ask "How are sales this month?" Confirm the answer matches the metric card and lists the metrics and filters used.
