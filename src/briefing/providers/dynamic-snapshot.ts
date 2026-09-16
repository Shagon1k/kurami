import type { ProviderIssue, ProviderState, ProviderResult } from "./common.ts";
import { collectLiveAddons, LIVE_ADDONS } from "../addons/live.ts";
import { aggregateProviderState } from "../addons/provider-state.ts";
import type { AddonSwitches, LiveResults, LiveCollectionContext } from "../addons/live-contract.ts";

export type DynamicBriefingSnapshot = LiveResults & {
  state: ProviderState;
  refreshedAt: string;
  localDate: string;
  enabled?: AddonSwitches;
  issues: ProviderIssue[];
};
export type DynamicSnapshotOptions = LiveCollectionContext;

export async function collectDynamicBriefingSnapshot(options: DynamicSnapshotOptions): Promise<DynamicBriefingSnapshot> {
  const clock = options.now ?? (() => new Date());
  const refreshedAt = clock().toISOString();
  const collected = await collectLiveAddons({ ...options, now: clock });
  const results: Array<ProviderResult<unknown>> = LIVE_ADDONS
    .filter(addon => options.enabled?.[addon.id] !== false)
    .map(addon => collected[addon.providerKey]);
  return {
    state: aggregateProviderState(results), refreshedAt, localDate: options.localDate,
    ...(options.enabled ? { enabled: options.enabled } : {}),
    ...collected, issues: results.flatMap(result => result.issues),
  };
}
