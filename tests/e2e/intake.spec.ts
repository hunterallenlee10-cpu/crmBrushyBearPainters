import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { signatureHeader } from "../../lib/intake/signature";
import { adminClient } from "./support/users";

/**
 * Website → CRM lead intake (SPEC §14), exercised through the real route
 * against the local Supabase stack. Phase 2 "done when": payload → lead in < 1 s,
 * and the duplicate test passes.
 */

const SECRET = process.env.LEAD_INTAKE_HMAC_SECRET ?? "";
const uniq = () => randomUUID().slice(0, 8);
/** A random 425 number per test, so tests never collide with each other. */
const phone = () =>
  `(425) 55${Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

async function post(
  request: APIRequestContext,
  body: Record<string, unknown>,
  opts: { key?: string; secret?: string; signature?: string; path?: string } = {},
) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-bb-signature": opts.signature ?? signatureHeader(opts.secret ?? SECRET, raw),
  };
  if (opts.key) headers["idempotency-key"] = opts.key;
  return request.post(opts.path ?? "/api/public/leads", { data: raw, headers });
}

test.describe("website lead intake", () => {
  test.skip(({ isMobile }) => isMobile, "API test: runs once on desktop");
  test.skip(!SECRET, "LEAD_INTAKE_HMAC_SECRET is not set for this run");

  test("creates a scored, territory-matched lead in under a second", async ({ request }) => {
    const name = `Wendy Web ${uniq()}`;
    // Warm the route first (the dev server compiles on first use); this request is refused (422).
    await post(request, { name: "warm-up" });
    const started = Date.now();
    const res = await post(request, {
      name,
      phone: phone(),
      email: `wendy-${uniq()}@example.com`,
      location: "123 Main St, Kirkland, WA 98033",
      services: ["Exterior", "Deck or fence"],
      timeline: "As soon as possible",
      home_built: "Before 1978",
      notes: "Peeling on the south side.",
      page_path: "/painters/kirkland-wa",
      utm_source: "google",
      utm_medium: "cpc",
      client_ip: ip(),
    });
    const elapsed = Date.now() - started;
    expect(res.status()).toBe(201);
    const json = (await res.json()) as { ok: boolean; leadId: string };
    expect(Object.keys(json).sort()).toEqual(["leadId", "ok"]); // no personal data echoed
    expect(elapsed, "website payload → lead in < 1 s").toBeLessThan(1000);
    test.info().annotations.push({ type: "intake latency (ms)", description: String(elapsed) });

    const { data: lead } = await adminClient()
      .from("leads")
      .select(
        "first_name, last_name, mobile, zip, city, out_of_area, services, timeline, home_built, lead_source, lead_sub_source, intake_channel, score, grade, temperature, score_factors, status, territory_id",
      )
      .eq("id", json.leadId)
      .single();
    expect(lead).toMatchObject({
      first_name: "Wendy Web",
      zip: "98033",
      city: "Kirkland",
      out_of_area: false,
      services: ["exterior", "deck_fence"],
      timeline: "asap",
      home_built: "before_1978",
      lead_source: "website",
      lead_sub_source: "google_ads",
      intake_channel: "website",
      status: "new",
      grade: "A",
      temperature: "hot",
    });
    expect(lead?.mobile).toMatch(/^\+1425/);
    expect(lead?.territory_id).not.toBeNull();
    expect(lead?.score).toBe(93); // 50 +10 area +5 mobile +3 email +5 address +15 ASAP +5 exterior
    const { count } = await adminClient()
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("type", "lead.created")
      .eq("aggregate_id", json.leadId);
    expect(count).toBe(1);
  });

  test("a repeat submission (same phone) attaches to the existing lead", async ({ request }) => {
    const p = phone();
    const first = await post(request, {
      name: "Dana Dup",
      phone: p,
      location: "98052",
      client_ip: ip(),
    });
    expect(first.status()).toBe(201);
    const { leadId } = (await first.json()) as { leadId: string };

    const again = await post(request, {
      name: "Dana Dup",
      phone: p.replace(/[()\s-]/g, ""),
      email: `dana-${uniq()}@example.com`,
      services: ["Interior"],
      notes: "Also the hallway.",
      client_ip: ip(),
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { leadId: string }).leadId).toBe(leadId);

    const db = adminClient();
    const { count } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("mobile", `+1${p.replace(/\D/g, "")}`);
    expect(count, "no second lead").toBe(1);
    const { data: msgs } = await db
      .from("messages")
      .select("channel, direction, body")
      .eq("subject_type", "lead")
      .eq("subject_id", leadId);
    expect(msgs).toHaveLength(1);
    expect(msgs?.[0]).toMatchObject({ channel: "portal", direction: "inbound" });
    expect(msgs?.[0]?.body).toContain("Also the hallway.");
    const { data: lead } = await db.from("leads").select("email").eq("id", leadId).single();
    expect(lead?.email, "missing email filled in").toMatch(/^dana-/);
  });

  test("Idempotency-Key replays return the same lead; reuse with a new body is refused", async ({
    request,
  }) => {
    const key = `test-${uniq()}-${uniq()}`;
    const body = { name: "Ivy Idem", email: `ivy-${uniq()}@example.com`, client_ip: ip() };
    const a = await post(request, body, { key });
    const b = await post(request, body, { key });
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(200);
    expect(((await b.json()) as { leadId: string }).leadId).toBe(
      ((await a.json()) as { leadId: string }).leadId,
    );
    const c = await post(request, { ...body, notes: "changed" }, { key });
    expect(c.status()).toBe(409);
  });

  test("refuses bad, missing and expired signatures", async ({ request }) => {
    const body = { name: "Mallory", email: "m@example.com" };
    expect(
      (await post(request, body, { secret: "wrong-secret-wrong-secret-wrong-secret" })).status(),
    ).toBe(401);
    expect((await post(request, body, { signature: "" })).status()).toBe(401);
    const raw = JSON.stringify(body);
    const old = signatureHeader(SECRET, raw, new Date(Date.now() - 10 * 60 * 1000));
    const res = await post(request, body, { signature: old });
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { error: string }).error).toContain("expired");
  });

  test("honeypot submissions look successful but store nothing", async ({ request }) => {
    const email = `bot-${uniq()}@example.com`;
    const res = await post(request, { name: "Bot", email, company: "Acme SEO", client_ip: ip() });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { count } = await adminClient()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("email", email);
    expect(count).toBe(0);
  });

  test("validates the payload with field errors", async ({ request }) => {
    const noContact = await post(request, { name: "Nobody", client_ip: ip() });
    expect(noContact.status()).toBe(422);
    expect(
      ((await noContact.json()) as { fieldErrors: Record<string, string[]> }).fieldErrors.phone,
    ).toBeDefined();
    const unknownField = await post(request, { name: "X", email: "x@example.com", admin: true });
    expect(unknownField.status()).toBe(422);
  });

  test("out-of-area ZIPs are flagged, not rejected", async ({ request }) => {
    const res = await post(request, {
      name: "Sam Seattle",
      phone: phone(),
      location: "98101",
      client_ip: ip(),
    });
    expect(res.status()).toBe(201);
    const { leadId } = (await res.json()) as { leadId: string };
    const { data } = await adminClient()
      .from("leads")
      .select("out_of_area, territory_id, score_factors")
      .eq("id", leadId)
      .single();
    expect(data?.out_of_area).toBe(true);
    expect(data?.territory_id).toBeNull();
    expect(JSON.stringify(data?.score_factors)).toContain("out_of_area");
  });

  test("rate-limits a visitor after 5 submissions in 10 minutes", async ({ request }) => {
    const visitor = ip().replace("198.51.100", "203.0.113");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(request, {
        name: `Rita ${i}`,
        email: `rita-${uniq()}@example.com`,
        client_ip: visitor,
      });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  test("photos: signed upload URL → upload → attached to the lead", async ({ request }) => {
    const up = await post(
      request,
      { file_name: "south side.jpg", content_type: "image/jpeg", size_bytes: 4, client_ip: ip() },
      { path: "/api/public/leads/upload-url" },
    );
    expect(up.status()).toBe(201);
    const { path, token } = (await up.json()) as { path: string; token: string };
    expect(path).toMatch(/\/south-side\.jpg$/);
    const { error } = await adminClient()
      .storage.from("lead-attachments")
      .uploadToSignedUrl(
        path,
        token,
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
      );
    expect(error).toBeNull();

    const res = await post(request, {
      name: "Pia Photo",
      email: `pia-${uniq()}@example.com`,
      photos: [{ path, file_name: "south side.jpg", content_type: "image/jpeg", size_bytes: 4 }],
      client_ip: ip(),
    });
    expect(res.status()).toBe(201);
    const { leadId } = (await res.json()) as { leadId: string };
    const { data } = await adminClient()
      .from("lead_attachments")
      .select("storage_path, source")
      .eq("lead_id", leadId);
    expect(data).toEqual([{ storage_path: path, source: "website" }]);

    // A path that was never uploaded is ignored (no attachment, lead still created).
    const fake = `${path.split("/")[0]}/${randomUUID()}/nope.jpg`;
    const res2 = await post(request, {
      name: "Fay Fake",
      email: `fay-${uniq()}@example.com`,
      photos: [{ path: fake, file_name: "nope.jpg", content_type: "image/jpeg", size_bytes: 4 }],
      client_ip: ip(),
    });
    expect(res2.status()).toBe(201);
    const id2 = ((await res2.json()) as { leadId: string }).leadId;
    const { count } = await adminClient()
      .from("lead_attachments")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", id2);
    expect(count).toBe(0);
  });
});
