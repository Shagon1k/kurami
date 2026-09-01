import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DynamicBriefingSnapshot } from "./providers/dynamic-snapshot.ts";
import type { Topic, KuramiNote, NewsExclusion, NewsItem, BriefingPayload, MailClass } from "./model.ts";
import { parseBriefingPayload } from "./model.ts";
import {
  calendarConflicts,
  calendarEvent,
  mailItem,
  providerComplete,
  refreshDataQuality,
  sectionState,
  weatherValue,
} from "./poller.ts";
import { applyDeterministicRanking } from "./ranking.ts";
import { validateTelegramBatch, type TelegramBatchReport } from "./telegram-batch.ts";

type JsonRecord = Record<string, unknown>;

export type EditorialStoryDraft = {
  sourceItemIds: string[];
  headline: string;
  summary: string;
  details: string[];
  topics: Topic[];
  signals: NonNullable<NewsItem["editorialSignals"]>;
  depth?: "featured" | "standard" | "compact";
  whyItMatters?: string;
  entities?: string[];
};

export type EditorialBriefingDraft = {
  editionId: string;
  generatedAt: string;
  hero?: { title?: string; subtitle?: string };
  notes?: Array<Omit<KuramiNote, "target"> & { target: KuramiNote["target"] | `story-source:${string}` }>;
  stories: EditorialStoryDraft[];
  exclusions?: Array<{
    sourceItemId: string;
    reason: NewsExclusion["reason"];
    note?: string;
  }>;
  mailClassifications?: Record<string, MailClass>;
};

