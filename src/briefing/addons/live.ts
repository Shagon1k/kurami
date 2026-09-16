import { briefingAddonEnabled, type BriefingPayload } from "../model.ts";
import type { ProviderResult } from "../providers/common.ts";
import { BRIEFING_ADDONS } from "./registry.ts";
import { aggregateProviderState, failedProviderResult } from "./provider-state.ts";
import { captureBuiltinAddon } from "./envelopes.ts";
import type { LiveAddon, LiveApplyContext, LiveCollectionContext, LiveResults } from "./live-contract.ts";

export const LIVE_ADDONS: readonly LiveAddon[] = Object.freeze(BRIEFING_ADDONS.flatMap(addon => addon.live ? [addon.live] : []));

/** HTTP can run alongside MCP, but the shared Composio session stays sequential. */
export async function collectLiveAddons(context: LiveCollectionContext, addons = LIVE_ADDONS): Promise<LiveResults> {
  let caller = context.caller;
  const scoped = { ...context, getCaller: () => caller ??= context.getCaller!() };
  const at = (context.now?.() ?? new Date()).toISOString();
  const skipped = (): ProviderResult<never> => ({ state: "empty", value: null, fetchedAt: at, attempts: 0, issues: [] });
  const results: Record<string, ProviderResult<unknown>> = { gmail: skipped(), calendar: skipped(), weather: skipped() };
  const collect = async (addon: LiveAddon) => {
    if (context.enabled?.[addon.id] === false) return;
    try { results[addon.providerKey] = await addon.collect(scoped); }
    catch (error) { results[addon.providerKey] = failedProviderResult(error, at, `${addon.id}_collection_unavailable`); }
  };
  const http = Promise.all(addons.filter(addon => addon.lane === "http").map(collect));
  for (const addon of addons.filter(addon => addon.lane === "mcp")) await collect(addon);
  await http;
  return results as LiveResults;
}

export function applyLiveAddons(payload: BriefingPayload, results: LiveResults, context: LiveApplyContext, addons = LIVE_ADDONS): void {
  const active = addons.filter(addon => briefingAddonEnabled(payload, addon.id) && context.enabled?.[addon.id] !== false);
  const effective = { ...results };
  for (const addon of active) {
    // A provider's unusable/partial response preserves its last good section.
    const prior = payload[addon.id];
    const priorNotes = payload.notes;
    try { addon.apply(payload, effective, context); }
    catch (error) {
      Object.assign(payload, { [addon.id]: prior, notes: priorNotes });
      effective[addon.providerKey] = failedProviderResult(error, context.refreshedAt, `${addon.id}_normalization_failed`);
      addon.apply(payload, effective, context);
    }
    if (payload.addons) payload.addons[addon.id] = captureBuiltinAddon(payload, addon.id, context.refreshedAt);
  }
  const state = aggregateProviderState(active.map(addon => effective[addon.providerKey]));
  const success = state === "ready" || state === "empty";
  payload.live = {
    refreshedAt: context.refreshedAt, state: success ? "ready" : "partial",
    ...(success ? { lastSuccessAt: context.refreshedAt } : payload.live?.lastSuccessAt ? { lastSuccessAt: payload.live.lastSuccessAt } : {}),
  };
}
