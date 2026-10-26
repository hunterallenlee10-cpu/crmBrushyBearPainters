// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import {
  type AddressSuggestion,
  type AutocompleteResult,
  type DistanceResult,
  type GeoProvider,
  type GeocodeLookup,
  type LatLng,
} from "@/lib/integrations/geo/types";
import {
  getArray,
  getNumber,
  getRecord,
  getString,
  providerErrorMessage,
  requestJson,
} from "@/lib/integrations/http";

export type GooglePlacesConfig = {
  /** GOOGLE_MAPS_API_KEY with Places API (New), Geocoding API and Routes API enabled. */
  apiKey: string;
  /** Optional autocomplete bias (e.g. the service-area centre the owners choose). */
  biasCenter?: LatLng;
  biasRadiusMeters?: number;
};

/**
 * Google Maps Platform: Places API (New) autocomplete, Geocoding API, and
 * Routes API computeRoutes for drive distance/time.
 */
export class GooglePlacesGeoProvider implements GeoProvider {
  readonly provider = "google_places";
  private readonly fetch: typeof fetch;
  private readonly config: GooglePlacesConfig;

  constructor(options: { fetch: typeof fetch; config: GooglePlacesConfig }) {
    if (!options.config.apiKey) throw new Error("Google Places needs an apiKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async autocomplete(query: string): Promise<AutocompleteResult> {
    const body: Record<string, unknown> = { input: query, includedRegionCodes: ["us"] };
    if (this.config.biasCenter) {
      body.locationBias = {
        circle: {
          center: {
            latitude: this.config.biasCenter.lat,
            longitude: this.config.biasCenter.lng,
          },
          radius: this.config.biasRadiusMeters ?? 30000,
        },
      };
    }
    const res = await requestJson(
      this.fetch,
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.config.apiKey },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return { connected: true, suggestions: [], error: res.error };
    const suggestions: AddressSuggestion[] = [];
    for (const s of getArray(res.data, "suggestions")) {
      const prediction = getRecord(s, "placePrediction");
      const id = getString(prediction, "placeId");
      const text = getString(getRecord(prediction, "text"), "text");
      if (id && text) suggestions.push({ id, description: text });
    }
    return { connected: true, suggestions };
  }

  async geocode(address: string): Promise<GeocodeLookup> {
    const params = new URLSearchParams({ address, key: this.config.apiKey });
    const res = await requestJson(
      this.fetch,
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
      { method: "GET" },
    );
    if (!res.ok) return { connected: true, error: res.error };
    // Geocoding returns 200 with a status field for "no results" and auth problems.
    const status = getString(res.data, "status");
    if (status === "ZERO_RESULTS") return { connected: true };
    if (status !== "OK") {
      const message = getString(res.data, "error_message") ?? status ?? "unknown status";
      return { connected: true, error: providerErrorMessage(200, { message }) };
    }
    const first = getArray(res.data, "results")[0];
    const location = getRecord(getRecord(first, "geometry"), "location");
    const lat = getNumber(location, "lat");
    const lng = getNumber(location, "lng");
    if (lat === undefined || lng === undefined) return { connected: true };
    const components = getArray(first, "address_components");
    const component = (type: string) =>
      getString(
        components.find((c) => getArray(c, "types").includes(type)),
        "long_name",
      );
    const zip = component("postal_code");
    const city = component("locality");
    return {
      connected: true,
      result: {
        lat,
        lng,
        formatted: getString(first, "formatted_address") ?? address,
        ...(zip ? { zip } : {}),
        ...(city ? { city } : {}),
      },
    };
  }

  async distance(origin: LatLng, destination: LatLng): Promise<DistanceResult> {
    const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const res = await requestJson(
      this.fetch,
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.config.apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: point(origin),
          destination: point(destination),
          travelMode: "DRIVE",
        }),
      },
    );
    if (!res.ok) return { connected: true, error: res.error };
    const route = getArray(res.data, "routes")[0];
    const meters = getNumber(route, "distanceMeters");
    const duration = getString(route, "duration"); // e.g. "1234s"
    const seconds =
      duration && /^\d+(\.\d+)?s$/.test(duration) ? Math.round(parseFloat(duration)) : undefined;
    return {
      connected: true,
      ...(meters !== undefined ? { meters } : {}),
      ...(seconds !== undefined ? { seconds } : {}),
    };
  }
}
