# Website → CRM lead intake

How the website's `/estimate` form (brushybear.vercel.app) sends leads to the CRM (SPEC §14).

**Status:** built and tested in Phase 2. The website needs a server-side change to call it. Until then, website leads don't reach the CRM.

## In one minute

1. The visitor submits the form. **The website's server** builds a JSON payload, signs it with the shared secret, and POSTs it to `https://<crm>/api/public/leads`.
2. The CRM checks the signature, applies rate limits, cleans the data, checks for a duplicate (same phone or email in the last 180 days), scores the lead and saves it. The whole round trip takes well under a second.
3. The CRM answers `{ "ok": true, "leadId": "…" }`. It never echoes personal data back.

The secret must **never** reach the browser. Sign on the server only: a Server Action, Route Handler or API route.

## Setup (owners)

| Where                | Variable                  | Value                                           |
| -------------------- | ------------------------- | ----------------------------------------------- |
| CRM (Vercel env)     | `LEAD_INTAKE_HMAC_SECRET` | `openssl rand -hex 32` (at least 32 characters) |
| Website (Vercel env) | `CRM_INTAKE_SECRET`       | the **same** value                              |
| Website (Vercel env) | `CRM_INTAKE_URL`          | `https://<crm-domain>/api/public/leads`         |
| CRM (optional)       | `LEAD_INTAKE_ORG_SLUG`    | defaults to `brushy-bear`                       |

To rotate the secret, update both sides at the same time and redeploy both (RUNBOOK → Rotating secrets).

## Request

```
POST /api/public/leads
Content-Type: application/json
X-BB-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
Idempotency-Key: <optional, 8–200 chars: letters, digits . _ : ->
```

- **Signature:** HMAC-SHA256 with the shared secret, over the exact bytes sent: the timestamp, a dot, then the raw body. Signatures older than 5 minutes are refused, which stops replays.
- **Idempotency-Key:** strongly recommended, e.g. a UUID generated when the form loads. If the same request is retried with the same key, you get the same `leadId` back and no second lead. Reusing a key with a _different_ body returns `409`.
- **Body size:** at most 64 KB. Photos are uploaded separately (see below).

### Body

Field names match the form. Send the labels people click; the stored keys are accepted too. Unknown fields are refused (`422`), so a typo can't slip through.

| Field                                                                 | Type          | Required          | Notes                                                                                                                             |
| --------------------------------------------------------------------- | ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                                | string ≤ 160  | yes               | Split into first/last ("Mary Ann Smith" → "Mary Ann" / "Smith").                                                                  |
| `phone`                                                               | string        | phone or email    | Any US format; stored as E.164 (`+14255550100`).                                                                                  |
| `email`                                                               | string        | phone or email    | Lowercased.                                                                                                                       |
| `location`                                                            | string ≤ 300  | no                | "Home address or ZIP code". A ZIP maps to a territory; ZIPs outside the service area are flagged **Out of area**, never rejected. |
| `services`                                                            | string[]      | no                | `Interior`, `Exterior`, `Cabinets`, `Deck or fence`, `Something else`.                                                            |
| `timeline`                                                            | string        | no                | `As soon as possible`, `In 1–3 months`, `3+ months out`, `Just planning`.                                                         |
| `home_built`                                                          | string        | no                | `Before 1978`, `1978 or later`, `Not sure` (drives lead-safe prep).                                                               |
| `notes`                                                               | string ≤ 5000 | no                | "Anything else we should know?"                                                                                                   |
| `photos`                                                              | object[] ≤ 10 | no                | `{ path, file_name, content_type, size_bytes }` from the upload step.                                                             |
| `company`                                                             | string        | **must be empty** | The hidden honeypot input. If it's filled, the CRM answers `200 { ok: true }` and stores nothing.                                 |
| `page_path`                                                           | string        | no                | e.g. `/services/exterior-painting` (infers the service) or `/painters/kirkland-wa` (infers the city).                             |
| `landing_page`, `referrer`                                            | string        | no                | First page of the visit, and `document.referrer`.                                                                                 |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | string        | no                | From the landing URL.                                                                                                             |
| `gclid`, `fbclid`                                                     | string        | no                | Ad click IDs.                                                                                                                     |
| `ref`                                                                 | string ≤ 40   | no                | Referral code from a Bear Champions link (`?ref=BEAR-1234`).                                                                      |
| `client_ip`                                                           | string        | recommended       | The visitor's IP as the website saw it. Used only for the per-visitor rate limit.                                                 |

**Lead source:** always `Website`. The sub-source is inferred in this order:

1. A referral code → Referral link
2. Local Services Ads tags → Local Services Ads
3. Google Business Profile tags → Google Business Profile
4. `gclid`, or Google with a paid medium → Google Ads
5. Facebook/Instagram tags or referrer → Facebook/Instagram
6. Nextdoor → Nextdoor
7. Yelp → Yelp
8. A search engine referrer → Organic
9. Anything else → Direct

### Responses

