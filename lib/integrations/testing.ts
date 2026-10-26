/**
 * Test helper: a fake `fetch` that records every request and replies with
 * canned responses. Real-provider stubs are only ever exercised against this —
 * never against the network (SPEC §2.1).
 */

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
  /** Body as text when it was a string. */
  bodyText: string | undefined;
};

export type CannedResponse = {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

export type FakeFetch = typeof fetch & { readonly requests: RecordedRequest[] };

/** Responses are consumed in order; the last one repeats. A function gets the request. */
export function createFakeFetch(
  responses:
    CannedResponse | readonly CannedResponse[] | ((req: RecordedRequest) => CannedResponse),
): FakeFetch {
  const requests: RecordedRequest[] = [];
  const queue =
    typeof responses === "function"
      ? null
      : Array.isArray(responses)
        ? [...responses]
        : [responses];

  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    // SDK clients may pass a Request object instead of (url, init).
    const asRequest = typeof input === "object" && !(input instanceof URL) ? input : null;
    const body = init?.body ?? (asRequest ? await asRequest.clone().text() : undefined);
    const req: RecordedRequest = {
      url,
      method: (init?.method ?? asRequest?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers ?? asRequest?.headers),
      body,
      bodyText: typeof body === "string" ? body : undefined,
    };
    requests.push(req);
    let canned: CannedResponse;
    if (typeof responses === "function") {
      canned = responses(req);
    } else {
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      canned = next ?? { status: 200, json: {} };
    }
    const status = canned.status ?? 200;
    const payload = canned.text ?? (canned.json === undefined ? null : JSON.stringify(canned.json));
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : payload, {
      status,
      headers: { "content-type": "application/json", ...canned.headers },
    });
  };

  return Object.assign(fake as typeof fetch, { requests });
}

/** A fetch that fails the test if anything calls it. */
export function createForbiddenFetch(): typeof fetch {
  return (async () => {
    throw new Error("Network access is forbidden in this build.");
  }) as typeof fetch;
}

export function jsonBody(req: RecordedRequest | undefined): Record<string, unknown> {
  if (!req?.bodyText) throw new Error("Request had no JSON body");
  return JSON.parse(req.bodyText) as Record<string, unknown>;
}

export function formBody(req: RecordedRequest | undefined): URLSearchParams {
  if (!req?.bodyText) throw new Error("Request had no form body");
  return new URLSearchParams(req.bodyText);
}
