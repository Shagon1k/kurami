import type { BriefingAddon } from "./types.ts";
import { mailMetricCard } from "../ui/components/metric-strip.ts";
import { renderMailSection } from "../ui/components/mail-section.ts";

export const mailAddon: BriefingAddon = {
  id: "mail",
  failurePolicy: "propagate",
  enabled: () => true,
  metrics: [{ order: 10, build: mailMetricCard }],
  sections: [{ slot: "overview", order: 20, render: renderMailSection }],
};
