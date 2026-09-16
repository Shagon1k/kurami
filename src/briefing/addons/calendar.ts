import { captureBuiltinAddon } from "./envelopes.ts";
import { calendarLifecycle } from "./calendar/lifecycle.ts";
import type { BriefingAddon } from "./types.ts";
import { briefingAddonEnabled } from "../model.ts";
import { renderCalendarSection } from "../ui/components/calendar-section.ts";

export const calendarAddon: BriefingAddon = {
  id: "calendar",
  live: calendarLifecycle,
  quality: { order: 30, label: "расписание", state: payload => payload.calendar.state },
  failurePolicy: "propagate",
  enabled: (payload) => briefingAddonEnabled(payload, "calendar"),
  capture: (payload) => captureBuiltinAddon(payload, "calendar"),
  sections: [{ slot: "overview", order: 10, render: renderCalendarSection }],
};
