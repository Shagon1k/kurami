import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { weatherMetricCard } from "../ui/components/metric-strip.ts";

export const weatherAddon: BriefingAddon = {
  id: "weather",
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "weather"),
  capture: (payload) => ({
    version: 1,
    state: payload.weather?.state ?? "failed",
    capturedAt: payload.live?.refreshedAt ?? payload.edition.generatedAt,
    data: {},
  }),
  metrics: [{ order: 40, build: weatherMetricCard }],
};
