import type { BriefingPayload, NewsItem } from "./model.ts";

export const BRIEFING_RANKING_POLICY = "deterministic-v1";

const IMPORTANCE = { low: 0, medium: 30, high: 70, critical: 120 } as const;
const URGENCY = { none: 0, soon: 10, today: 25 } as const;
const PUBLIC_INTEREST = { low: 0, medium: 12, high: 28 } as const;
const CONFIDENCE = { low: -12, medium: 0, high: 8 } as const;

function sourceTime(story: NewsItem): number {
  if (story.editorialSignals?.publishedAt) return Date.parse(story.editorialSignals.publishedAt);
  for (const source of Array.isArray(story.sources) ? story.sources : []) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const publishedAt = (source as Record<string, unknown>).publishedAt;
    if (typeof publishedAt === "string" && Number.isFinite(Date.parse(publishedAt))) {
      return Date.parse(publishedAt);
    }
  }
  return 0;
}

function topicIds(story: NewsItem): Set<string> {
  return new Set(story.topics.map((topic) => topic.id));
}

function baseScore(story: NewsItem): number {
  const signals = story.editorialSignals;
  if (!signals) return 0;
  return IMPORTANCE[signals.importance]
    + URGENCY[signals.urgency]
    + PUBLIC_INTEREST[signals.publicInterest]
    + CONFIDENCE[signals.confidence];
}

/**
 * Stable editorial ranking. AI supplies only bounded semantic signals; policy,
 * diversity and tie-breaking remain versioned runtime behavior.
 */
export function rankBriefingStories(stories: NewsItem[]): NewsItem[] {
  // Legacy and hand-authored editions without bounded semantic signals keep
  // their editorial order. The deterministic policy only takes ownership of
  // ordering once at least one story explicitly supplies those signals.
  if (!stories.some((story) => story.editorialSignals)) {
    return stories.map((story, index) => ({
      ...story,
      rank: index + 1,
      rankingPolicy: BRIEFING_RANKING_POLICY,
    }));
  }
  const indexed = stories.map((story, index) => ({ story, index, score: baseScore(story), time: sourceTime(story) }));
  indexed.sort((left, right) =>
    right.score - left.score
    || right.time - left.time
    || left.index - right.index
    || left.story.fingerprint.localeCompare(right.story.fingerprint)
  );
  const remaining = [...indexed];
  const ranked: typeof indexed = [];
  while (remaining.length > 0) {
    const previous = ranked.at(-1)?.story;
    if (!previous) {
      ranked.push(remaining.shift()!);
      continue;
    }
    const previousTopics = topicIds(previous);
    const bestScore = remaining[0]!.score;
    const alternative = remaining.findIndex((candidate) => {
      if (bestScore - candidate.score > 12) return false;
      const overlap = [...topicIds(candidate.story)].filter((topic) => previousTopics.has(topic)).length;
      return overlap === 0;
    });
    ranked.push(remaining.splice(alternative >= 0 ? alternative : 0, 1)[0]!);
  }
  return ranked.map(({ story }, index) => ({
    ...story,
    rank: index + 1,
    rankingPolicy: BRIEFING_RANKING_POLICY,
  }));
}

export function applyDeterministicRanking(payload: BriefingPayload): BriefingPayload {
  const next = structuredClone(payload);
  next.news.items = rankBriefingStories(next.news.items);
  if (next.news.items.some((story) => story.editorialSignals)) {
    const selected = next.news.items
      .filter((story) => story.editorialSignals?.importance === "critical" || story.editorialSignals?.importance === "high")
      .slice(0, 5)
      .map((story) => story.id);
    next.news.mainStoryIds = selected.length >= 3 ? selected : next.news.items.slice(0, Math.min(3, next.news.items.length)).map((story) => story.id);
  }
  next.news.rankingPolicy = BRIEFING_RANKING_POLICY;
  return next;
}
