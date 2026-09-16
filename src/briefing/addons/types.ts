import type { BriefingAddonEnvelope, BriefingPayload } from "../model.ts";
import type { MetricCard } from "../ui/components/metric-strip.ts";
import type { LiveAddon } from "./live-contract.ts";

export type BriefingAddonSlot = "after-metrics" | "overview" | "main" | "after-main";

export type DerivedAddonContext = { at: string; settings?: Record<string, unknown> };

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
 * Static registry contract: a module owns UI, quality reporting and, when
 * applicable, a live collection/refresh lifecycle. News is snapshot-only.
 * Provider failures are isolated by the live runner; invalid editorial
 * content still fails the publication gate.
 */
export type BriefingAddon = {
  id: string;
  live?: LiveAddon;
  derive?: (payload: BriefingPayload, context: DerivedAddonContext) => BriefingAddonEnvelope | null;
  quality?: { order: number; label: string; state: (payload: BriefingPayload) => import("../model.ts").SectionState };
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
