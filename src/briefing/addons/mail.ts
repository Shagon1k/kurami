import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { mailMetricCard } from "../ui/components/metric-strip.ts";
import { renderMailSection } from "../ui/components/mail-section.ts";

export const mailAddon: BriefingAddon = {
  id: "mail",
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "mail"),
  capture: (payload) => ({
    version: 1,
    state: payload.mail.state,
    capturedAt: payload.live?.refreshedAt ?? payload.edition.generatedAt,
    data: {},
  }),
  metrics: [{ order: 10, build: mailMetricCard }],
  sections: [{ slot: "overview", order: 20, render: renderMailSection }],
};
