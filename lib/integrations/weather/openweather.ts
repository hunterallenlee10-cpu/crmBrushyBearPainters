// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { getArray, getNumber, getString, requestJson } from "@/lib/integrations/http";
import {
  DEFAULT_FORECAST_HOURS,
  type ForecastPeriod,
  type HourlyForecastInput,
  type HourlyForecastResult,
  type WeatherProvider,
} from "@/lib/integrations/weather/types";

export type OpenWeatherConfig = {
  /** OPENWEATHER_API_KEY with a One Call API 3.0 subscription. */
  apiKey: string;
};

/** OpenWeather One Call 3.0, imperial units; `pop` 0–1 becomes 0–100. */
export class OpenWeatherProvider implements WeatherProvider {
  readonly provider = "openweather";
  private readonly fetch: typeof fetch;
  private readonly config: OpenWeatherConfig;

  constructor(options: { fetch: typeof fetch; config: OpenWeatherConfig }) {
    if (!options.config.apiKey) throw new Error("OpenWeather needs an apiKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async hourlyForecast(input: HourlyForecastInput): Promise<HourlyForecastResult> {
    const params = new URLSearchParams({
      lat: String(input.lat),
      lon: String(input.lng),
      exclude: "current,minutely,daily,alerts",
      units: "imperial",
      appid: this.config.apiKey,
    });
    const res = await requestJson(
      this.fetch,
      `https://api.openweathermap.org/data/3.0/onecall?${params.toString()}`,
      { method: "GET" },
    );
    if (!res.ok) return { connected: true, periods: [], error: res.error };

    const hours = input.hours ?? DEFAULT_FORECAST_HOURS;
    const periods: ForecastPeriod[] = [];
    for (const h of getArray(res.data, "hourly")) {
      if (periods.length >= hours) break;
      const dt = getNumber(h, "dt");
      const temp = getNumber(h, "temp");
      if (dt === undefined || temp === undefined) continue;
      const pop = getNumber(h, "pop") ?? 0;
      const shortForecast = getString(getArray(h, "weather")[0], "description");
      periods.push({
        startsAt: new Date(dt * 1000).toISOString(),
        tempF: temp,
        precipProbability: Math.round(Math.min(Math.max(pop, 0), 1) * 100),
        dewPointF: getNumber(h, "dew_point") ?? null,
        ...(shortForecast ? { shortForecast } : {}),
      });
    }
    return { connected: true, periods };
  }
}
