export type EditionType = "daily" | "cinema";
export type PayloadStatus = "complete" | "partial";
export type SectionState = "ready" | "empty" | "partial" | "stale" | "failed";
export type Reaction = "like" | "dislike";

export type KuramiNote = {
  id: string;
  target: "hero" | "news";
  text: string;
  role: "focus" | "context" | "action" | "reassurance" | "personality";
  tone: "signal" | "ink";
  rotation: "none" | "negative" | "positive";
  mark?: "arrow-down" | "arrow-down-right" | "arrow-right";
};

export type Topic = {
  id: string;
  label: string;
};

export type StoryMedia = {
  id: string;
  kind: "image" | "video";
  src: string;
  alt: string;
  mimeType: string;
  posterSrc?: string;
};

export type NewsItem = {
  id: string;
  fingerprint: string;
  headline: string;
  summary: string;
  details: string[];
  topics: Topic[];
  media?: StoryMedia[];
  [key: string]: unknown;
};

export type MailItem = {
  id: string;
  provider?: "gmail";
  providerItemId?: string;
  [key: string]: unknown;
};

export type SourceBatch = {
  sourceKey: string;
  provider: "telegram";
  providerSourceId: string;
  minItemId: string;
  maxItemId: string;
  itemIds: string[];
};

export type BriefingPayload = {
  schemaVersion: 1;
  edition: {
    id: string;
    type: EditionType;
    localDate: string;
    timezone: string;
    generatedAt: string;
    status: PayloadStatus;
    retentionUntil: string;
  };
  hero: Record<string, unknown>;
  notes?: KuramiNote[];
  calendar: Record<string, unknown> & { state: SectionState };
  mail: Record<string, unknown> & { state: SectionState; items: MailItem[] };
  news: Record<string, unknown> & {
    state: SectionState;
    items: NewsItem[];
    mainStoryIds?: string[];
    pageSize?: number;
  };
  dataQuality: Record<string, unknown> & { state: SectionState };
  sourceBatches?: SourceBatch[];
  [key: string]: unknown;
};

