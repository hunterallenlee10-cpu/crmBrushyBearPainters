/**
 * Tiny HTTP helpers shared by the disabled real-provider stubs. Every stub takes
 * an injected `fetch`, so tests run against a fake and nothing ever reaches the
 * network in this build (SPEC §2.1).
 *
 * HTTP and network failures never throw: they come back as `{ ok: false, error }`
 * so adapters can map them into `{ status: "failed", error }`.
 */

export type HttpResult =
  | { ok: true; status: number; data: unknown; headers: Headers }
  | { ok: false; status: number; error: string; data: unknown };

export async function requestJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${messageOf(err)}`, data: null };
  }
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  if (text !== "") {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: providerErrorMessage(response.status, data),
      data,
    };
  }
  return { ok: true, status: response.status, data, headers: response.headers };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getArray(obj: unknown, key: string): unknown[] {
  return asArray(asRecord(obj)?.[key]);
}

export function getString(obj: unknown, key: string): string | undefined {
  const v = asRecord(obj)?.[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(obj: unknown, key: string): number | undefined {
  const v = asRecord(obj)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function getRecord(obj: unknown, key: string): Record<string, unknown> | undefined {
  return asRecord(asRecord(obj)?.[key]);
}

/** Pull a readable message out of the error shapes our providers use. */
export function providerErrorMessage(status: number, data: unknown): string {
  const prefix = `HTTP ${status}`;
  if (typeof data === "string" && data.trim() !== "") return `${prefix}: ${data.slice(0, 300)}`;
  const obj = asRecord(data);
  if (!obj) return prefix;

  // { error: { message } } — Stripe, Google, Anthropic; { error: { error_msg } } — Dropbox Sign
  const nested = getRecord(obj, "error");
  const nestedMsg = getString(nested, "message") ?? getString(nested, "error_msg");
  if (nestedMsg) return `${prefix}: ${nestedMsg}`;
  // { message } — Twilio, Resend, Mapbox, OpenWeather, DocuSign
  const message = getString(obj, "message");
  if (message) return `${prefix}: ${message}`;
  // { error: "..." } / { detail } — misc, NWS (problem+json)
  const errStr = getString(obj, "error") ?? getString(obj, "detail") ?? getString(obj, "title");
  if (errStr) return `${prefix}: ${errStr}`;
  // { errors: [{ message }] } — SendGrid; { errors: ["..."] } — CompanyCam
  const first = asArray(obj["errors"])[0];
  const firstMsg = typeof first === "string" ? first : getString(first, "message");
  if (firstMsg) return `${prefix}: ${firstMsg}`;
  // { Fault: { Error: [{ Message, Detail }] } } — QuickBooks Online
  const qbo = asArray(getRecord(obj, "Fault")?.["Error"])[0];
  const qboMsg = getString(qbo, "Detail") ?? getString(qbo, "Message");
  if (qboMsg) return `${prefix}: ${qboMsg}`;
  return prefix;
}
