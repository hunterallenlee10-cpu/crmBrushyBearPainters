# Website → CRM lead intake

> Skeleton. The intake endpoint is built in **Phase 2** (SPEC §14). This page will then hold the exact payload contract, a server-action snippet for the website repo, and a curl example.

## What's planned

- `POST /api/public/leads` — verifies `X-BB-Signature` (HMAC-SHA256 with `LEAD_INTAKE_HMAC_SECRET`), rate-limits by IP, validates with zod, honors `Idempotency-Key`, rejects filled honeypot (`company`), normalizes phone (E.164) and email, maps ZIP → territory (or flags Out of area), stores UTM / referrer / `ref` code / `page_path`, dedupes (same phone or email within 180 days → activity on the existing lead), scores the lead, emits `lead.created`.
- `POST /api/public/leads/upload-url` — presigned photo uploads.
- Response: `{ "ok": true, "leadId": "…" }` only (no PII echoed).
- The website signs the payload **server-side**; the secret never reaches the browser.

## Fields from the live `/estimate` form

| Step | Field                                                 | Values                                                           |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | `name`, `phone`, `email`, `location` (address or ZIP) | free text                                                        |
| 1    | `services[]`                                          | Interior, Exterior, Cabinets, Deck or fence, Something else      |
| 1    | `company`                                             | hidden honeypot — must be empty                                  |
| 2    | timeline                                              | As soon as possible, In 1–3 months, 3+ months out, Just planning |
| 2    | home built                                            | Before 1978, 1978 or later, Not sure                             |
| 2    | photos                                                | uploads                                                          |
| 2    | notes                                                 | free text                                                        |
| —    | `page_path`                                           | e.g. `/services/exterior-painting`, `/painters/kirkland-wa`      |
