import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { renderCalendarSection } from "../ui/components/calendar-section.ts";

export const calendarAddon: BriefingAddon = {
  id: "calendar",
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "calendar"),
  capture: (payload) => ({
    version: 1,
    state: payload.calendar.state,
    capturedAt: payload.live?.refreshedAt ?? payload.edition.generatedAt,
    data: {},
  }),
  sections: [{ slot: "overview", order: 10, render: renderCalendarSection }],
};
