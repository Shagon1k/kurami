import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { storiesMetricCard } from "../ui/components/metric-strip.ts";
import { renderPaginatedFeed } from "../ui/components/paginated-feed.ts";

export const newsAddon: BriefingAddon = {
  id: "news",
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "news"),
  capture: (payload) => ({
    version: 1,
    state: payload.news.state,
    capturedAt: payload.edition.generatedAt,
    data: {},
  }),
  metrics: [{ order: 20, build: storiesMetricCard }],
  sections: [{ slot: "main", order: 10, render: renderPaginatedFeed }],
};
