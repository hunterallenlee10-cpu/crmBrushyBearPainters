// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  asArray,
  getArray,
  getNumber,
  getRecord,
  getString,
  requestJson,
} from "@/lib/integrations/http";
import {
  type CreatePhotoProjectInput,
  type CreatePhotoProjectResult,
  type ListPhotosInput,
  type ListPhotosResult,
  type PhotoSyncProvider,
  type SyncedPhoto,
} from "@/lib/integrations/photos/types";

export type CompanyCamConfig = {
  /** COMPANYCAM_API_TOKEN (access token from the CompanyCam developer portal / OAuth). */
  apiToken: string;
  /** Page size for photo listing (max 100). */
  perPage?: number;
};

const API = "https://api.companycam.com/v2";

export class CompanyCamPhotoProvider implements PhotoSyncProvider {
  readonly provider = "companycam";
  private readonly fetch: typeof fetch;
  private readonly config: CompanyCamConfig;

  constructor(options: { fetch: typeof fetch; config: CompanyCamConfig }) {
    if (!options.config.apiToken) throw new Error("CompanyCam needs an apiToken.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async listPhotos(input: ListPhotosInput): Promise<ListPhotosResult> {
    const params = new URLSearchParams({ per_page: String(this.config.perPage ?? 100) });
    if (input.since) {
      params.set("start_date", String(Math.floor(new Date(input.since).getTime() / 1000)));
    }
    const url = `${API}/projects/${encodeURIComponent(input.projectExternalId)}/photos?${params.toString()}`;
    const res = await requestJson(this.fetch, url, { method: "GET", headers: this.headers() });
    if (!res.ok) return { connected: true, photos: [], error: res.error };

    const photos: SyncedPhoto[] = [];
    for (const p of asArray(res.data)) {
      const id = getString(p, "id") ?? getNumber(p, "id")?.toString();
      const uris = getArray(p, "uris");
      const uriOf = (type: string) => {
        const match = uris.find((u) => getString(u, "type") === type);
        return getString(match, "uri") ?? getString(match, "url");
      };
      const url = uriOf("original") ?? uriOf("web");
      if (!id || !url) continue;
      const captured = getNumber(p, "captured_at");
      const coords = getRecord(p, "coordinates");
      const lat = getNumber(coords, "lat");
      const lng = getNumber(coords, "lon");
      const thumbnailUrl = uriOf("thumbnail");
      const caption = getString(p, "description");
      photos.push({
        externalId: id,
        url,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(captured !== undefined ? { takenAt: new Date(captured * 1000).toISOString() } : {}),
        ...(caption ? { caption } : {}),
        ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
      });
    }
    return { connected: true, photos };
  }

  async createProject(input: CreatePhotoProjectInput): Promise<CreatePhotoProjectResult> {
    const a = input.address;
    const body = {
      project: {
        name: input.name,
        address: {
          street_address_1: a.street1,
          ...(a.street2 ? { street_address_2: a.street2 } : {}),
          city: a.city,
          state: a.state,
          postal_code: a.postalCode,
          country: a.country ?? "US",
        },
      },
    };
    const res = await requestJson(this.fetch, `${API}/projects`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    const id = getString(res.data, "id") ?? getNumber(res.data, "id")?.toString();
    return { status: "sent", externalId: id };
  }
}
