// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { getArray, getNumber, getRecord, getString, requestJson } from "@/lib/integrations/http";
import {
  DEFAULT_FORECAST_HOURS,
  type ForecastPeriod,
  type HourlyForecastInput,
  type HourlyForecastResult,
  type WeatherProvider,
  celsiusToFahrenheit,
} from "@/lib/integrations/weather/types";

export type NwsConfig = {
  /** Required by api.weather.gov, e.g. "(BrushyBearCRM, ops@<your-domain>)" — NWS_USER_AGENT. */
  userAgent: string;
};

const API = "https://api.weather.gov";

/** NOAA/NWS: /points/{lat},{lng} → forecastHourly URL → hourly periods. No API key. */
export class NwsWeatherProvider implements WeatherProvider {
  readonly provider = "nws";
  private readonly fetch: typeof fetch;
  private readonly config: NwsConfig;

  constructor(options: { fetch: typeof fetch; config: NwsConfig }) {
    if (!options.config.userAgent) throw new Error("NWS requires a User-Agent.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private get(url: string) {
    return requestJson(this.fetch, url, {
      method: "GET",
      headers: { "User-Agent": this.config.userAgent, Accept: "application/geo+json" },
    });
  }

  async hourlyForecast(input: HourlyForecastInput): Promise<HourlyForecastResult> {
    // NWS redirects for more than 4 decimal places.
    const lat = input.lat.toFixed(4);
    const lng = input.lng.toFixed(4);
    const points = await this.get(`${API}/points/${lat},${lng}`);
    if (!points.ok) return { connected: true, periods: [], error: points.error };

    const hourlyUrl = getString(getRecord(points.data, "properties"), "forecastHourly");
    // Only follow links back to api.weather.gov (never an arbitrary host from a response).
    if (!hourlyUrl || !hourlyUrl.startsWith(`${API}/`)) {
      return { connected: true, periods: [], error: "NWS did not return a forecastHourly URL." };
    }
    const forecast = await this.get(hourlyUrl);
    if (!forecast.ok) return { connected: true, periods: [], error: forecast.error };

    const hours = input.hours ?? DEFAULT_FORECAST_HOURS;
    const periods: ForecastPeriod[] = [];
    for (const p of getArray(getRecord(forecast.data, "properties"), "periods")) {
      if (periods.length >= hours) break;
      const startTime = getString(p, "startTime");
      const temperature = getNumber(p, "temperature");
      if (!startTime || temperature === undefined) continue;
      const tempF =
        getString(p, "temperatureUnit") === "C" ? celsiusToFahrenheit(temperature) : temperature;
      const dew = getRecord(p, "dewpoint");
      const dewValue = getNumber(dew, "value");
      const dewUnit = getString(dew, "unitCode") ?? "wmoUnit:degC";
      const dewPointF =
        dewValue === undefined
          ? null
          : dewUnit.endsWith("degF")
            ? dewValue
            : celsiusToFahrenheit(dewValue);
      const shortForecast = getString(p, "shortForecast");
      periods.push({
        startsAt: new Date(startTime).toISOString(),
        tempF,
        precipProbability: getNumber(getRecord(p, "probabilityOfPrecipitation"), "value") ?? 0,
        dewPointF,
        ...(shortForecast ? { shortForecast } : {}),
      });
    }
    return { connected: true, periods };
  }
}
