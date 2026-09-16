import { captureBuiltinAddon } from "./envelopes.ts";
import { weatherLifecycle } from "./weather/lifecycle.ts";
import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { weatherMetricCard } from "../ui/components/metric-strip.ts";

export const weatherAddon: BriefingAddon = {
  id: "weather",
  live: weatherLifecycle,
  quality: { order: 40, label: "погода", state: payload => payload.weather?.state ?? "failed" },
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "weather"),
  capture: (payload) => captureBuiltinAddon(payload, "weather"),
  metrics: [{ order: 40, build: weatherMetricCard }],
};
