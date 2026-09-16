// Historical fixture builders stay readable; all runtime calls receive the canonical format.
import { upgradeLegacyPayload } from "../../src/briefing/migrations/addon-format.ts";
import { preparePreview as prepare } from "../../src/briefing/store.ts";
export function parseBriefingPayload(value: unknown) {
  const root = structuredClone(value) as Record<string, unknown>;
  if (["mail","calendar","weather","news","sourceBatches"].some(key => Object.hasOwn(root, key))) delete root.formatVersion;
  return upgradeLegacyPayload(root);
}
export const preparePreview: typeof prepare = (payload, html, paths) => prepare(parseBriefingPayload(payload), html, paths);
