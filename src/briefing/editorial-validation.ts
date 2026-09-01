import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BriefingPayload, NewsItem } from "./model.ts";

export type TopicDefinition = {
  id: string;
  label: string;
  aliases: string[];
  status: "active" | "proposed";
};

export type TopicPolicy = {
  topics: Map<string, TopicDefinition>;
  geographyTopics: Set<string>;
  refinements: Map<string, Set<string>>;
  promotion: {
    minimumStoryCount: number;
    minimumEditionOrSourceCount: number;
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid topic seed: ${label} must be an object`);
  }
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid topic seed: ${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid topic seed: ${label} must be an array`);
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid topic seed: ${label} must be a positive integer`);
  }
  return value;
}

async function topicSeedPath(home: string, environment: NodeJS.ProcessEnv): Promise<string> {
  const candidates = environment.TOPIC_SEED?.trim()
    ? [resolve(environment.TOPIC_SEED)]
    : [
      resolve(home, "config/briefing-topics.yaml"),
      resolve(home, "app/deploy/config/briefing-topics.yaml"),
      resolve(import.meta.dirname, "../../deploy/config/briefing-topics.yaml"),
    ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Topic seed is unavailable");
}

export async function loadTopicPolicy(
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
  runtimeTopics: TopicDefinition[] = [],
): Promise<TopicPolicy> {
  const path = await topicSeedPath(home, environment);
  const root = record(parseYaml(await readFile(path, "utf8")) as unknown, "root");
  if (!Array.isArray(root.topics)) throw new Error("Invalid topic seed: topics must be an array");
  const topics = new Map<string, TopicDefinition>();
  for (const [index, raw] of root.topics.entries()) {
    const item = record(raw, `topics[${index}]`);
    const definition = {
      id: nonEmptyString(item.id, `topics[${index}].id`),
      label: nonEmptyString(item.label, `topics[${index}].label`),
      aliases: stringArray(item.aliases ?? [], `topics[${index}].aliases`),
      status: "active" as const,
    };
    if (topics.has(definition.id)) throw new Error(`Invalid topic seed: duplicate ${definition.id}`);
    topics.set(definition.id, definition);
  }
  for (const definition of runtimeTopics) {
    if (!topics.has(definition.id)) topics.set(definition.id, definition);
  }

  const validation = record(root.validation ?? {}, "validation");
  const promotion = record(root.promotion ?? {}, "promotion");
  const geographyTopics = new Set(stringArray(
    validation.geography_topics ?? [],
    "validation.geography_topics",
  ));
  const rawRefinements = record(validation.required_refinements ?? {}, "validation.required_refinements");
  const refinements = new Map<string, Set<string>>();
  for (const [broadTopic, rawSpecificTopics] of Object.entries(rawRefinements)) {
    refinements.set(broadTopic, new Set(stringArray(
      rawSpecificTopics,
      `validation.required_refinements.${broadTopic}`,
    )));
  }
  for (const topicId of [...geographyTopics, ...refinements.keys()]) {
    if (!topics.has(topicId)) throw new Error(`Invalid topic seed: unknown validation topic ${topicId}`);
  }
  for (const specificTopics of refinements.values()) {
    for (const topicId of specificTopics) {
      if (!topics.has(topicId)) throw new Error(`Invalid topic seed: unknown refinement topic ${topicId}`);
    }
  }
  return {
    topics,
    geographyTopics,
    refinements,
    promotion: {
      minimumStoryCount: positiveInteger(
        promotion.minimum_story_count,
        "promotion.minimum_story_count",
      ),
      minimumEditionOrSourceCount: positiveInteger(
        promotion.minimum_edition_or_source_count,
        "promotion.minimum_edition_or_source_count",
      ),
    },
  };
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[«»“”„"'`]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function storyText(story: NewsItem): string {
  const optional = [story.context, story.whyItMatters]
    .filter((value): value is string => typeof value === "string");
  const entities = Array.isArray(story.entities)
    ? story.entities.filter((value): value is string => typeof value === "string")
    : [];
  return normalized([story.headline, story.summary, ...story.details, ...optional, ...entities].join(" "));
}

