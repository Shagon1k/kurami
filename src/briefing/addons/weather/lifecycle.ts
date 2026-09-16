import type { BriefingPayload, SectionState } from "../../model.ts";
import { fetchOpenMeteo, type WeatherSnapshot } from "../../providers/open-meteo.ts";
import type { LiveAddon } from "../live-contract.ts";
import { providerComplete } from "../provider-state.ts";

export function weatherValue(snapshot: WeatherSnapshot, state: SectionState): BriefingPayload["weather"] {
  const high = snapshot.maximumCelsius === null ? "" : `до ${Math.round(snapshot.maximumCelsius)}°`;
  const precipitation = snapshot.precipitationProbabilityPercent === null
    ? ""
    : `осадки ${snapshot.precipitationProbabilityPercent}%`;
  return {
    state,
    provider: snapshot.provider,
    location: snapshot.location,
    observedAt: snapshot.observedAt,
    temperatureC: snapshot.temperatureCelsius,
    feelsLikeC: snapshot.apparentTemperatureCelsius,
    condition: `${snapshot.condition.emoji} ${snapshot.condition.label}`,
    summary: [high, precipitation].filter(Boolean).join(" · ") || snapshot.location,
  };
}


export const weatherLifecycle: LiveAddon = {
  id: "weather", providerKey: "weather", lane: "http",
  collect: context => fetchOpenMeteo({
    location: context.weatherLocation, fetchImpl: context.fetchImpl, retry: context.retry, now: context.now,
  }),
  apply(payload, results, context) {
    const result = results.weather;
    if (providerComplete(result)) payload.weather = weatherValue(result.value, result.state);
    else if (!context.initial && payload.weather) payload.weather = { ...payload.weather, state: "stale", staleAt: context.refreshedAt };
    else payload.weather = { state: "failed", summary: "Прогноз временно недоступен" };
  },
};
