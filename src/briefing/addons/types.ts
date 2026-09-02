import type { BriefingAddonEnvelope, BriefingPayload } from "../model.ts";
import type { MetricCard } from "../ui/components/metric-strip.ts";

export type BriefingAddonSlot = "overview" | "main" | "after-main";

export type BriefingAddonSection = {
  slot: BriefingAddonSlot;
  order: number;
  render: (payload: BriefingPayload) => string;
};

export type BriefingAddonMetric = {
  order: number;
  build: (payload: BriefingPayload) => MetricCard;
};

/**
 * Static add-on contract. Existing sections start as propagate-on-failure
 * adapters so the refactor cannot conceal a regression. Native optional
 * add-ons, beginning with Cinema, use isolate and own their empty/error UI.
 */
export type BriefingAddon = {
  id: string;
  failurePolicy: "propagate" | "isolate";
  enabled: (payload: BriefingPayload) => boolean;
  capture?: (payload: BriefingPayload) => BriefingAddonEnvelope;
  sections?: BriefingAddonSection[];
  metrics?: BriefingAddonMetric[];
  renderFailure?: (error: unknown, slot: BriefingAddonSlot) => string;
};

export type OrderedMetricCard = {
  addonId: string;
  order: number;
  card: MetricCard;
};
