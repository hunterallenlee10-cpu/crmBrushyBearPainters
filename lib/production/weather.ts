import "server-only";
import { getWeatherProvider } from "@/lib/integrations/weather";

/**
 * Weather for exterior and deck days (SPEC §8.6 Weather panel). Disconnected
 * in this build: the provider answers "not connected" without any request, so
 * the scheduler's rain rule and the Weather Risk attention rule stay dormant
 * and the panel offers a manual rain delay instead.
 */
export type WeatherStatus = { connected: boolean; reason: string | null };

export async function loadWeather(): Promise<WeatherStatus> {
  // No `fetch` and no credentials: even a wrongly chosen real provider couldn't call out.
  const provider = getWeatherProvider(null, {});
  const result = await provider.hourlyForecast({ lat: 47.61, lng: -122.2, hours: 1 });
  if (!result.connected) return { connected: false, reason: result.reason };
  return { connected: true, reason: null };
}
