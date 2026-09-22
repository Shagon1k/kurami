import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { NewsItem } from "./model.ts";
import type { TopicPolicy } from "./editorial-validation.ts";

export const INTEREST_POLICY = Object.freeze({
  version: "interest-v1", minimumReactions: 10, minimumEvidence: 3,
  prior: 4, maximumAdjustment: 20, positionStep: 1.5,
  caps: { topic: 4, aspect: 8, geography: 2, source: 2, pair: 12 },
});
export type InterestKind = keyof typeof INTEREST_POLICY.caps;
export type InterestWeight = {
  key: string; kind: InterestKind; label: string; likes: number; dislikes: number;
  evidence: number; weight: number;
};
export type InterestProfile = {
  policy: typeof INTEREST_POLICY; revision: string; ready: boolean;
  reactions: number; withSourceContext: number; weights: InterestWeight[];
};
type Event = { event_id: number; story_fingerprint: string; topic_ids_json: string; reaction: string; context_json: string | null };
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en");
const strings = (json: string): string[] => {
  try { const value: unknown = JSON.parse(json); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};

export function reactionSourceKeys(story: NewsItem): string[] {
  return [...new Set((story.sources ?? []).map(source => source.sourceKey)
    .filter((key): key is string => typeof key === "string" && /^[a-z0-9][a-z0-9._:/-]{0,159}$/iu.test(key)))].sort().slice(0, 16);
}

function sourceContext(json: string | null): string[] {
  try {
    const value = JSON.parse(json ?? "null");
    return value?.version === 1 && Array.isArray(value.sources)
      ? [...new Set(value.sources.filter((key: unknown): key is string => typeof key === "string" && /^[a-z0-9][a-z0-9._:/-]{0,159}$/iu.test(key)))].slice(0, 16) as string[]
      : [];
  } catch { return []; }
}

/** Exact IDs win. Ambiguous aliases never merge unrelated interests. */
function featureResolver(policy: TopicPolicy) {
  const aliases = new Map<string, Set<string>>();
  for (const topic of policy.topics.values()) {
    for (const value of [topic.id, topic.label, ...topic.aliases]) {
      const key = normalized(value);
      const owners = aliases.get(key) ?? new Set<string>();
      owners.add(topic.id); aliases.set(key, owners);
    }
  }
  return (topicIds: string[], sources: string[]) => {
  const ids = [...new Set(topicIds.map(raw => {
    if (policy.topics.has(raw)) return raw;
    const owners = aliases.get(normalized(raw));
    return owners?.size === 1 ? [...owners][0]! : raw;
  }))].sort().slice(0, 4);
  const features: Array<{ key: string; kind: InterestKind; label: string }> = ids.map(id => {
    const kind = policy.geographyTopics.has(id) ? "geography" : policy.genericTopics.has(id) ? "topic" : "aspect";
    return { key: `${kind}:${id}`, kind, label: policy.topics.get(id)?.label ?? id };
  });
  for (let left = 0; left < ids.length; left++) {
    for (let right = left + 1; right < ids.length; right++) {
      const pair = [ids[left]!, ids[right]!];
      if (pair.every(id => policy.genericTopics.has(id)) || pair.every(id => policy.geographyTopics.has(id))) continue;
      features.push({ key: "pair:" + pair.join("+"), kind: "pair", label: pair.map(id => policy.topics.get(id)?.label ?? id).join(" · ") });
    }
  }
  for (const id of [...new Set(sources)]) features.push({ key: "source:" + id, kind: "source", label: id });
  return features;
  };
}

export function interestFeatures(topicIds: string[], sources: string[], policy: TopicPolicy) {
  return featureResolver(policy)(topicIds, sources);
}

export function buildInterestProfile(database: DatabaseSync, policy: TopicPolicy): InterestProfile {
  const events = database.prepare(`
    WITH latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY story_fingerprint ORDER BY event_id DESC) AS position
      FROM reaction_events
    ) SELECT event_id,story_fingerprint,topic_ids_json,reaction,context_json
      FROM latest WHERE position=1 ORDER BY event_id
  `).all() as Event[];
  const active = events.filter(event => event.reaction === "like" || event.reaction === "dislike");
  const counts = new Map<string, InterestWeight>();
  const featuresFor = featureResolver(policy);
  let withSourceContext = 0;
  for (const event of active) {
    const sources = sourceContext(event.context_json);
    if (sources.length) withSourceContext++;
    for (const feature of featuresFor(strings(event.topic_ids_json), sources)) {
      const count = counts.get(feature.key) ?? { ...feature, likes: 0, dislikes: 0, evidence: 0, weight: 0 };
      if (event.reaction === "like") count.likes++; else count.dislikes++;
      count.evidence++;
      counts.set(feature.key, count);
    }
  }
  const weights = [...counts.values()].map(count => ({
    ...count,
    weight: count.evidence < INTEREST_POLICY.minimumEvidence ? 0
      : Number(((count.likes - count.dislikes) / (count.evidence + INTEREST_POLICY.prior)).toFixed(4)),
  })).sort((a,b) => Math.abs(b.weight) - Math.abs(a.weight) || a.key.localeCompare(b.key));
  const revision = createHash("sha256").update(JSON.stringify({ policy: INTEREST_POLICY, events, weights })).digest("hex").slice(0, 16);
  return { policy: INTEREST_POLICY, revision, ready: active.length >= INTEREST_POLICY.minimumReactions,
    reactions: active.length, withSourceContext, weights };
}

export function personalizedNewsOrder(stories: NewsItem[], profile: InterestProfile, policy: TopicPolicy) {
  const weights = new Map(profile.weights.map(weight => [weight.key, weight]));
  const featuresFor = featureResolver(policy);
  const details = stories.map((story, index) => {
    const features = featuresFor(story.topics.map(topic => topic.id), reactionSourceKeys(story));
    const matched = features.map(feature => weights.get(feature.key)).filter((value): value is InterestWeight => Boolean(value?.weight));
    const contributions = (Object.keys(INTEREST_POLICY.caps) as InterestKind[]).flatMap(kind => {
      // Normalize by every matching story feature, including those without evidence.
      const all = features.filter(feature => feature.kind === kind);
      return matched.filter(feature => feature.kind === kind).map(feature => ({
        key: feature.key, label: feature.label, evidence: feature.evidence,
        points: Number((feature.weight * INTEREST_POLICY.caps[kind] / Math.max(1, all.length)).toFixed(3)),
      }));
    });
    const adjustment = profile.ready ? Math.max(-INTEREST_POLICY.maximumAdjustment, Math.min(INTEREST_POLICY.maximumAdjustment, contributions.reduce((sum,value)=>sum+value.points,0))) : 0;
    const protectedStory = story.editorialSignals?.importance === "critical"
      || (story.editorialSignals?.urgency === "today"
        && (story.editorialSignals?.publicInterest === "high" || story.editorialSignals?.importance === "high"));
    return { id: story.id, baseIndex: index, adjustment: Number(adjustment.toFixed(3)), protected: protectedStory,
      reasons: profile.ready ? contributions.sort((a,b)=>Math.abs(b.points)-Math.abs(a.points) || a.key.localeCompare(b.key)).slice(0,3) : [] };
  });
  // Preserve the exact editorial position of safety-critical/time-sensitive stories.
  const remaining = details.filter(item => !item.protected).sort((a,b) =>
    (-b.baseIndex * INTEREST_POLICY.positionStep + b.adjustment) - (-a.baseIndex * INTEREST_POLICY.positionStep + a.adjustment)
    || a.baseIndex - b.baseIndex);
  let cursor = 0;
  const ordered = details.map(item => item.protected ? item : remaining[cursor++]!);
  return { order: ordered.map(item => item.id), details, profile };
}
