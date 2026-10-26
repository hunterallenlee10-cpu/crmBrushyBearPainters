import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  NwsWeatherProvider,
  OpenWeatherProvider,
  celsiusToFahrenheit,
  getWeatherProvider,
} from "@/lib/integrations/weather";
import { createFakeFetch } from "@/lib/integrations/testing";

const point = { lat: 47.610378, lng: -122.200676 };

describe("outbox weather provider", () => {
  it("is not connected and writes nothing", async () => {
    const sink = createMemoryOutboxSink();
    const weather = getWeatherProvider({ orgId: "o", sink });
    expect(weather.provider).toBe("outbox");
    expect(await weather.hourlyForecast(point)).toMatchObject({ connected: false });
    expect(sink.entries).toHaveLength(0);
  });
});

describe("celsiusToFahrenheit", () => {
  it("converts and rounds to one decimal", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(10.5)).toBe(50.9);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(celsiusToFahrenheit(12.2222)).toBe(54);
  });
});

describe("NwsWeatherProvider (disabled stub)", () => {
  const hourlyUrl = "https://api.weather.gov/gridpoints/SEW/130,67/forecast/hourly";
  const pointsJson = { properties: { forecastHourly: hourlyUrl, gridId: "SEW" } };
  const hourlyJson = {
    properties: {
      periods: [
        {
          number: 1,
          startTime: "2026-11-02T09:00:00-08:00",
          temperature: 48,
          temperatureUnit: "F",
          probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 20 },
          dewpoint: { unitCode: "wmoUnit:degC", value: 5.5556 },
          shortForecast: "Mostly Cloudy",
        },
        {
          number: 2,
          startTime: "2026-11-02T10:00:00-08:00",
          temperature: 50,
          temperatureUnit: "F",
          probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: null },
          dewpoint: { unitCode: "wmoUnit:degC", value: null },
          shortForecast: "Cloudy",
        },
        {
          number: 3,
          startTime: "2026-11-02T11:00:00-08:00",
          temperature: 52,
          temperatureUnit: "F",
          probabilityOfPrecipitation: { value: 60 },
          dewpoint: { unitCode: "wmoUnit:degC", value: 7 },
        },
      ],
    },
  };

  it("requests points then forecastHourly with a User-Agent", async () => {
    const fetch = createFakeFetch([{ json: pointsJson }, { json: hourlyJson }]);
    const nws = new NwsWeatherProvider({
      fetch,
      config: { userAgent: "(BrushyBearCRM, ops@example.test)" },
    });
    await nws.hourlyForecast(point);
    expect(fetch.requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", "https://api.weather.gov/points/47.6104,-122.2007"],
      ["GET", hourlyUrl],
    ]);
    for (const req of fetch.requests) {
      expect(req.headers.get("user-agent")).toBe("(BrushyBearCRM, ops@example.test)");
      expect(req.headers.get("accept")).toBe("application/geo+json");
    }
  });

  it("parses periods, converting dew point °C → °F and limiting hours", async () => {
    const fetch = createFakeFetch([{ json: pointsJson }, { json: hourlyJson }]);
    const nws = new NwsWeatherProvider({ fetch, config: { userAgent: "ua" } });
    const result = await nws.hourlyForecast({ ...point, hours: 2 });
    expect(result).toEqual({
      connected: true,
      periods: [
        {
          startsAt: "2026-11-02T17:00:00.000Z",
          tempF: 48,
          precipProbability: 20,
          dewPointF: 42,
          shortForecast: "Mostly Cloudy",
        },
        {
          startsAt: "2026-11-02T18:00:00.000Z",
          tempF: 50,
          precipProbability: 0,
          dewPointF: null,
          shortForecast: "Cloudy",
        },
      ],
    });
  });

  it("maps errors and refuses forecast links to other hosts", async () => {
    const notFound = createFakeFetch({
      status: 404,
      json: {
        title: "Data Unavailable For Requested Point",
        detail: "Unable to provide data for requested point",
      },
    });
    expect(
      await new NwsWeatherProvider({ fetch: notFound, config: { userAgent: "ua" } }).hourlyForecast(
        point,
      ),
    ).toEqual({
      connected: true,
      periods: [],
      error: "HTTP 404: Unable to provide data for requested point",
    });
    const evil = createFakeFetch({
      json: { properties: { forecastHourly: "https://evil.example/x" } },
    });
    const result = await new NwsWeatherProvider({
      fetch: evil,
      config: { userAgent: "ua" },
    }).hourlyForecast(point);
    expect(result).toMatchObject({ connected: true, periods: [] });
    expect(evil.requests).toHaveLength(1);
  });
});

describe("OpenWeatherProvider (disabled stub)", () => {
  it("requests One Call 3.0 in imperial units", async () => {
    const fetch = createFakeFetch({ json: { hourly: [] } });
    await new OpenWeatherProvider({ fetch, config: { apiKey: "ow-key" } }).hourlyForecast(point);
    const url = new URL(fetch.requests[0]?.url ?? "");
    expect(fetch.requests[0]?.method).toBe("GET");
    expect(url.origin + url.pathname).toBe("https://api.openweathermap.org/data/3.0/onecall");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "47.610378",
      lon: "-122.200676",
      exclude: "current,minutely,daily,alerts",
      units: "imperial",
      appid: "ow-key",
    });
  });

  it("parses hourly periods with pop 0–1 → 0–100", async () => {
    const fetch = createFakeFetch({
      json: {
        hourly: [
          {
            dt: 1793638800,
            temp: 48.2,
            dew_point: 41.5,
            pop: 0.27,
            weather: [{ main: "Clouds", description: "broken clouds" }],
          },
          { dt: 1793642400, temp: 49, dew_point: 42, pop: 1 },
          { dt: 1793646000, temp: 50 },
        ],
      },
    });
    const result = await new OpenWeatherProvider({ fetch, config: { apiKey: "k" } }).hourlyForecast(
      {
        ...point,
        hours: 3,
      },
    );
    expect(result).toEqual({
      connected: true,
      periods: [
        {
          startsAt: "2026-11-02T17:00:00.000Z",
          tempF: 48.2,
          precipProbability: 27,
          dewPointF: 41.5,
          shortForecast: "broken clouds",
        },
        { startsAt: "2026-11-02T18:00:00.000Z", tempF: 49, precipProbability: 100, dewPointF: 42 },
        { startsAt: "2026-11-02T19:00:00.000Z", tempF: 50, precipProbability: 0, dewPointF: null },
      ],
    });
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({
      status: 401,
      json: {
        cod: 401,
        message:
          "Invalid API key. Please see https://openweathermap.org/faq#error401 for more info.",
      },
    });
    const result = await new OpenWeatherProvider({
      fetch,
      config: { apiKey: "bad" },
    }).hourlyForecast(point);
    expect(result).toMatchObject({ connected: true, periods: [] });
    expect(result.connected && result.error).toMatch(/^HTTP 401: Invalid API key/);
  });
});

describe("getWeatherProvider", () => {
  it("only returns real providers when fully allowed", () => {
    const base = {
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { nws: { userAgent: "ua" }, openweather: { apiKey: "k" } },
    };
    expect(getWeatherProvider(null, { ...base, envProvider: "nws" }).provider).toBe("outbox");
    expect(getWeatherProvider(null, { ...base, envProvider: "nws", locked: false })).toBeInstanceOf(
      NwsWeatherProvider,
    );
    expect(
      getWeatherProvider(null, { ...base, envProvider: "openweather", locked: false }),
    ).toBeInstanceOf(OpenWeatherProvider);
  });
});
