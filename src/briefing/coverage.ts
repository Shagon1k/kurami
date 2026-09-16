import { briefingAddonEnabled, type BriefingPayload } from "./model.ts";

export type TelegramCoverageIssue = {
  key: string;
  reason: "missing" | "duplicate" | "unknown";
  owners?: string[];
};

export type TelegramCoverageReport = {
  complete: boolean;
  capturedItems: number;
  storyItems: number;
  excludedItems: number;
  issues: TelegramCoverageIssue[];
};

function canonicalSourceKey(value: string): string {
  return value.startsWith("telegram:") ? value : `telegram:${value}`;
}

function itemKey(sourceKey: string, itemId: string): string {
  return `${canonicalSourceKey(sourceKey)}:${itemId}`;
}

export function telegramStoryCoverage(payload: BriefingPayload): TelegramCoverageReport {
  const captured = new Set<string>();
  for (const batch of payload.sourceBatches ?? []) {
    for (const itemId of batch.itemIds) captured.add(itemKey(batch.sourceKey, itemId));
  }

  const owners = new Map<string, string[]>();
  const claim = (key: string, owner: string) => {
    const current = owners.get(key) ?? [];
    current.push(owner);
    owners.set(key, current);
  };

  for (const story of payload.news.items) {
    const sources = Array.isArray(story.sources) ? story.sources : [];
    for (const sourceValue of sources) {
      if (typeof sourceValue !== "object" || sourceValue === null || Array.isArray(sourceValue)) {
        continue;
      }
      const source = sourceValue as Record<string, unknown>;
      const sourceKey = typeof source.sourceKey === "string"
        ? source.sourceKey
        : typeof source.sourceId === "string" ? source.sourceId : "";
      if (!sourceKey || !Array.isArray(source.itemIds)) continue;
      for (const rawItemId of source.itemIds) {
        if (typeof rawItemId === "string") claim(itemKey(sourceKey, rawItemId), `story:${story.id}`);
      }
    }
  }

  const exclusions = Array.isArray(payload.news.exclusions) ? payload.news.exclusions : [];
  for (const exclusionValue of exclusions) {
    if (typeof exclusionValue !== "object" || exclusionValue === null || Array.isArray(exclusionValue)) {
      continue;
    }
    const exclusion = exclusionValue as Record<string, unknown>;
    if (typeof exclusion.sourceKey !== "string" || typeof exclusion.itemId !== "string") continue;
    claim(itemKey(exclusion.sourceKey, exclusion.itemId), `excluded:${String(exclusion.reason ?? "unknown")}`);
  }

  const issues: TelegramCoverageIssue[] = [];
  for (const key of captured) {
    const itemOwners = owners.get(key) ?? [];
    if (itemOwners.length === 0) issues.push({ key, reason: "missing" });
    else if (itemOwners.length > 1) issues.push({ key, reason: "duplicate", owners: itemOwners });
  }
  for (const [key, itemOwners] of owners) {
    if (!captured.has(key)) issues.push({ key, reason: "unknown", owners: itemOwners });
  }

  let storyItems = 0;
  let excludedItems = 0;
  for (const itemOwners of owners.values()) {
    if (itemOwners.length !== 1) continue;
    if (itemOwners[0]?.startsWith("story:")) storyItems += 1;
    else if (itemOwners[0]?.startsWith("excluded:")) excludedItems += 1;
  }
  return {
    complete: (captured.size > 0 || (!briefingAddonEnabled(payload, "news") && payload.news.items.length === 0))
      && issues.length === 0,
    capturedItems: captured.size,
    storyItems,
    excludedItems,
    issues,
  };
}

export function assertTelegramStoryCoverage(payload: BriefingPayload): TelegramCoverageReport {
  const report = telegramStoryCoverage(payload);
  if (report.complete) return report;
  const sample = report.issues.slice(0, 5).map((issue) => `${issue.reason}:${issue.key}`).join(", ");
  throw new Error(
    `Invalid briefing payload: Telegram source coverage is incomplete `
      + `(${report.capturedItems} captured, ${report.storyItems} in stories, `
      + `${report.excludedItems} excluded; ${report.issues.length} issue(s)${sample ? `: ${sample}` : ""})`,
  );
}