function endsLikeClippedExcerpt(value: string): boolean {
  return /(?:\.{3,}|…|\[\.\.\.\])\s*$/u.test(value.trim());
}

function assertEditorialCopy(story: NewsItem): void {
  const headline = story.headline.trim();
  const summary = story.summary.trim();
  const normalizedHeadline = normalized(headline);
  const normalizedSummary = normalized(summary);
  const normalizedDetails = normalized(story.details[0] ?? "");

  if (headline.length > 170) throw new Error(`Story ${story.id} headline is not concise`);
  if (summary.length > 420) throw new Error(`Story ${story.id} summary is not short`);
  if (endsLikeClippedExcerpt(headline)) throw new Error(`Story ${story.id} headline looks truncated`);
  if (endsLikeClippedExcerpt(summary)) throw new Error(`Story ${story.id} summary looks truncated`);
  if (
    normalizedHeadline.length >= 18
    && (normalizedSummary === normalizedHeadline || normalizedSummary.startsWith(`${normalizedHeadline} `))
  ) {
    throw new Error(`Story ${story.id} summary repeats its headline`);
  }
  if (
    normalizedSummary.length >= 36
    && (normalizedDetails === normalizedSummary || normalizedDetails.startsWith(`${normalizedSummary} `))
  ) {
    throw new Error(`Story ${story.id} details repeat its short summary`);
  }
}

export function assertEditorialPayload(payload: BriefingPayload, policy: TopicPolicy): void {
  for (const story of payload.news.items) {
    assertEditorialCopy(story);
    const assigned = new Set(story.topics.map((topic) => topic.id));
    const proposed = story.topics.filter((topic) => topic.status === "proposed");
    const text = storyText(story);
    for (const topic of story.topics) {
      const definition = policy.topics.get(topic.id);
      if (!definition) {
        if (topic.status !== "proposed" || !topic.aliases?.length) {
          throw new Error(`Story ${story.id} unknown topic ${topic.id} must be proposed explicitly`);
        }
        if (/\p{Script=Cyrillic}/u.test(topic.label) || topic.label.length > 48) {
          throw new Error(`Story ${story.id} proposed topic ${topic.id} requires a concise English label`);
        }
        const candidateTerms = [topic.id, topic.label, ...topic.aliases].map(normalized);
        for (const existing of policy.topics.values()) {
          const existingTerms = [existing.id, existing.label, ...existing.aliases].map(normalized);
          if (candidateTerms.some((candidate) => existingTerms.includes(candidate))) {
            throw new Error(`Story ${story.id} proposed topic ${topic.id} duplicates ${existing.id}`);
          }
        }
        continue;
      }
      if (topic.status === "proposed" || topic.aliases) {
        throw new Error(`Story ${story.id} must reuse registered topic ${topic.id} without proposal fields`);
      }
      if (topic.label !== definition.label) {
        throw new Error(`Story ${story.id} must use canonical label ${definition.label}`);
      }
      if (policy.geographyTopics.has(topic.id)) {
        const evidence = [definition.id, definition.label, ...definition.aliases]
          .map(normalized)
          .filter((value) => value.length >= 3);
        if (!evidence.some((value) => text.includes(value))) {
          throw new Error(`Story ${story.id} assigns geography ${topic.id} without textual evidence`);
        }
      }
    }
    for (const [broadTopic, required] of policy.refinements) {
      if (
        assigned.has(broadTopic)
        && ![...required].some((topicId) => assigned.has(topicId))
        && proposed.length === 0
      ) {
        throw new Error(`Story ${story.id} must refine broad topic ${broadTopic}`);
      }
    }
  }
}
