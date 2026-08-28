export type EditionType = "daily" | "cinema";
export type PayloadStatus = "complete" | "partial";
export type SectionState = "ready" | "empty" | "partial" | "stale" | "failed";
export type Reaction = "like" | "dislike";

export type Topic = {
  id: string;
  label: string;
};

export type NewsItem = {
  id: string;
  fingerprint: string;
  headline: string;
  summary: string;
  topics: Topic[];
  [key: string]: unknown;
};

export type MailItem = {
  id: string;
  [key: string]: unknown;
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
  calendar: Record<string, unknown> & { state: SectionState };
  mail: Record<string, unknown> & { state: SectionState; items: MailItem[] };
  news: Record<string, unknown> & {
    state: SectionState;
    items: NewsItem[];
    mainStoryIds?: string[];
    pageSize?: number;
  };
  dataQuality: Record<string, unknown> & { state: SectionState };
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
  const calendar = record(root.calendar, "calendar");
  calendar.state = sectionState(calendar.state, "calendar.state");
  const mail = record(root.mail, "mail");
  mail.state = sectionState(mail.state, "mail.state");
  if (!Array.isArray(mail.items)) fail("mail.items must be an array");
  const mailItems = mail.items.map((raw, index) => {
    const item = record(raw, `mail.items[${index}]`);
    return { ...item, id: safeId(item.id, `mail.items[${index}].id`) };
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
      topics: topics(item.topics, `news.items[${index}].topics`),
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
