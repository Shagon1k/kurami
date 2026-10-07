import type {BriefingAddon} from "./types.ts";
import {renderEngineeringBlock} from "../engineering/render.ts";

/** Filled before publication from the orchestrator database (src/briefing/engineering/model.ts). */
export const engineeringAddon:BriefingAddon={
  id:"engineering",failurePolicy:"isolate",enabled:payload=>Boolean(payload.addons.engineering),
  sections:[{slot:"after-metrics",order:20,render:renderEngineeringBlock}],
};
