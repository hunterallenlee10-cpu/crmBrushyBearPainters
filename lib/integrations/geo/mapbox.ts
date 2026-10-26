// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type AddressSuggestion,
  type AutocompleteResult,
  type DistanceResult,
  type GeoProvider,
  type GeocodeLookup,
  type GeocodeResult,
  type LatLng,
} from "@/lib/integrations/geo/types";
import { getArray, getNumber, getRecord, getString, requestJson } from "@/lib/integrations/http";

export type MapboxConfig = {
  /** MAPBOX_ACCESS_TOKEN (public "pk." token restricted to the app's URLs). */
  accessToken: string;
  /** Optional proximity bias for autocomplete. */
  proximity?: LatLng;
};

/** Mapbox Geocoding API v6 (forward) + Matrix API v1 (driving). */
export class MapboxGeoProvider implements GeoProvider {
  readonly provider = "mapbox";
  private readonly fetch: typeof fetch;
  private readonly config: MapboxConfig;

  constructor(options: { fetch: typeof fetch; config: MapboxConfig }) {
    if (!options.config.accessToken) throw new Error("Mapbox needs an accessToken.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private forwardUrl(q: string, autocomplete: boolean, limit: number): string {
    const params = new URLSearchParams({
      q,
      country: "us",
      types: "address",
      limit: String(limit),
      autocomplete: String(autocomplete),
      access_token: this.config.accessToken,
    });
    if (this.config.proximity) {
      params.set("proximity", `${this.config.proximity.lng},${this.config.proximity.lat}`);
    }
    return `https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`;
  }

  async autocomplete(query: string): Promise<AutocompleteResult> {
    const res = await requestJson(this.fetch, this.forwardUrl(query, true, 5), { method: "GET" });
    if (!res.ok) return { connected: true, suggestions: [], error: res.error };
    const suggestions: AddressSuggestion[] = [];
    for (const feature of getArray(res.data, "features")) {
      const props = getRecord(feature, "properties");
      const id = getString(props, "mapbox_id") ?? getString(feature, "id");
      const description = getString(props, "full_address");
      if (id && description) suggestions.push({ id, description });
    }
    return { connected: true, suggestions };
  }

  async geocode(address: string): Promise<GeocodeLookup> {
    const res = await requestJson(this.fetch, this.forwardUrl(address, false, 1), {
      method: "GET",
    });
    if (!res.ok) return { connected: true, error: res.error };
    const feature = getArray(res.data, "features")[0];
    if (!feature) return { connected: true };
    const props = getRecord(feature, "properties");
    const coords = getRecord(props, "coordinates");
    const lat = getNumber(coords, "latitude");
    const lng = getNumber(coords, "longitude");
    if (lat === undefined || lng === undefined) return { connected: true };
    const context = getRecord(props, "context");
    const zip = getString(getRecord(context, "postcode"), "name");
    const city = getString(getRecord(context, "place"), "name");
    const result: GeocodeResult = {
      lat,
      lng,
      formatted: getString(props, "full_address") ?? address,
      ...(zip ? { zip } : {}),
      ...(city ? { city } : {}),
    };
    return { connected: true, result };
  }

  async distance(origin: LatLng, destination: LatLng): Promise<DistanceResult> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const params = new URLSearchParams({
      sources: "0",
      destinations: "1",
      annotations: "distance,duration",
      access_token: this.config.accessToken,
    });
    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?${params.toString()}`;
    const res = await requestJson(this.fetch, url, { method: "GET" });
    if (!res.ok) return { connected: true, error: res.error };
    if (getString(res.data, "code") !== "Ok") {
      return { connected: true, error: getString(res.data, "message") ?? "Matrix request failed" };
    }
    const first = (key: string): number | undefined => {
      const row = getArray(res.data, key)[0];
      const v = Array.isArray(row) ? (row[0] as unknown) : undefined;
      return typeof v === "number" ? Math.round(v) : undefined;
    };
    const meters = first("distances");
    const seconds = first("durations");
    return {
      connected: true,
      ...(meters !== undefined ? { meters } : {}),
      ...(seconds !== undefined ? { seconds } : {}),
    };
  }
}