| Status | Body                                                               | Meaning                                                                                |
| ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `201`  | `{ "ok": true, "leadId": "…" }`                                    | New lead created.                                                                      |
| `200`  | `{ "ok": true, "leadId": "…" }`                                    | Same person within 180 days (added to their existing lead) or an idempotent replay.    |
| `200`  | `{ "ok": true }`                                                   | Honeypot filled; nothing stored.                                                       |
| `400`  | `{ "ok": false, "error": "…" }`                                    | Body isn't JSON, or a bad `Idempotency-Key`.                                           |
| `401`  | `{ "ok": false, "error": "…" }`                                    | Missing, wrong or expired signature.                                                   |
| `409`  | `{ "ok": false, "error": "…" }`                                    | `Idempotency-Key` reused with a different body, or the first request is still running. |
| `413`  | `{ "ok": false, "error": "…" }`                                    | Body over 64 KB.                                                                       |
| `422`  | `{ "ok": false, "error": "…", "fieldErrors": { "phone": ["…"] } }` | Validation failed (show `fieldErrors` next to the fields).                             |
| `429`  | `{ "ok": false, "error": "…" }` + `Retry-After`                    | Rate limit hit.                                                                        |
| `500`  | `{ "ok": false, "error": "…" }`                                    | Something broke on the CRM side. Retry with the same `Idempotency-Key`.                |
| `503`  | `{ "ok": false, "error": "…" }`                                    | Intake isn't configured (secret missing).                                              |

**Rate limits:**

- 5 submissions per visitor (`client_ip`) per 10 minutes
- 30 photo uploads per visitor per 10 minutes
- 120 requests per minute from the website's server

**Duplicates:** if the same phone or email came in within 180 days, the CRM doesn't create a second lead. Instead it:

- adds the new submission to the existing lead's Activity
- fills in any contact details that lead was missing (it never overwrites)
- notifies the lead's owner

## Photos (two steps)

1. For each file, `POST /api/public/leads/upload-url` (signed the same way) with `{ "file_name": "kitchen.jpg", "content_type": "image/jpeg", "size_bytes": 482133, "client_ip": "…" }`.
   - The answer is `201 { "ok": true, "path": "…", "uploadUrl": "…", "token": "…" }`.
   - Allowed types: JPEG, PNG, WebP, HEIC/HEIF, PDF, up to 15 MB each.
2. Upload the file to `uploadUrl` with an HTTP `PUT` and the file's `Content-Type`. The URL is single-use and expires in 2 hours. This step can run from the browser, because the URL itself is the permission and contains no secret.
3. List the files in the lead payload: `"photos": [{ "path": "…", "file_name": "kitchen.jpg", "content_type": "image/jpeg", "size_bytes": 482133 }]`.

The CRM attaches only files that really were uploaded for this company. Unknown paths are ignored; the lead is still created. Photos are stored in a private bucket and shown to staff through short-lived links.

## Website code (Next.js Server Action)

Put this in the website repo, for example `app/estimate/actions.ts`. It runs on the server, so the secret stays private.

```ts
"use server";

import { createHmac, randomUUID } from "node:crypto";
import { headers } from "next/headers";

type EstimateForm = {
  name: string;
  phone?: string;
  email?: string;
  location?: string;
  services?: string[];
  timeline?: string;
  home_built?: string;
  notes?: string;
  photos?: { path: string; file_name: string; content_type: string; size_bytes: number }[];
  company?: string; // honeypot
  page_path?: string;
  landing_page?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  ref?: string;
};

function sign(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", process.env.CRM_INTAKE_SECRET!)
    .update(`${t}.${body}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

export async function submitEstimate(form: EstimateForm, idempotencyKey: string = randomUUID()) {
  const h = await headers();
  const client_ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const body = JSON.stringify({ ...form, client_ip });

  const res = await fetch(process.env.CRM_INTAKE_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-signature": sign(body),
      "idempotency-key": idempotencyKey,
    },
    body,
    cache: "no-store",
  });
  const json = (await res.json()) as
    | { ok: true; leadId?: string }
    | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
  return json; // show json.fieldErrors next to the inputs when ok === false
}
```

Tips:

- Generate the `idempotencyKey` once per form view (e.g. in a hidden input) and reuse it on retries.
- Keep the honeypot input (`name="company"`) visually hidden with CSS, not `type="hidden"`, so bots fill it.
- Capture `utm_*`, `gclid`, `fbclid`, `ref` and the first `landing_page`/`referrer` when the visit starts (e.g. in a cookie), then send them with the form.

## Testing with curl

```bash
SECRET='<LEAD_INTAKE_HMAC_SECRET>'
URL='http://localhost:3000/api/public/leads'
BODY='{"name":"Test Lead","phone":"(425) 555-0100","location":"98033","services":["Exterior"],"timeline":"As soon as possible","page_path":"/painters/kirkland-wa"}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)

curl -sS -X POST "$URL" \
  -H 'content-type: application/json' \
  -H "x-bb-signature: t=$T,v1=$SIG" \
  -H "idempotency-key: test-$(date +%s)" \
  --data "$BODY"
# → {"ok":true,"leadId":"…"}
```

Locally, `LEAD_INTAKE_HMAC_SECRET` comes from `.env.local`. Leads show up under Leads → Lead List right away.

## How it's tested

`tests/e2e/intake.spec.ts` runs against the real route and the local Supabase stack. It covers:

- a scored, territory-matched lead created in under 1 second
- duplicates attaching to the existing lead
- `Idempotency-Key` replays and conflicts
- bad, missing and expired signatures
- the honeypot
- field errors
- out-of-area ZIPs
- the per-visitor rate limit
- the full photo upload flow

Signature and payload unit tests are in `lib/intake/signature.test.ts`, including an openssl-computed signature vector.
