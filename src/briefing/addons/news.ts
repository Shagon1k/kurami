import { captureBuiltinAddon } from "./envelopes.ts";
import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { storiesMetricCard } from "../ui/components/metric-strip.ts";
import { renderPaginatedFeed } from "../ui/components/paginated-feed.ts";

export const newsAddon: BriefingAddon = {
  id: "news",
  quality: { order: 10, label: "новости", state: payload => payload.news.state },
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "news"),
  capture: (payload) => captureBuiltinAddon(payload, "news"),
  metrics: [{ order: 20, build: storiesMetricCard }],
  sections: [{ slot: "main", order: 10, render: renderPaginatedFeed }],
};
