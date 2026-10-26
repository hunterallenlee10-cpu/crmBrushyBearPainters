import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import { type NwsConfig, NwsWeatherProvider } from "@/lib/integrations/weather/nws";
import {
  type OpenWeatherConfig,
  OpenWeatherProvider,
} from "@/lib/integrations/weather/openweather";
import { createOutboxWeatherProvider } from "@/lib/integrations/weather/outbox";
import { type WeatherProvider } from "@/lib/integrations/weather/types";

export * from "@/lib/integrations/weather/types";
export { createOutboxWeatherProvider } from "@/lib/integrations/weather/outbox";
export { NwsWeatherProvider, type NwsConfig } from "@/lib/integrations/weather/nws";
export {
  OpenWeatherProvider,
  type OpenWeatherConfig,
} from "@/lib/integrations/weather/openweather";

export type WeatherCredentials = { nws?: NwsConfig; openweather?: OpenWeatherConfig };
export type WeatherProviderOptions = ProviderFactoryOptions<WeatherCredentials>;

/** Weather provider. Reads only; the context is unused but kept for a uniform signature. */
export function getWeatherProvider(
  _ctx: IntegrationContext | null,
  options: WeatherProviderOptions = {},
): WeatherProvider {
  const choice = resolveDomainProvider("weather", options);
  if (!choice.real) return createOutboxWeatherProvider();
  switch (choice.provider) {
    case "nws":
      return new NwsWeatherProvider(
        requireRealDeps("nws", options.fetch, options.credentials?.nws),
      );
    case "openweather":
      return new OpenWeatherProvider(
        requireRealDeps("openweather", options.fetch, options.credentials?.openweather),
      );
    default:
      throw new Error(`No weather adapter for "${choice.provider}".`);
  }
}