export type PersistedItem = {
  itemId: string;
  itemType: "story" | "mail";
  storyFingerprint: string | null;
  topics: Topic[];
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TOPIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_STATES = new Set<SectionState>([
  "ready",
  "empty",
  "partial",
  "stale",
  "failed",
]);
const MEDIA_PATH = /^\/media\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MEDIA_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const NOTE_TARGETS = new Set<KuramiNote["target"]>(["hero", "news"]);
const NOTE_ROLES = new Set<KuramiNote["role"]>([
  "focus",
  "context",
  "action",
  "reassurance",
  "personality",
]);
const NOTE_TONES = new Set<KuramiNote["tone"]>(["signal", "ink"]);
const NOTE_ROTATIONS = new Set<KuramiNote["rotation"]>(["none", "negative", "positive"]);
const NOTE_MARKS = new Set<NonNullable<KuramiNote["mark"]>>([
  "arrow-down",
  "arrow-down-right",
  "arrow-right",
]);

function fail(message: string): never {
  throw new Error(`Invalid briefing payload: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  const result = string(value, label);
  if (!SAFE_ID.test(result)) fail(`${label} is unsafe`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) fail(`${label} must be RFC3339-compatible`);
  return result;
}

function sectionState(value: unknown, label: string): SectionState {
  const result = string(value, label) as SectionState;
  if (!SECTION_STATES.has(result)) fail(`${label} is unsupported`);
  return result;
}

function topics(value: unknown, label: string): Topic[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    fail(`${label} must contain two to four topics`);
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const topic = record(raw, `${label}[${index}]`);
    const id = string(topic.id, `${label}[${index}].id`);
    const display = string(topic.label, `${label}[${index}].label`);
    if (!TOPIC_ID.test(id)) fail(`${label}[${index}].id is not canonical`);
    if (seen.has(id)) fail(`${label} contains duplicate topic ${id}`);
    seen.add(id);
    return { id, label: display };
  });
}

function details(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    fail(`${label} must contain one to eight paragraphs`);
  }
  return value.map((paragraph, index) => {
    const result = string(paragraph, `${label}[${index}]`).trim();
    if (result.length > 4_000) fail(`${label}[${index}] exceeds 4000 characters`);
    return result;
  });
}

function media(value: unknown, label: string): StoryMedia[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    fail(`${label} must contain one to twelve assets`);
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const asset = record(raw, `${label}[${index}]`);
    const id = safeId(asset.id, `${label}[${index}].id`);
    if (seen.has(id)) fail(`${label} contains duplicate media ID ${id}`);
    seen.add(id);
    const kind = string(asset.kind, `${label}[${index}].kind`);
    if (kind !== "image" && kind !== "video") fail(`${label}[${index}].kind is unsupported`);
    const src = string(asset.src, `${label}[${index}].src`);
    if (!MEDIA_PATH.test(src) || src.includes("..")) fail(`${label}[${index}].src is unsafe`);
    const mimeType = string(asset.mimeType, `${label}[${index}].mimeType`);
    if (!MEDIA_MIME_TYPES.has(mimeType)) fail(`${label}[${index}].mimeType is unsupported`);
    if (!mimeType.startsWith(`${kind}/`)) fail(`${label}[${index}] kind and MIME type differ`);
    const alt = string(asset.alt, `${label}[${index}].alt`).trim();
    if (alt.length > 240) fail(`${label}[${index}].alt exceeds 240 characters`);
    let posterSrc: string | undefined;
    if (asset.posterSrc !== undefined) {
      posterSrc = string(asset.posterSrc, `${label}[${index}].posterSrc`);
      if (!MEDIA_PATH.test(posterSrc) || posterSrc.includes("..")) {
        fail(`${label}[${index}].posterSrc is unsafe`);
      }
    }
    return { id, kind, src, alt, mimeType, ...(posterSrc ? { posterSrc } : {}) };
  });
}

function notes(value: unknown): KuramiNote[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    fail("notes must contain one to three notes");
  }
  const seenIds = new Set<string>();
  const seenTargets = new Set<KuramiNote["target"]>();
  return value.map((raw, index) => {
    const note = record(raw, `notes[${index}]`);
    const id = safeId(note.id, `notes[${index}].id`);
    if (seenIds.has(id)) fail(`notes contains duplicate ID ${id}`);
    seenIds.add(id);
    const target = string(note.target, `notes[${index}].target`) as KuramiNote["target"];
    if (!NOTE_TARGETS.has(target)) fail(`notes[${index}].target is unsupported`);
    if (seenTargets.has(target)) fail(`notes contains duplicate target ${target}`);
    seenTargets.add(target);
    const text = string(note.text, `notes[${index}].text`).trim();
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length < 1 || words.length > 4 || text.length > 48) {
      fail(`notes[${index}].text must contain one to four words and at most 48 characters`);
    }
    const role = string(note.role, `notes[${index}].role`) as KuramiNote["role"];
    if (!NOTE_ROLES.has(role)) fail(`notes[${index}].role is unsupported`);
    const tone = string(note.tone, `notes[${index}].tone`) as KuramiNote["tone"];
    if (!NOTE_TONES.has(tone)) fail(`notes[${index}].tone is unsupported`);
    const rotation = string(note.rotation, `notes[${index}].rotation`) as KuramiNote["rotation"];
    if (!NOTE_ROTATIONS.has(rotation)) fail(`notes[${index}].rotation is unsupported`);
    let mark: KuramiNote["mark"];
    if (note.mark !== undefined) {
      mark = string(note.mark, `notes[${index}].mark`) as NonNullable<KuramiNote["mark"]>;
      if (!NOTE_MARKS.has(mark)) fail(`notes[${index}].mark is unsupported`);
    }
    return { id, target, text, role, tone, rotation, ...(mark ? { mark } : {}) };
  });
}

function sourceBatches(value: unknown): SourceBatch[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    fail("sourceBatches must contain one to 64 entries");
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const batch = record(raw, `sourceBatches[${index}]`);
    const sourceKey = safeId(batch.sourceKey, `sourceBatches[${index}].sourceKey`);
    if (seen.has(sourceKey)) fail(`sourceBatches contains duplicate source ${sourceKey}`);
    seen.add(sourceKey);
    if (string(batch.provider, `sourceBatches[${index}].provider`) !== "telegram") {
      fail(`sourceBatches[${index}].provider is unsupported`);
    }
    const providerSourceId = string(
      batch.providerSourceId,
      `sourceBatches[${index}].providerSourceId`,
    );
    if (!/^-?[1-9]\d{0,19}$/u.test(providerSourceId)) {
      fail(`sourceBatches[${index}].providerSourceId must be a Telegram numeric ID`);
    }
    const minItemId = safeId(batch.minItemId, `sourceBatches[${index}].minItemId`);
    const maxItemId = safeId(batch.maxItemId, `sourceBatches[${index}].maxItemId`);
    if (!Array.isArray(batch.itemIds) || batch.itemIds.length < 1 || batch.itemIds.length > 5000) {
      fail(`sourceBatches[${index}].itemIds is invalid`);
    }
    const itemIds = batch.itemIds.map((itemId, itemIndex) =>
      safeId(itemId, `sourceBatches[${index}].itemIds[${itemIndex}]`)
    );
    if (new Set(itemIds).size !== itemIds.length) {
      fail(`sourceBatches[${index}].itemIds contains duplicates`);
    }
    if (!itemIds.includes(minItemId) || !itemIds.includes(maxItemId)) {
      fail(`sourceBatches[${index}] boundaries must belong to itemIds`);
    }
    return { sourceKey, provider: "telegram", providerSourceId, minItemId, maxItemId, itemIds };
  });
}

export function parseBriefingPayload(value: unknown): BriefingPayload {
  const root = record(value, "root");
  if (root.schemaVersion !== 1) fail("schemaVersion must equal 1");

  const edition = record(root.edition, "edition");
  const type = string(edition.type, "edition.type") as EditionType;
  if (type !== "daily" && type !== "cinema") fail("edition.type is unsupported");
  const localDate = string(edition.localDate, "edition.localDate");
  if (!LOCAL_DATE.test(localDate)) fail("edition.localDate must be YYYY-MM-DD");
  const id = safeId(edition.id, "edition.id");
  if (id !== `${type}:${localDate}`) fail("edition.id must match type and localDate");
  const status = string(edition.status, "edition.status") as PayloadStatus;
  if (status !== "complete" && status !== "partial") {
    fail("edition.status must be complete or partial");
  }

  const hero = record(root.hero, "hero");
  const parsedNotes = notes(root.notes);
  const parsedSourceBatches = sourceBatches(root.sourceBatches);
  const calendar = record(root.calendar, "calendar");
  calendar.state = sectionState(calendar.state, "calendar.state");
  const mail = record(root.mail, "mail");
  mail.state = sectionState(mail.state, "mail.state");
  if (!Array.isArray(mail.items)) fail("mail.items must be an array");
  const mailItems = mail.items.map((raw, index) => {
    const item = record(raw, `mail.items[${index}]`);
    let provider: "gmail" | undefined;
    let providerItemId: string | undefined;
    if (item.provider !== undefined || item.providerItemId !== undefined) {
      if (string(item.provider, `mail.items[${index}].provider`) !== "gmail") {
        fail(`mail.items[${index}].provider is unsupported`);
      }
      provider = "gmail";
      providerItemId = safeId(item.providerItemId, `mail.items[${index}].providerItemId`);
    }
    return {
      ...item,
      id: safeId(item.id, `mail.items[${index}].id`),
      ...(provider && providerItemId ? { provider, providerItemId } : {}),
    };
  });

  const news = record(root.news, "news");
  news.state = sectionState(news.state, "news.state");
  if (!Array.isArray(news.items)) fail("news.items must be an array");
  const newsItems = news.items.map((raw, index) => {
    const item = record(raw, `news.items[${index}]`);
    return {
      ...item,
      id: safeId(item.id, `news.items[${index}].id`),
      fingerprint: safeId(item.fingerprint, `news.items[${index}].fingerprint`),
      headline: string(item.headline, `news.items[${index}].headline`),
      summary: string(item.summary, `news.items[${index}].summary`),
      details: details(item.details, `news.items[${index}].details`),
      topics: topics(item.topics, `news.items[${index}].topics`),
      media: media(item.media, `news.items[${index}].media`),
    };
  });
  const itemIds = new Set(newsItems.map((item) => item.id));
  if (itemIds.size !== newsItems.length) fail("news.items contains duplicate IDs");
  if (news.mainStoryIds !== undefined) {
    if (!Array.isArray(news.mainStoryIds)) fail("news.mainStoryIds must be an array");
    for (const [index, raw] of news.mainStoryIds.entries()) {
      const mainId = safeId(raw, `news.mainStoryIds[${index}]`);
      if (!itemIds.has(mainId)) fail(`unknown main story ID ${mainId}`);
    }
  }
  if (news.pageSize !== undefined) {
    const pageSize = news.pageSize;
    if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 10 || pageSize > 12) {
      fail("news.pageSize must be an integer from 10 to 12");
    }
  }

  const dataQuality = record(root.dataQuality, "dataQuality");
  dataQuality.state = sectionState(dataQuality.state, "dataQuality.state");
  const parsed: BriefingPayload = {
    ...root,
    schemaVersion: 1,
    edition: {
      id,
      type,
      localDate,
      timezone: string(edition.timezone, "edition.timezone"),
      generatedAt: timestamp(edition.generatedAt, "edition.generatedAt"),
      status,
      retentionUntil: timestamp(edition.retentionUntil, "edition.retentionUntil"),
    },
    hero,
    ...(parsedNotes ? { notes: parsedNotes } : {}),
    ...(parsedSourceBatches ? { sourceBatches: parsedSourceBatches } : {}),
    calendar: calendar as BriefingPayload["calendar"],
    mail: { ...mail, items: mailItems } as BriefingPayload["mail"],
    news: { ...news, items: newsItems } as BriefingPayload["news"],
    dataQuality: dataQuality as BriefingPayload["dataQuality"],
  };

  return parsed;
}

export function persistedItems(payload: BriefingPayload): PersistedItem[] {
  const items: PersistedItem[] = payload.news.items.map((story) => ({
    itemId: story.id,
    itemType: "story",
    storyFingerprint: story.fingerprint,
    topics: story.topics,
  }));
  const seen = new Set(items.map((item) => item.itemId));
  for (const message of payload.mail.items) {
    if (seen.has(message.id)) fail(`duplicate cross-section item ID ${message.id}`);
    seen.add(message.id);
    items.push({
      itemId: message.id,
      itemType: "mail",
      storyFingerprint: null,
      topics: [],
    });
  }
  return items;
}
