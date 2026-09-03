import { briefingAddonEnabled } from "../model.ts";
import { renderCinemaSection } from "../ui/components/cinema-section.ts";
import type { BriefingAddon } from "./types.ts";

export const cinemaAddon: BriefingAddon = {
  id: "cinema",
  failurePolicy: "isolate",
  enabled: (payload) => briefingAddonEnabled(payload, "cinema")
    && payload.addons !== undefined
    && payload.addons.cinema !== undefined,
  sections: [{ slot: "after-main", order: 10, render: renderCinemaSection }],
};
