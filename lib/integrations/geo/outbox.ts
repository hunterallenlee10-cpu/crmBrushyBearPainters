import { notConnected } from "@/lib/integrations/core";
import { type GeoProvider } from "@/lib/integrations/geo/types";

const REASON = "Address lookup is not connected; enter the address manually.";

/** Default geo provider: nothing connected, no outbox writes (reads are not sends). */
export function createOutboxGeoProvider(): GeoProvider {
  return {
    provider: "outbox",
    async autocomplete() {
      return { ...notConnected(REASON), suggestions: [] };
    },
    async geocode() {
      return notConnected(REASON);
    },
    async distance() {
      return notConnected("Drive-time estimates are not connected.");
    },
  };
}
