import type { BriefingAddon } from "./types.ts";
import { renderCalendarSection } from "../ui/components/calendar-section.ts";

export const calendarAddon: BriefingAddon = {
  id: "calendar",
  failurePolicy: "propagate",
  enabled: () => true,
  sections: [{ slot: "overview", order: 10, render: renderCalendarSection }],
};
