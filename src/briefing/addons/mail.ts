import { captureBuiltinAddon, section } from "./envelopes.ts";
import { mailLifecycle } from "./mail/lifecycle.ts";
import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { mailMetricCard } from "../ui/components/metric-strip.ts";
import { renderMailSection } from "../ui/components/mail-section.ts";

export const mailAddon: BriefingAddon = {
  id: "mail",
  live: mailLifecycle,
  quality: { order: 20, label: "почта", state: payload => section(payload, "mail").state },
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "mail"),
  capture: (payload) => captureBuiltinAddon(payload, "mail"),
  metrics: [{ order: 10, build: mailMetricCard }],
  sections: [{ slot: "overview", order: 20, render: renderMailSection }],
};
