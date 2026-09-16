import type { BriefingAddon } from "./types.ts";
import { deriveSignals } from "./signals/engine.ts";
import { parseSignalsConfig } from "./signals/config.ts";
import { parseSignalsEnvelope } from "./signals/model.ts";
import { renderSignalStrip } from "../ui/components/signal-strip.ts";

export const signalsAddon: BriefingAddon = {
  id: "signals", failurePolicy: "isolate",
  enabled: payload => Boolean(payload.addons.signals),
  quality: { order: 50, label: "подсказки", state: payload => payload.addons.signals?.state ?? "empty" },
  derive(payload, context) {
    if(payload.edition.type !== "daily") return null;
    const settings = context.settings?.signals ?? payload.addons.signals?.data.policy;
    if(settings === undefined) return null;
    const config = parseSignalsConfig(settings);
    if(!config.enabled && !config.error) return null;
    return deriveSignals(payload,config,context.at) as unknown as import("../model.ts").BriefingAddonEnvelope;
  },
  sections: [{slot:"after-metrics",order:10,render:payload=>renderSignalStrip(parseSignalsEnvelope(payload.addons.signals))}],
};
