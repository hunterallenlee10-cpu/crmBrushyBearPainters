import { type NotConnected } from "@/lib/integrations/core";

/** Hourly weather for exterior and deck days (rain probability, dew point). Reads only. */

export type HourlyForecastInput = { lat: number; lng: number; hours?: number };

export type ForecastPeriod = {
  /** ISO 8601 instant (UTC). */
  startsAt: string;
  tempF: number;
  /** 0–100. */
  precipProbability: number;
  /** null when the provider omits it. */
  dewPointF: number | null;
  shortForecast?: string;
};

export type HourlyForecastResult =
  NotConnected | { connected: true; periods: ForecastPeriod[]; error?: string };

export interface WeatherProvider {
  readonly provider: string;
  hourlyForecast(input: HourlyForecastInput): Promise<HourlyForecastResult>;
}

export const DEFAULT_FORECAST_HOURS = 48;

export function celsiusToFahrenheit(c: number): number {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}
