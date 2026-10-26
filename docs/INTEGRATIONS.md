# Integrations

**Nothing is connected in this build.** Every domain sits behind an interface; the default provider records what _would_ have been sent in `integration_outbox` (status `simulated`), shown in the app as "Simulated – not sent".

Turning on a real provider later takes all three:

1. Credentials in the environment (see `.env.example`).
2. The provider flag, e.g. `INTEGRATION_SMS_PROVIDER=twilio`.
3. A `connected` row in `integration_connections`, set from Admin → Integrations by an owner.

> Step-by-step setup checklists (accounts to create, env vars, webhooks, test steps) are written per provider in **Phase 1**, when the adapter framework and Integrations page land.

| Domain         | Interface                      | Default             | Real provider stubs                | Env flag                                                 |
| -------------- | ------------------------------ | ------------------- | ---------------------------------- | -------------------------------------------------------- |
| SMS & Voice    | `SmsProvider`, `VoiceProvider` | outbox              | Twilio                             | `INTEGRATION_SMS_PROVIDER`, `INTEGRATION_VOICE_PROVIDER` |
| Email          | `EmailProvider`                | outbox              | Resend, SendGrid                   | `INTEGRATION_EMAIL_PROVIDER`                             |
| Calendar       | `CalendarProvider`             | outbox              | Google Calendar                    | `INTEGRATION_CALENDAR_PROVIDER`                          |
| Accounting     | `AccountingProvider`           | outbox              | QuickBooks Online                  | `INTEGRATION_ACCOUNTING_PROVIDER`                        |
| Payments       | `PaymentsProvider`             | outbox              | Stripe                             | `INTEGRATION_PAYMENTS_PROVIDER`                          |
| E-signature    | `ESignProvider`                | built-in (BearSign) | DocuSign, Dropbox Sign             | `INTEGRATION_ESIGN_PROVIDER`                             |
| Address & Maps | `GeoProvider`                  | outbox              | Google Places, Mapbox              | `INTEGRATION_GEO_PROVIDER`                               |
| Weather        | `WeatherProvider`              | outbox              | NWS (api.weather.gov), OpenWeather | `INTEGRATION_WEATHER_PROVIDER`                           |
| Photos         | `PhotoSyncProvider`            | outbox              | CompanyCam                         | `INTEGRATION_PHOTOS_PROVIDER`                            |
| Reviews        | `ReviewsProvider`              | outbox              | Google Business Profile            | `INTEGRATION_REVIEWS_PROVIDER`                           |
| AI (optional)  | `AiProvider`                   | disabled            | Anthropic                          | `INTEGRATION_AI_PROVIDER`                                |

Source of truth in code: `lib/integrations/registry.ts`.
