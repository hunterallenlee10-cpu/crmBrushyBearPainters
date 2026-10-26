import { type NotConnected } from "@/lib/integrations/core";

/**
 * Address & maps. Reads only: the disconnected provider returns
 * `connected: false` (manual address entry) and writes nothing to the outbox.
 */

export type LatLng = { lat: number; lng: number };

export type AddressSuggestion = {
  /** Provider place id; pass to geocode via its description. */
  id: string;
  description: string;
};

export type GeocodeResult = LatLng & {
  formatted: string;
  zip?: string;
  city?: string;
};

export type AutocompleteResult =
  | (NotConnected & { suggestions: [] })
  | { connected: true; suggestions: AddressSuggestion[]; error?: string };

export type GeocodeLookup =
  NotConnected | { connected: true; result?: GeocodeResult; error?: string };

export type DistanceResult =
  NotConnected | { connected: true; meters?: number; seconds?: number; error?: string };

export interface GeoProvider {
  readonly provider: string;
  autocomplete(query: string): Promise<AutocompleteResult>;
  geocode(address: string): Promise<GeocodeLookup>;
  /** Driving distance/time between two points. */
  distance(origin: LatLng, destination: LatLng): Promise<DistanceResult>;
}
