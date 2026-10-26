import { notConnected } from "@/lib/integrations/core";
import { type WeatherProvider } from "@/lib/integrations/weather/types";

/** Default weather provider: not connected, no outbox writes (reads are not sends). */
export function createOutboxWeatherProvider(): WeatherProvider {
  return {
    provider: "outbox",
    async hourlyForecast() {
      return notConnected("Weather is not connected; check the forecast manually.");
    },
  };
}