type NormalizedTelegramItem = {
  id: string;
  sourceDetail: string;
  title: string;
  content: string;
  publishedAt?: string;
  externalUrl?: string;
  metadata: {
    telegramChatId: number;
    telegramMessageId: number;
    mediaMessageIds?: number[];
  };
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function strings(value: unknown, label: string, minimum = 1): string[] {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`${label} must be an array`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function parseDraft(value: unknown): EditorialBriefingDraft {
  const root = record(value, "editorial draft");
  const editionId = string(root.editionId, "editorial draft.editionId");
  if (!/^daily:\d{4}-\d{2}-\d{2}$/u.test(editionId)) throw new Error("editorial draft editionId is invalid");
  const generatedAt = string(root.generatedAt, "editorial draft.generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("editorial draft.generatedAt is invalid");
  if (!Array.isArray(root.stories)) throw new Error("editorial draft.stories must be an array");
  const stories = root.stories.map((raw, index): EditorialStoryDraft => {
    const story = record(raw, `editorial draft.stories[${index}]`);
    const signals = record(story.signals, `editorial draft.stories[${index}].signals`);
    const topics = story.topics;
    if (!Array.isArray(topics)) throw new Error(`editorial draft.stories[${index}].topics must be an array`);
    return {
      sourceItemIds: strings(story.sourceItemIds, `editorial draft.stories[${index}].sourceItemIds`),
      headline: string(story.headline, `editorial draft.stories[${index}].headline`),
      summary: string(story.summary, `editorial draft.stories[${index}].summary`),
      details: strings(story.details, `editorial draft.stories[${index}].details`),
      topics: topics as Topic[],
      signals: {
        importance: string(signals.importance, "signals.importance") as EditorialStoryDraft["signals"]["importance"],
        urgency: string(signals.urgency, "signals.urgency") as EditorialStoryDraft["signals"]["urgency"],
        publicInterest: string(signals.publicInterest, "signals.publicInterest") as EditorialStoryDraft["signals"]["publicInterest"],
        confidence: string(signals.confidence, "signals.confidence") as EditorialStoryDraft["signals"]["confidence"],
        ...(signals.publishedAt !== undefined
          ? { publishedAt: string(signals.publishedAt, "signals.publishedAt") }
          : {}),
      },
      ...(story.depth !== undefined ? { depth: string(story.depth, "story.depth") as EditorialStoryDraft["depth"] } : {}),
      ...(story.whyItMatters !== undefined ? { whyItMatters: string(story.whyItMatters, "story.whyItMatters") } : {}),
      ...(story.entities !== undefined ? { entities: strings(story.entities, "story.entities", 0) } : {}),
    };
  });
  if (root.exclusions !== undefined && !Array.isArray(root.exclusions)) {
    throw new Error("editorial draft.exclusions must be an array");
  }
  const exclusions = root.exclusions === undefined ? undefined : root.exclusions.map((raw, index) => {
    const item = record(raw, `editorial draft.exclusions[${index}]`);
    return {
      sourceItemId: string(item.sourceItemId, `editorial draft.exclusions[${index}].sourceItemId`),
      reason: string(item.reason, `editorial draft.exclusions[${index}].reason`) as NewsExclusion["reason"],
      ...(item.note !== undefined ? { note: string(item.note, `editorial draft.exclusions[${index}].note`) } : {}),
    };
  });
  return {
    editionId,
    generatedAt,
    ...(root.hero && typeof root.hero === "object" && !Array.isArray(root.hero) ? { hero: root.hero as EditorialBriefingDraft["hero"] } : {}),
    ...(Array.isArray(root.notes) ? { notes: root.notes as EditorialBriefingDraft["notes"] } : {}),
    stories,
    ...(exclusions ? { exclusions } : {}),
    ...(root.mailClassifications && typeof root.mailClassifications === "object" && !Array.isArray(root.mailClassifications)
      ? { mailClassifications: root.mailClassifications as Record<string, MailClass> }
      : {}),
  };
}

function normalizedItems(value: unknown): NormalizedTelegramItem[] {
  const root = record(value, "normalized Telegram batch");
  if (!Array.isArray(root.items)) throw new Error("normalized Telegram batch.items must be an array");
  return root.items.map((raw, index) => {
    const item = record(raw, `normalized.items[${index}]`);
    const metadata = record(item.metadata, `normalized.items[${index}].metadata`);
    const chatId = metadata.telegramChatId;
    const messageId = metadata.telegramMessageId;
    if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) {
      throw new Error(`normalized.items[${index}] has invalid Telegram identity`);
    }
    return {
      id: string(item.id, `normalized.items[${index}].id`),
      sourceDetail: string(item.sourceDetail, `normalized.items[${index}].sourceDetail`),
      title: string(item.title, `normalized.items[${index}].title`),
      content: string(item.content, `normalized.items[${index}].content`),
      ...(typeof item.publishedAt === "string" ? { publishedAt: item.publishedAt } : {}),
      ...(typeof item.externalUrl === "string" ? { externalUrl: item.externalUrl } : {}),
      metadata: {
        telegramChatId: chatId as number,
        telegramMessageId: messageId as number,
        ...(Array.isArray(metadata.mediaMessageIds)
          ? { mediaMessageIds: metadata.mediaMessageIds.filter((value): value is number => Number.isSafeInteger(value)) }
          : {}),
      },
    };
  });
}

function canonicalSource(item: NormalizedTelegramItem): string {
  const match = /^telegram:([^:]+):\d+$/u.exec(item.id);
  if (!match) throw new Error(`Unsupported normalized Telegram item ID ${item.id}`);
  return `telegram:${match[1]}`;
}

function assertExactDuplicatesCoowned(
  drafts: EditorialStoryDraft[],
  lookup: Map<string, NormalizedTelegramItem>,
): void {
  const ownerByItem = new Map<string, number>();
  drafts.forEach((draft, index) => draft.sourceItemIds.forEach((itemId) => ownerByItem.set(itemId, index)));
  const signatureOwners = new Map<string, number>();
  for (const [itemId, owner] of ownerByItem) {
    const item = lookup.get(itemId);
    if (!item) continue;
    const normalized = item.content
      .normalize("NFKC")
      .toLocaleLowerCase("ru")
      .replaceAll(/https?:\/\/\S+/gu, " ")
      .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (normalized.length < 80) continue;
    const signature = createHash("sha256").update(normalized).digest("hex");
    const prior = signatureOwners.get(signature);
    if (prior !== undefined && prior !== owner) {
      throw new Error("Exact duplicate Telegram content must belong to one merged story");
    }
    signatureOwners.set(signature, owner);
  }
}

function storyFromDraft(draft: EditorialStoryDraft, lookup: Map<string, NormalizedTelegramItem>): NewsItem {
  const owned = draft.sourceItemIds.map((id) => {
    const item = lookup.get(id);
    if (!item) throw new Error(`Editorial story references unknown Telegram item ${id}`);
    return item;
  });
  const ownershipDigest = createHash("sha256").update([...draft.sourceItemIds].sort().join("\n")).digest("hex");
  const plain = (value: string) => value.toLocaleLowerCase("ru").replaceAll(/[^\p{L}\p{N}]+/gu, " ").trim();
  const headline = plain(draft.headline);
  const summary = plain(draft.summary);
  if (headline.length < 12 || summary.length < 32) {
    throw new Error("Editorial headline or summary is too short to be independently useful");
  }
  if (owned.some((item) => plain(item.title) === headline && headline.length >= 18)) {
    throw new Error("Editorial headline must not copy the provider title verbatim");
  }
  if (owned.some((item) => {
    const content = plain(item.content);
    return summary.length >= 36 && (content === summary || content.startsWith(`${summary} `));
  })) {
    throw new Error("Editorial summary must not be a truncated source prefix");
  }
  const id = `story-${ownershipDigest.slice(0, 16)}`;
  const grouped = new Map<string, NormalizedTelegramItem[]>();
  for (const item of owned) {
    const key = canonicalSource(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const sources = [...grouped.entries()].map(([sourceKey, items]) => {
    const first = items[0]!;
    const itemIds = items.map((item) => String(item.metadata.telegramMessageId));
    const mediaMessageIds = [...new Set(items.flatMap((item) => item.metadata.mediaMessageIds ?? []))]
      .map(String);
    return {
      sourceKey,
      provider: "telegram",
      sourceLabel: first.sourceDetail,
      itemIds,
      ...(mediaMessageIds.length ? { mediaMessageIds } : {}),
      ...(first.publishedAt ? { publishedAt: first.publishedAt } : {}),
      ...(first.externalUrl ? { url: first.externalUrl } : {}),
    };
  });
  return {
    id,
    fingerprint: `tg-${ownershipDigest}`,
    headline: draft.headline,
    summary: draft.summary,
    details: draft.details,
    topics: draft.topics,
    sources,
    editorialSignals: draft.signals,
    depth: draft.depth ?? (draft.details.join(" ").length > 900 ? "featured" : draft.details.join(" ").length < 350 ? "compact" : "standard"),
    ...(draft.whyItMatters ? { whyItMatters: draft.whyItMatters } : {}),
    ...(draft.entities ? { entities: draft.entities } : {}),
  };
}

function sourceBatches(report: TelegramBatchReport): BriefingPayload["sourceBatches"] {
  return report.channels.filter((channel) => channel.itemIds.length > 0).map((channel) => {
    const ids = channel.itemIds.map(String);
    if (channel.upperMessageId === null) throw new Error(`Telegram channel ${channel.sourceKey} has no upper boundary`);
    return {
      sourceKey: `telegram:${channel.sourceKey}`,
      provider: "telegram" as const,
      providerSourceId: String(channel.channelId),
      minItemId: String(Math.min(...channel.itemIds)),
      maxItemId: String(channel.upperMessageId),
      itemIds: ids,
    };
  });
}

function exclusions(
  values: EditorialBriefingDraft["exclusions"],
  lookup: Map<string, NormalizedTelegramItem>,
): NewsExclusion[] | undefined {
  if (!values?.length) return undefined;
  return values.map((value) => {
    const item = lookup.get(value.sourceItemId);
    if (!item) throw new Error(`Editorial exclusion references unknown Telegram item ${value.sourceItemId}`);
    return {
      sourceKey: canonicalSource(item),
      itemId: String(item.metadata.telegramMessageId),
      reason: value.reason,
      ...(value.note ? { note: value.note } : {}),
    };
  });
}

function resolvedNotes(
  notes: EditorialBriefingDraft["notes"],
  drafts: EditorialStoryDraft[],
  stories: NewsItem[],
): KuramiNote[] | undefined {
  if (!notes?.length) return undefined;
  return notes.map((note) => {
    if (!note.target.startsWith("story-source:")) return note as KuramiNote;
    const sourceItemId = note.target.slice("story-source:".length);
    const index = drafts.findIndex((draft) => draft.sourceItemIds.includes(sourceItemId));
    if (index < 0 || !stories[index]) throw new Error(`Kurami Note targets unknown source item ${sourceItemId}`);
    return { ...note, target: `story:${stories[index]!.id}` } as KuramiNote;
  });
}

function sections(snapshot: DynamicBriefingSnapshot, classifications: Record<string, MailClass> = {}): {
  live: NonNullable<BriefingPayload["live"]>;
  mail: BriefingPayload["mail"];
  calendar: BriefingPayload["calendar"];
  weather: BriefingPayload["weather"];
} {
  const live = {
    refreshedAt: snapshot.refreshedAt,
    state: sectionState(snapshot.state),
    ...(snapshot.state === "ready" || snapshot.state === "empty" ? { lastSuccessAt: snapshot.refreshedAt } : {}),
  };
  const mail = providerComplete(snapshot.gmail)
    ? {
      state: sectionState(snapshot.gmail.state),
      count: snapshot.gmail.value.unreadCount,
      fetchedAt: snapshot.gmail.fetchedAt,
      items: snapshot.gmail.value.items.map((item) => {
        const normalized = mailItem(item);
        const override = classifications[item.id] ?? classifications[item.providerItemId];
        return override ? { ...normalized, class: override } : normalized;
      }),
    }
    : { state: "failed" as const, items: [] };
  const calendarItems = providerComplete(snapshot.calendar) ? snapshot.calendar.value.items : [];
  const calendar = providerComplete(snapshot.calendar)
    ? {
      state: calendarItems.length ? "ready" as const : "empty" as const,
      fetchedAt: snapshot.calendar.fetchedAt,
      allDayEvents: calendarItems.filter((item) => item.allDay).map(calendarEvent),
      events: calendarItems.filter((item) => !item.allDay).map(calendarEvent),
      conflicts: calendarConflicts(calendarItems),
      sources: snapshot.calendar.value.sources,
    }
    : { state: "failed" as const, events: [], allDayEvents: [], conflicts: [] };
  const weather = providerComplete(snapshot.weather)
    ? weatherValue(snapshot.weather.value, sectionState(snapshot.weather.state))
    : { state: "failed" as const, location: "Vilnius", summary: "Прогноз временно недоступен" };
  return { live, mail, calendar, weather };
}

export async function composeBriefingPayload(input: {
  draftPath: string;
  livePath: string;
  configPath: string;
  rawPath: string;
  normalizedPath: string;
  outputPath?: string;
}): Promise<{ payload: BriefingPayload; report: TelegramBatchReport; outputPath?: string }> {
  const [draftValue, liveValue, normalizedValue] = await Promise.all([
    readFile(input.draftPath, "utf8").then(JSON.parse),
    readFile(input.livePath, "utf8").then(JSON.parse),
    readFile(input.normalizedPath, "utf8").then(JSON.parse),
  ]);
  const draft = parseDraft(draftValue);
  const snapshot = liveValue as DynamicBriefingSnapshot;
  if (snapshot.localDate !== draft.editionId.slice(6)) throw new Error("Editorial draft and live snapshot dates differ");
  const report = await validateTelegramBatch(input.configPath, input.rawPath, input.normalizedPath);
  if (!report.complete) throw new Error("Deterministic composer requires a complete Telegram capture");
  const items = normalizedItems(normalizedValue);
  const lookup = new Map(items.map((item) => [item.id, item]));
  if (lookup.size !== items.length) throw new Error("Normalized Telegram batch contains duplicate item IDs");
  const builtSections = sections(snapshot, draft.mailClassifications);
  const localDate = draft.editionId.slice(6);
  assertExactDuplicatesCoowned(draft.stories, lookup);
  const stories = draft.stories.map((story) => storyFromDraft(story, lookup));
  const notes = resolvedNotes(draft.notes, draft.stories, stories);
  const base = parseBriefingPayload({
    schemaVersion: 2,
    edition: {
      id: draft.editionId,
      type: "daily",
      localDate,
      timezone: "Europe/Vilnius",
      generatedAt: draft.generatedAt,
      status: snapshot.state === "failed" || snapshot.state === "partial" ? "partial" : "complete",
      retentionUntil: new Date(Date.parse(`${localDate}T00:00:00Z`) + 5 * 86_400_000).toISOString(),
    },
    hero: {
      title: draft.hero?.title ?? "Утренний обзор",
      subtitle: draft.hero?.subtitle ?? "Главное к началу дня.",
    },
    ...(notes ? { notes } : {}),
    ...builtSections,
    news: {
      state: "ready",
      pageSize: 10,
      items: stories,
      ...(exclusions(draft.exclusions, lookup) ? { exclusions: exclusions(draft.exclusions, lookup) } : {}),
    },
    dataQuality: { state: "ready", summary: "" },
    sourceBatches: sourceBatches(report),
  });
  refreshDataQuality(base, snapshot.refreshedAt);
  const payload = parseBriefingPayload(applyDeterministicRanking(base));
  if (input.outputPath) {
    const outputPath = resolve(input.outputPath);
    const temporary = resolve(dirname(outputPath), `.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, outputPath);
  }
  return { payload, report, ...(input.outputPath ? { outputPath: resolve(input.outputPath) } : {}) };
}
