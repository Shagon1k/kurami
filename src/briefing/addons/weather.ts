import type { BriefingAddon } from "./types.ts";
import { weatherMetricCard } from "../ui/components/metric-strip.ts";

export const weatherAddon: BriefingAddon = {
  id: "weather",
  failurePolicy: "propagate",
  enabled: () => true,
  metrics: [{ order: 40, build: weatherMetricCard }],
};
