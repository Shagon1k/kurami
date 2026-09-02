import type { BriefingAddon } from "./types.ts";
import { storiesMetricCard } from "../ui/components/metric-strip.ts";
import { renderPaginatedFeed } from "../ui/components/paginated-feed.ts";

export const newsAddon: BriefingAddon = {
  id: "news",
  failurePolicy: "propagate",
  enabled: () => true,
  metrics: [{ order: 20, build: storiesMetricCard }],
  sections: [{ slot: "main", order: 10, render: renderPaginatedFeed }],
};
