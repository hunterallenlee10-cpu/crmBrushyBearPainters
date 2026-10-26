import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import {
  type GooglePlacesConfig,
  GooglePlacesGeoProvider,
} from "@/lib/integrations/geo/google-places";
import { type MapboxConfig, MapboxGeoProvider } from "@/lib/integrations/geo/mapbox";
import { createOutboxGeoProvider } from "@/lib/integrations/geo/outbox";
import { type GeoProvider } from "@/lib/integrations/geo/types";

export * from "@/lib/integrations/geo/types";
export { createOutboxGeoProvider } from "@/lib/integrations/geo/outbox";
export {
  GooglePlacesGeoProvider,
  type GooglePlacesConfig,
} from "@/lib/integrations/geo/google-places";
export { MapboxGeoProvider, type MapboxConfig } from "@/lib/integrations/geo/mapbox";

export type GeoCredentials = { google_places?: GooglePlacesConfig; mapbox?: MapboxConfig };
export type GeoProviderOptions = ProviderFactoryOptions<GeoCredentials>;

/**
 * Geo provider. Reads never touch the outbox, so no context is needed; the
 * parameter is kept for a uniform factory signature.
 */
export function getGeoProvider(
  _ctx: IntegrationContext | null,
  options: GeoProviderOptions = {},
): GeoProvider {
  const choice = resolveDomainProvider("geo", options);
  if (!choice.real) return createOutboxGeoProvider();
  switch (choice.provider) {
    case "google_places":
      return new GooglePlacesGeoProvider(
        requireRealDeps("google_places", options.fetch, options.credentials?.google_places),
      );
    case "mapbox":
      return new MapboxGeoProvider(
        requireRealDeps("mapbox", options.fetch, options.credentials?.mapbox),
      );
    default:
      throw new Error(`No geo adapter for "${choice.provider}".`);
  }
}
