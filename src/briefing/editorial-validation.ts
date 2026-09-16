import { section } from "./addons/envelopes.ts";
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
  genericTopics: Set<string>;
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
  const genericTopics = new Set(stringArray(
    validation.generic_topics ?? [],
    "validation.generic_topics",
  ));
  const rawRefinements = record(validation.required_refinements ?? {}, "validation.required_refinements");
  const refinements = new Map<string, Set<string>>();
  for (const [broadTopic, rawSpecificTopics] of Object.entries(rawRefinements)) {
    refinements.set(broadTopic, new Set(stringArray(
      rawSpecificTopics,
      `validation.required_refinements.${broadTopic}`,
    )));
  }
  for (const topicId of [...geographyTopics, ...genericTopics, ...refinements.keys()]) {
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
    genericTopics,
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

function wordCount(value: string): number {
  return normalized(value).split(/\s+/u).filter(Boolean).length;
}

const FORBIDDEN_HEADLINE_PREFIX = /^(?:что произошло|главное|новость|исходная публикация)\s*[:—-]/iu;
const META_SUMMARY = /(?:подробност(?:и|ей)|первоисточник|источник)\s+(?:и\s+)?(?:сохран(?:ен|ён|ены|ённые)|доступ(?:ен|ны)|наход(?:ится|ятся))|(?:сохран(?:ен|ён|ены)|доступ(?:ен|ны))\s+в\s+раскрыти|нажмите\s+(?:читать|подробнее)|читайте\s+(?:далее|в\s+источнике)/iu;
const SOURCE_WRAPPER = /^(?:исходная публикация|текст источника|оригинал|источник)\s*:/iu;

function editorialCopyIssues(story: NewsItem): string[] {
  const issues: string[] = [];
  const headline = story.headline.trim();
  const summary = story.summary.trim();
  const normalizedHeadline = normalized(headline);
  const normalizedSummary = normalized(summary);
  const normalizedDetails = normalized(story.details[0] ?? "");

  if (headline.length > 120 || wordCount(headline) > 18) issues.push(`Story ${story.id} headline is not concise`);
  if (FORBIDDEN_HEADLINE_PREFIX.test(headline)) issues.push(`Story ${story.id} headline uses a generic template prefix`);
  if (summary.length > 360 || wordCount(summary) > 55) issues.push(`Story ${story.id} summary is not short`);
  if (META_SUMMARY.test(summary)) issues.push(`Story ${story.id} summary contains UI or source-navigation filler`);
  if (SOURCE_WRAPPER.test(story.details[0] ?? "")) issues.push(`Story ${story.id} details wrap source text instead of retelling it`);
  if (endsLikeClippedExcerpt(headline)) issues.push(`Story ${story.id} headline looks truncated`);
  if (endsLikeClippedExcerpt(summary)) issues.push(`Story ${story.id} summary looks truncated`);
  if (
    normalizedHeadline.length >= 18
    && (normalizedSummary === normalizedHeadline || normalizedSummary.startsWith(`${normalizedHeadline} `))
  ) {
    issues.push(`Story ${story.id} summary repeats its headline`);
  }
  if (
    normalizedSummary.length >= 36
    && (normalizedDetails === normalizedSummary || normalizedDetails.startsWith(`${normalizedSummary} `))
  ) {
    issues.push(`Story ${story.id} details repeat its short summary`);
  }
  return issues;
}

export function storyNoteDistributionIssues(payload: BriefingPayload): string[] {
  const noteBudget = Math.min(6, Math.max(1, Math.ceil(section(payload, "news").items.length / 5)));
  if ((payload.notes?.length ?? 0) !== noteBudget) {
    return [`Kurami Notes must contain exactly ${noteBudget} notes for ${section(payload, "news").items.length} stories`];
  }
  const storyPositions = new Map(section(payload, "news").items.map((story, index) => [story.id, index]));
  const occupiedBands = new Set<number>();
  for (const note of payload.notes ?? []) {
    if (!note.target.startsWith("story:")) continue;
    const position = storyPositions.get(note.target.slice(6));
    if (position === undefined) continue;
    const band = Math.floor(position / 5);
    if (occupiedBands.has(band)) return ["Story notes must target different five-story bands"];
    occupiedBands.add(band);
  }
  return [];
}

export function assertKuramiNoteContract(payload: BriefingPayload): void {
  const issues = storyNoteDistributionIssues(payload);
  if (issues.length) throw new Error(`Kurami Note validation failed: ${issues.join("; ")}`);
}

export function assertEditorialPayload(payload: BriefingPayload, policy: TopicPolicy): void {
  const issues: string[] = [];
  const summaryOwners = new Map<string, string>();
  const globalTopicSets = new Map<string, number>();
  const sourceTopicSets = new Map<string, number>();
  for (const story of section(payload, "news").items) {
    issues.push(...editorialCopyIssues(story));
    const summaryKey = normalized(story.summary);
    const summaryOwner = summaryOwners.get(summaryKey);
    if (summaryOwner) {
      issues.push(`Stories ${summaryOwner} and ${story.id} reuse the same summary`);
    } else {
      summaryOwners.set(summaryKey, story.id);
    }
    const assigned = new Set(story.topics.map((topic) => topic.id));
    const proposed = story.topics.filter((topic) => topic.status === "proposed");
    const text = storyText(story);
    const topicSet = [...assigned].sort().join(",");
    globalTopicSets.set(topicSet, (globalTopicSets.get(topicSet) ?? 0) + 1);
    const sourceKeys = (Array.isArray(story.sources) ? story.sources : [])
      .map((source) => typeof source.sourceKey === "string" ? source.sourceKey : "")
      .filter(Boolean);
    for (const sourceKey of sourceKeys) {
      const key = `${sourceKey}\n${topicSet}`;
      sourceTopicSets.set(key, (sourceTopicSets.get(key) ?? 0) + 1);
    }
    for (const topic of story.topics) {
      const definition = policy.topics.get(topic.id);
      if (!definition) {
        if (topic.status !== "proposed" || !topic.aliases?.length) {
          issues.push(`Story ${story.id} unknown topic ${topic.id} must be proposed explicitly`);
          continue;
        }
        if (/\p{Script=Cyrillic}/u.test(topic.label) || topic.label.length > 48) {
          issues.push(`Story ${story.id} proposed topic ${topic.id} requires a concise English label`);
        }
        const candidateTerms = [topic.id, topic.label, ...topic.aliases].map(normalized);
        for (const existing of policy.topics.values()) {
          const existingTerms = [existing.id, existing.label, ...existing.aliases].map(normalized);
          if (candidateTerms.some((candidate) => existingTerms.includes(candidate))) {
            issues.push(`Story ${story.id} proposed topic ${topic.id} duplicates ${existing.id}`);
          }
        }
        continue;
      }
      if (topic.status === "proposed" || topic.aliases) {
        issues.push(`Story ${story.id} must reuse registered topic ${topic.id} without proposal fields`);
      }
      if (topic.label !== definition.label) {
        issues.push(`Story ${story.id} must use canonical label ${definition.label}`);
      }
      if (policy.geographyTopics.has(topic.id)) {
        const evidence = [definition.id, definition.label, ...definition.aliases]
          .map(normalized)
          .filter((value) => value.length >= 3);
        if (!evidence.some((value) => text.includes(value))) {
          issues.push(`Story ${story.id} assigns geography ${topic.id} without textual evidence`);
        }
      }
    }
    for (const [broadTopic, required] of policy.refinements) {
      if (
        assigned.has(broadTopic)
        && ![...required].some((topicId) => assigned.has(topicId))
        && proposed.length === 0
      ) {
        issues.push(`Story ${story.id} must refine broad topic ${broadTopic}`);
      }
    }
    const hasSpecificTopic = story.topics.some((topic) =>
      topic.status === "proposed"
      || (!policy.genericTopics.has(topic.id) && !policy.geographyTopics.has(topic.id))
    );
    if (!hasSpecificTopic) {
      issues.push(`Story ${story.id} topics are only broad containers or geography; add a contextual subtype`);
    }
  }
  const globalLimit = Math.max(3, Math.ceil(section(payload, "news").items.length / 10));
  for (const [topicSet, count] of globalTopicSets) {
    if (count > globalLimit) {
      issues.push(`Topic set ${topicSet} is reused by ${count} stories; maximum is ${globalLimit}`);
    }
  }
  for (const [key, count] of sourceTopicSets) {
    if (count > 3) {
      const [sourceKey, topicSet] = key.split("\n");
      issues.push(`Source ${sourceKey} reuses topic set ${topicSet} for ${count} stories; maximum is 3`);
    }
  }
  if (issues.length) {
    const visible = issues.slice(0, 40);
    const remainder = issues.length - visible.length;
    throw new Error([
      "Editorial validation failed:",
      ...visible.map((issue) => `- ${issue}`),
      ...(remainder ? [`- …and ${remainder} more issue(s)`] : []),
    ].join("\n"));
  }
}
