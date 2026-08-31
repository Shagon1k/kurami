import {
  ProviderError,
  fetchJson,
  providerIssue,
  type FetchLike,
  type ProviderResult,
  type RetryPolicy,
} from "./common.ts";

type JsonRecord = Record<string, unknown>;

export type OpenMeteoLocation = {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
};

export type WeatherCondition = {
  code: number;
  label: string;
  emoji: string;
};

export type WeatherSnapshot = {
  provider: "open-meteo";
  location: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  observedAt: string;
  condition: WeatherCondition;
  temperatureCelsius: number;
  apparentTemperatureCelsius: number | null;
  humidityPercent: number | null;
  precipitationMillimeters: number | null;
  precipitationProbabilityPercent: number | null;
  windSpeedKph: number | null;
  minimumCelsius: number | null;
  maximumCelsius: number | null;
  sunrise: string | null;
  sunset: string | null;
};

export type OpenMeteoOptions = {
  location: OpenMeteoLocation;
  localDate?: string;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed);
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function indexed<T>(value: unknown, index: number, parser: (entry: unknown) => T | null): T | null {
  return Array.isArray(value) && index >= 0 && index < value.length
    ? parser(value[index])
    : null;
}

export function mapWeatherCode(code: number): WeatherCondition {
  if (code === 0) return { code, label: "Ясно", emoji: "☀️" };
  if (code === 1) return { code, label: "Преимущественно ясно", emoji: "🌤️" };
  if (code === 2) return { code, label: "Переменная облачность", emoji: "⛅" };
  if (code === 3) return { code, label: "Пасмурно", emoji: "☁️" };
  if (code === 45 || code === 48) return { code, label: "Туман", emoji: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code)) return { code, label: "Морось", emoji: "🌦️" };
  if ([61, 63, 65, 66, 67].includes(code)) return { code, label: "Дождь", emoji: "🌧️" };
  if ([71, 73, 75, 77].includes(code)) return { code, label: "Снег", emoji: "🌨️" };
  if ([80, 81, 82].includes(code)) return { code, label: "Ливни", emoji: "🌦️" };
  if ([85, 86].includes(code)) return { code, label: "Снегопад", emoji: "🌨️" };
  if ([95, 96, 99].includes(code)) return { code, label: "Гроза", emoji: "⛈️" };
  return { code, label: "Неизвестные условия", emoji: "🌡️" };
}

export function buildOpenMeteoUrl(options: OpenMeteoOptions): URL {
  const { location } = options;
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    throw new ProviderError("weather_invalid_latitude", "Open-Meteo latitude is invalid");
  }
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new ProviderError("weather_invalid_longitude", "Open-Meteo longitude is invalid");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: location.timeZone }).format(new Date());
  } catch {
    throw new ProviderError("weather_invalid_timezone", "Open-Meteo timezone is invalid");
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", location.timeZone);
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
    ].join(","),
  );
  if (options.localDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.localDate)) {
      throw new ProviderError("weather_invalid_date", "Weather date must use YYYY-MM-DD");
    }
    url.searchParams.set("start_date", options.localDate);
    url.searchParams.set("end_date", options.localDate);
  } else url.searchParams.set("forecast_days", "7");
  return url;
}

export function normalizeOpenMeteo(
  payload: unknown,
  location: OpenMeteoLocation,
  localDate?: string,
): WeatherSnapshot {
  if (!isRecord(payload) || !isRecord(payload.current) || !isRecord(payload.daily)) {
    throw new ProviderError("weather_invalid_response", "Open-Meteo returned an invalid forecast");
  }
  const current = payload.current;
  const daily = payload.daily;
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const dailyIndex = localDate ? dates.findIndex((entry) => entry === localDate) : 0;
  const index = dailyIndex >= 0 ? dailyIndex : 0;
  const temperature = number(current.temperature_2m);
  const currentCode = integer(current.weather_code);
  const dailyCode = indexed(daily.weather_code, index, integer);
  const code = currentCode ?? dailyCode;
  const observedAt = string(current.time);
  if (temperature === null || code === null || !observedAt) {
    throw new ProviderError(
      "weather_missing_current",
      "Open-Meteo forecast is missing current temperature, condition, or timestamp",
    );
  }
  return {
    provider: "open-meteo",
    location: location.name,
    latitude: number(payload.latitude) ?? location.latitude,
    longitude: number(payload.longitude) ?? location.longitude,
    timeZone: string(payload.timezone) ?? location.timeZone,
    observedAt,
    condition: mapWeatherCode(code),
    temperatureCelsius: temperature,
    apparentTemperatureCelsius: number(current.apparent_temperature),
    humidityPercent: integer(current.relative_humidity_2m),
    precipitationMillimeters: number(current.precipitation),
    precipitationProbabilityPercent: indexed(daily.precipitation_probability_max, index, integer),
    windSpeedKph: number(current.wind_speed_10m),
    minimumCelsius: indexed(daily.temperature_2m_min, index, number),
    maximumCelsius: indexed(daily.temperature_2m_max, index, number),
    sunrise: indexed(daily.sunrise, index, string),
    sunset: indexed(daily.sunset, index, string),
  };
}

export async function fetchOpenMeteo(
  options: OpenMeteoOptions,
): Promise<ProviderResult<WeatherSnapshot>> {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  let url: URL;
  try {
    url = buildOpenMeteoUrl(options);
  } catch (error) {
    return {
      state: "failed",
      value: null,
      fetchedAt,
      attempts: 0,
      issues: [providerIssue(error, "weather_configuration_error")],
    };
  }
  const response = await fetchJson(url, {
    fetchImpl: options.fetchImpl,
    retry: options.retry,
  });
  if (!response.ok) {
    return {
      state: "failed",
      value: null,
      fetchedAt,
      attempts: response.attempts,
      issues: [response.issue],
    };
  }
  try {
    return {
      state: "ready",
      value: normalizeOpenMeteo(response.value, options.location, options.localDate),
      fetchedAt,
      attempts: response.attempts,
      issues: [],
    };
  } catch (error) {
    return {
      state: "failed",
      value: null,
      fetchedAt,
      attempts: response.attempts,
      issues: [providerIssue(error, "weather_normalization_error")],
    };
  }
}
