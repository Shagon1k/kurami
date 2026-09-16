import type { BriefingPayload } from "../model.ts";
import { BRIEFING_ADDONS } from "./registry.ts";
import type { DerivedAddonContext } from "./types.ts";

/** Derived modules consume normalized sibling data, never provider calls. */
export function refreshDerivedAddons(payload: BriefingPayload, context: DerivedAddonContext): void {
  for (const addon of BRIEFING_ADDONS) {
    if (!addon.derive) continue;
    try {
      const envelope = addon.derive(payload, context);
      if (envelope) payload.addons[addon.id] = envelope;
      else delete payload.addons[addon.id];
    } catch(error) {
      if (addon.failurePolicy === "propagate") throw error;
      payload.addons[addon.id] = { version: 1, state: "failed", capturedAt: context.at,
        data: { error: "derived_addon_failed" } };
    }
  }
}
