import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  GooglePlacesGeoProvider,
  MapboxGeoProvider,
  createOutboxGeoProvider,
  getGeoProvider,
} from "@/lib/integrations/geo";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const a = { lat: 47.61, lng: -122.2 };
const b = { lat: 47.67, lng: -122.12 };

describe("outbox geo provider", () => {
  it("is not connected and never writes to the outbox", async () => {
    const sink = createMemoryOutboxSink();
    const geo = getGeoProvider({ orgId: "o", sink });
    expect(geo.provider).toBe("outbox");
    expect(await geo.autocomplete("123 Sample")).toEqual({
      connected: false,
      reason: expect.stringMatching(/manually/),
      suggestions: [],
    });
    expect(await geo.geocode("123 Sample St")).toMatchObject({ connected: false });
    expect(await geo.distance(a, b)).toMatchObject({ connected: false });
    expect(sink.entries).toHaveLength(0);
    expect(createOutboxGeoProvider().provider).toBe("outbox");
  });
});

describe("GooglePlacesGeoProvider (disabled stub)", () => {
  const config = { apiKey: "gm-key", biasCenter: a, biasRadiusMeters: 20000 };

  it("autocompletes with Places API (New)", async () => {
    const fetch = createFakeFetch({
      json: {
        suggestions: [
          {
            placePrediction: { placeId: "pl-1", text: { text: "123 Sample St, Anytown, WA, USA" } },
          },
          { queryPrediction: { text: { text: "ignored" } } },
        ],
      },
    });
    const result = await new GooglePlacesGeoProvider({ fetch, config }).autocomplete("123 Sam");
    expect(result).toEqual({
      connected: true,
      suggestions: [{ id: "pl-1", description: "123 Sample St, Anytown, WA, USA" }],
    });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(req?.headers.get("x-goog-api-key")).toBe("gm-key");
    expect(jsonBody(req)).toEqual({
      input: "123 Sam",
      includedRegionCodes: ["us"],
      locationBias: {
        circle: { center: { latitude: 47.61, longitude: -122.2 }, radius: 20000 },
      },
    });
  });

  it("geocodes with the Geocoding API", async () => {
    const fetch = createFakeFetch({
      json: {
        status: "OK",
        results: [
          {
            formatted_address: "123 Sample St, Anytown, WA 98000, USA",
            geometry: { location: { lat: 47.6, lng: -122.1 } },
            address_components: [
              { long_name: "Anytown", short_name: "Anytown", types: ["locality", "political"] },
              { long_name: "98000", short_name: "98000", types: ["postal_code"] },
            ],
          },
        ],
      },
    });
    const result = await new GooglePlacesGeoProvider({ fetch, config }).geocode("123 Sample St");
    expect(result).toEqual({
      connected: true,
      result: {
        lat: 47.6,
        lng: -122.1,
        formatted: "123 Sample St, Anytown, WA 98000, USA",
        zip: "98000",
        city: "Anytown",
      },
    });
    const url = new URL(fetch.requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("123 Sample St");
    expect(url.searchParams.get("key")).toBe("gm-key");
  });

  it("handles ZERO_RESULTS and REQUEST_DENIED", async () => {
    const none = createFakeFetch({ json: { status: "ZERO_RESULTS", results: [] } });
    expect(await new GooglePlacesGeoProvider({ fetch: none, config }).geocode("x")).toEqual({
      connected: true,
    });
    const denied = createFakeFetch({
      json: { status: "REQUEST_DENIED", error_message: "The provided API key is invalid." },
    });
    expect(await new GooglePlacesGeoProvider({ fetch: denied, config }).geocode("x")).toEqual({
      connected: true,
      error: "HTTP 200: The provided API key is invalid.",
    });
  });

  it("computes drive distance with the Routes API", async () => {
    const fetch = createFakeFetch({
      json: { routes: [{ distanceMeters: 9876, duration: "845s" }] },
    });
    const result = await new GooglePlacesGeoProvider({ fetch, config }).distance(a, b);
    expect(result).toEqual({ connected: true, meters: 9876, seconds: 845 });
    const req = fetch.requests[0];
    expect(req?.url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(req?.headers.get("x-goog-fieldmask")).toBe("routes.distanceMeters,routes.duration");
    expect(jsonBody(req)).toEqual({
      origin: { location: { latLng: { latitude: 47.61, longitude: -122.2 } } },
      destination: { location: { latLng: { latitude: 47.67, longitude: -122.12 } } },
      travelMode: "DRIVE",
    });
  });

  it("maps HTTP errors", async () => {
    const fetch = createFakeFetch({
      status: 403,
      json: { error: { code: 403, message: "API key not valid.", status: "PERMISSION_DENIED" } },
    });
    const google = new GooglePlacesGeoProvider({ fetch, config });
    expect(await google.autocomplete("x")).toEqual({
      connected: true,
      suggestions: [],
      error: "HTTP 403: API key not valid.",
    });
    expect(await google.distance(a, b)).toEqual({
      connected: true,
      error: "HTTP 403: API key not valid.",
    });
  });
});

describe("MapboxGeoProvider (disabled stub)", () => {
  const config = { accessToken: "pk.test", proximity: a };
  const feature = {
    type: "Feature",
    id: "dXJu",
    geometry: { type: "Point", coordinates: [-122.1, 47.6] },
    properties: {
      mapbox_id: "dXJu",
      full_address: "123 Sample St, Anytown, Washington 98000, United States",
      coordinates: { longitude: -122.1, latitude: 47.6 },
      context: { postcode: { name: "98000" }, place: { name: "Anytown" } },
    },
  };

  it("autocompletes with Geocoding v6", async () => {
    const fetch = createFakeFetch({ json: { type: "FeatureCollection", features: [feature] } });
    const result = await new MapboxGeoProvider({ fetch, config }).autocomplete("123 Sam");
    expect(result).toEqual({
      connected: true,
      suggestions: [{ id: "dXJu", description: feature.properties.full_address }],
    });
    const url = new URL(fetch.requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.mapbox.com/search/geocode/v6/forward");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "123 Sam",
      country: "us",
      types: "address",
      limit: "5",
      autocomplete: "true",
      access_token: "pk.test",
      proximity: "-122.2,47.61",
    });
  });

  it("geocodes a single address", async () => {
    const fetch = createFakeFetch({ json: { features: [feature] } });
    expect(await new MapboxGeoProvider({ fetch, config }).geocode("123 Sample St")).toEqual({
      connected: true,
      result: {
        lat: 47.6,
        lng: -122.1,
        formatted: feature.properties.full_address,
        zip: "98000",
        city: "Anytown",
      },
    });
    const url = new URL(fetch.requests[0]?.url ?? "");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("autocomplete")).toBe("false");
  });

  it("gets driving distance from the Matrix API", async () => {
    const fetch = createFakeFetch({
      json: { code: "Ok", distances: [[10234.6]], durations: [[901.2]] },
    });
    expect(await new MapboxGeoProvider({ fetch, config }).distance(a, b)).toEqual({
      connected: true,
      meters: 10235,
      seconds: 901,
    });
    const url = new URL(fetch.requests[0]?.url ?? "");
    expect(url.pathname).toBe("/directions-matrix/v1/mapbox/driving/-122.2,47.61;-122.12,47.67");
    expect(url.searchParams.get("annotations")).toBe("distance,duration");
    expect(url.searchParams.get("sources")).toBe("0");
    expect(url.searchParams.get("destinations")).toBe("1");
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({
      status: 401,
      json: { message: "Not Authorized - Invalid Token" },
    });
    const mapbox = new MapboxGeoProvider({ fetch, config });
    expect(await mapbox.geocode("x")).toEqual({
      connected: true,
      error: "HTTP 401: Not Authorized - Invalid Token",
    });
    const noRoute = createFakeFetch({ json: { code: "NoRoute", message: "No route found" } });
    expect(await new MapboxGeoProvider({ fetch: noRoute, config }).distance(a, b)).toEqual({
      connected: true,
      error: "No route found",
    });
  });
});

describe("getGeoProvider", () => {
  it("only returns real providers when fully allowed", () => {
    const base = {
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { google_places: { apiKey: "k" }, mapbox: { accessToken: "pk" } },
    };
    expect(getGeoProvider(null, { ...base, envProvider: "mapbox" }).provider).toBe("outbox");
    expect(getGeoProvider(null, { ...base, envProvider: "mapbox", locked: false })).toBeInstanceOf(
      MapboxGeoProvider,
    );
    expect(
      getGeoProvider(null, { ...base, envProvider: "google_places", locked: false }),
    ).toBeInstanceOf(GooglePlacesGeoProvider);
  });
});
