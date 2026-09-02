export type EditionType = "daily" | "cinema";
export type PayloadStatus = "complete" | "partial";
export type SectionState = "ready" | "empty" | "partial" | "stale" | "failed";
export type Reaction = "like" | "dislike";

export type MailClass = "ACTION" | "IMPORTANT" | "GENERAL";

export type KuramiNoteTarget =
  | "hero"
  | "news"
  | "calendar"
  | "mail"
  | "metric:mail"
  | "metric:stories"
  | "metric:time"
  | "metric:weather"
  | `calendar-event:${string}`
  | `mail-item:${string}`
  | `story:${string}`;

export type KuramiNote = {
  id: string;
  target: KuramiNoteTarget;
  text: string;
  role: "focus" | "context" | "action" | "reassurance" | "personality";
  tone: "signal" | "ink";
  rotation: "none" | "negative" | "positive";
  mark?: "arrow-down" | "arrow-down-right" | "arrow-right";
};

export type Topic = {
  id: string;
  label: string;
  status?: "proposed";
  aliases?: string[];
};

export type StoryMedia = {
  id: string;
  // Video remains readable only so already-published editions can be migrated
  // without making their stored payloads unparsable. New imports are image-only.
  kind: "image" | "video";
  src: string;
  alt: string;
  mimeType: string;
  posterSrc?: string;
  sourceKey?: string;
  providerItemId?: string;
};

export type StorySource = Record<string, unknown> & {
  sourceKey: string;
  itemIds: string[];
  mediaMessageIds?: string[];
};

export type EditorialSignals = {
  importance: "low" | "medium" | "high" | "critical";
  urgency: "none" | "soon" | "today";
  publicInterest: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  publishedAt?: string;
};

export type NewsItem = {
  id: string;
  fingerprint: string;
  headline: string;
  summary: string;
  details: string[];
  topics: Topic[];
  media?: StoryMedia[];
  sources?: StorySource[] | Array<Record<string, unknown>>;
  editorialSignals?: EditorialSignals;
  [key: string]: unknown;
};

function editorialSignals(value: unknown, label: string): EditorialSignals | undefined {
  if (value === undefined) return undefined;
  const signals = record(value, label);
  const importance = string(signals.importance, `${label}.importance`) as EditorialSignals["importance"];
  const urgency = string(signals.urgency, `${label}.urgency`) as EditorialSignals["urgency"];
  const publicInterest = string(signals.publicInterest, `${label}.publicInterest`) as EditorialSignals["publicInterest"];
  const confidence = string(signals.confidence, `${label}.confidence`) as EditorialSignals["confidence"];
  if (!new Set(["low", "medium", "high", "critical"]).has(importance)) fail(`${label}.importance is unsupported`);
  if (!new Set(["none", "soon", "today"]).has(urgency)) fail(`${label}.urgency is unsupported`);
  if (!new Set(["low", "medium", "high"]).has(publicInterest)) fail(`${label}.publicInterest is unsupported`);
  if (!new Set(["low", "medium", "high"]).has(confidence)) fail(`${label}.confidence is unsupported`);
  return {
    importance,
    urgency,
    publicInterest,
    confidence,
    ...(signals.publishedAt !== undefined
      ? { publishedAt: timestamp(signals.publishedAt, `${label}.publishedAt`) }
      : {}),
  };
}

export type MailItem = {
  id: string;
  provider?: "gmail";
  providerItemId?: string;
  class: MailClass;
  [key: string]: unknown;
};

export type NewsExclusion = {
  sourceKey: string;
  itemId: string;
  reason: "non-content" | "exact-duplicate" | "unsafe" | "unreadable";
  note?: string;
};

export type LiveSnapshot = {
  refreshedAt: string;
  state: SectionState;
  lastSuccessAt?: string;
};

export type SourceBatch = {
  sourceKey: string;
  provider: "telegram";
  providerSourceId: string;
  minItemId: string;
  maxItemId: string;
  itemIds: string[];
};

export type BriefingAddonEnvelope = {
  version: number;
  state: SectionState;
  capturedAt: string;
  data: Record<string, unknown>;
};

export type BriefingPayload = {
  schemaVersion: 1 | 2;
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
  live?: LiveSnapshot;
  weather?: Record<string, unknown> & { state: SectionState };
  calendar: Record<string, unknown> & { state: SectionState };
  mail: Record<string, unknown> & { state: SectionState; items: MailItem[] };
  news: Record<string, unknown> & {
    state: SectionState;
    items: NewsItem[];
    mainStoryIds?: string[];
    pageSize?: number;
    exclusions?: NewsExclusion[];
  };
  dataQuality: Record<string, unknown> & { state: SectionState };
  sourceBatches?: SourceBatch[];
  addons?: Record<string, BriefingAddonEnvelope>;
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
const ADDON_ID = /^[a-z][a-z0-9-]{0,63}$/;
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
const STATIC_NOTE_TARGETS = new Set<KuramiNoteTarget>([
  "hero",
  "news",
  "calendar",
  "mail",
  "metric:mail",
  "metric:stories",
  "metric:time",
  "metric:weather",
]);
const SCOPED_NOTE_TARGET = /^(?:calendar-event|mail-item|story):[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
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

export function parseBriefingAddonEnvelope(
  value: unknown,
  label = "addon",
): BriefingAddonEnvelope {
  const envelope = record(value, label);
  if (!Number.isSafeInteger(envelope.version) || Number(envelope.version) < 1) {
    fail(`${label}.version must be a positive safe integer`);
  }
  return {
    version: Number(envelope.version),
    state: sectionState(envelope.state, `${label}.state`),
    capturedAt: timestamp(envelope.capturedAt, `${label}.capturedAt`),
    data: record(envelope.data, `${label}.data`),
  };
}

function addonEnvelopes(value: unknown): Record<string, BriefingAddonEnvelope> | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, "addons");
  const entries = Object.entries(raw);
  if (entries.length > 32) fail("addons must contain no more than 32 entries");
  return Object.fromEntries(entries.map(([id, envelope]) => {
    if (!ADDON_ID.test(id)) fail(`addons.${id || "<empty>"} has an invalid ID`);
    return [id, parseBriefingAddonEnvelope(envelope, `addons.${id}`)];
  }));
}

/**
 * Payloads published before the add-on manifest existed keep the legacy full
 * briefing composition. Once a manifest exists, omission is an explicit
 * per-edition disable and remains fixed for that edition.
 */
export function briefingAddonEnabled(payload: BriefingPayload, addonId: string): boolean {
  return payload.addons === undefined
    ? true
    : Object.prototype.hasOwnProperty.call(payload.addons, addonId);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeWeather(value: Record<string, unknown>): BriefingPayload["weather"] {
  const state = sectionState(value.state, "weather.state");
  if (value.temperatureC !== undefined || value.temperatureCelsius === undefined) {
    return { ...value, state } as BriefingPayload["weather"];
  }

  const temperatureC = finiteNumber(value.temperatureCelsius);
  if (temperatureC === null) return { ...value, state } as BriefingPayload["weather"];

  const conditionRecord = value.condition !== undefined
    ? record(value.condition, "weather.condition")
    : undefined;
  const conditionLabel = conditionRecord ? optionalText(conditionRecord.label) : null;
  const conditionEmoji = conditionRecord ? optionalText(conditionRecord.emoji) : null;
  const condition = [conditionEmoji, conditionLabel].filter(Boolean).join(" ");
  const maximumCelsius = finiteNumber(value.maximumCelsius);
  const precipitationProbability = finiteNumber(value.precipitationProbabilityPercent);
  const summary = [
    maximumCelsius === null ? "" : `до ${Math.round(maximumCelsius)}°`,
    precipitationProbability === null ? "" : `осадки ${Math.round(precipitationProbability)}%`,
  ].filter(Boolean).join(" · ") || optionalText(value.location) || "";

  return {
    state,
    ...(optionalText(value.provider) ? { provider: optionalText(value.provider)! } : {}),
    ...(optionalText(value.location) ? { location: optionalText(value.location)! } : {}),
    ...(optionalText(value.observedAt) ? { observedAt: optionalText(value.observedAt)! } : {}),
    temperatureC,
    feelsLikeC: finiteNumber(value.apparentTemperatureCelsius),
    ...(condition ? { condition } : {}),
    ...(summary ? { summary } : {}),
  };
}

function mailClass(value: unknown, label: string): MailClass {
  const result = string(value, label).toUpperCase() as MailClass;
  if (result !== "ACTION" && result !== "IMPORTANT" && result !== "GENERAL") {
    fail(`${label} is unsupported`);
  }
  return result;
}

function topics(value: unknown, label: string): Topic[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    fail(`${label} must contain two to four topics`);
  }
  const seen = new Set<string>();
  const parsed = value.map((raw, index) => {
    const topic = record(raw, `${label}[${index}]`);
    const id = string(topic.id, `${label}[${index}].id`);
    const display = string(topic.label, `${label}[${index}].label`);
    if (!TOPIC_ID.test(id)) fail(`${label}[${index}].id is not canonical`);
    if (seen.has(id)) fail(`${label} contains duplicate topic ${id}`);
    seen.add(id);
    let status: "proposed" | undefined;
    if (topic.status !== undefined) {
      if (string(topic.status, `${label}[${index}].status`) !== "proposed") {
        fail(`${label}[${index}].status is unsupported`);
      }
      status = "proposed";
    }
    let aliases: string[] | undefined;
    if (topic.aliases !== undefined) {
      if (!Array.isArray(topic.aliases) || topic.aliases.length < 1 || topic.aliases.length > 8) {
        fail(`${label}[${index}].aliases must contain one to eight values`);
      }
      aliases = topic.aliases.map((alias, aliasIndex) =>
        string(alias, `${label}[${index}].aliases[${aliasIndex}]`)
      );
    }
    if (status === "proposed" && !aliases) {
      fail(`${label}[${index}] proposed topic requires aliases`);
    }
    if (!status && aliases) {
      fail(`${label}[${index}] aliases are allowed only for proposed topics`);
    }
    return { id, label: display, ...(status ? { status } : {}), ...(aliases ? { aliases } : {}) };
  });
  return parsed;
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
    let sourceKey: string | undefined;
    let providerItemId: string | undefined;
    if (asset.sourceKey !== undefined || asset.providerItemId !== undefined) {
      sourceKey = safeId(asset.sourceKey, `${label}[${index}].sourceKey`);
      providerItemId = safeId(asset.providerItemId, `${label}[${index}].providerItemId`);
      if (!sourceKey.startsWith("telegram:")) {
        fail(`${label}[${index}].sourceKey must be a Telegram source key`);
      }
    }
    return {
      id,
      kind,
      src,
      alt,
      mimeType,
      ...(posterSrc ? { posterSrc } : {}),
      ...(sourceKey && providerItemId ? { sourceKey, providerItemId } : {}),
    };
  });
}

function notes(value: unknown): KuramiNote[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    fail("notes must contain one to six notes");
  }
  const seenIds = new Set<string>();
  const seenTargets = new Set<KuramiNote["target"]>();
  const parsed = value.map((raw, index) => {
    const note = record(raw, `notes[${index}]`);
    const id = safeId(note.id, `notes[${index}].id`);
    if (seenIds.has(id)) fail(`notes contains duplicate ID ${id}`);
    seenIds.add(id);
    const target = string(note.target, `notes[${index}].target`) as KuramiNoteTarget;
    if (!STATIC_NOTE_TARGETS.has(target) && !SCOPED_NOTE_TARGET.test(target)) {
      fail(`notes[${index}].target is unsupported`);
    }
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
  if (parsed.filter((note) => note.role === "personality").length > 2) {
    fail("notes may contain at most two personality notes");
  }
  if (parsed.every((note) => note.role === "personality")) {
    fail("notes require at least one informative note");
  }
  return parsed;
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

function newsExclusions(value: unknown): NewsExclusion[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5_000) {
    fail("news.exclusions must be an array with at most 5000 entries");
  }
  const reasons = new Set<NewsExclusion["reason"]>([
    "non-content",
    "exact-duplicate",
    "unsafe",
    "unreadable",
  ]);
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const exclusion = record(raw, `news.exclusions[${index}]`);
    const sourceKey = safeId(exclusion.sourceKey, `news.exclusions[${index}].sourceKey`);
    if (!sourceKey.startsWith("telegram:")) {
      fail(`news.exclusions[${index}].sourceKey must be a Telegram source key`);
    }
    const itemId = safeId(exclusion.itemId, `news.exclusions[${index}].itemId`);
    const key = `${sourceKey}:${itemId}`;
    if (seen.has(key)) fail(`news.exclusions contains duplicate ${key}`);
    seen.add(key);
    const reason = string(exclusion.reason, `news.exclusions[${index}].reason`) as NewsExclusion["reason"];
    if (!reasons.has(reason)) fail(`news.exclusions[${index}].reason is unsupported`);
    let note: string | undefined;
    if (exclusion.note !== undefined) {
      note = string(exclusion.note, `news.exclusions[${index}].note`).trim();
      if (note.length > 240) fail(`news.exclusions[${index}].note exceeds 240 characters`);
    }
    return { sourceKey, itemId, reason, ...(note ? { note } : {}) };
  });
}

function storySources(
  value: unknown,
  label: string,
  schemaVersion: 1 | 2,
): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    fail(`${label} must contain one to 64 sources`);
  }
  if (schemaVersion === 1) {
    return value.map((raw, index) => record(raw, `${label}[${index}]`));
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const source = record(raw, `${label}[${index}]`);
    const sourceKey = safeId(source.sourceKey, `${label}[${index}].sourceKey`);
    if (!sourceKey.startsWith("telegram:")) {
      fail(`${label}[${index}].sourceKey must be a Telegram source key`);
    }
    if (source.provider !== undefined && source.provider !== "telegram") {
      fail(`${label}[${index}].provider must be telegram`);
    }
    if (!Array.isArray(source.itemIds) || source.itemIds.length < 1 || source.itemIds.length > 5_000) {
      fail(`${label}[${index}].itemIds is invalid`);
    }
    const itemIds = source.itemIds.map((itemId, itemIndex) =>
      safeId(itemId, `${label}[${index}].itemIds[${itemIndex}]`)
    );
    if (new Set(itemIds).size !== itemIds.length) {
      fail(`${label}[${index}].itemIds contains duplicates`);
    }
    const ownerKey = `${sourceKey}:${itemIds.join(",")}`;
    if (seen.has(ownerKey)) fail(`${label} contains a duplicate source claim`);
    seen.add(ownerKey);
    let mediaMessageIds: string[] | undefined;
    if (source.mediaMessageIds !== undefined) {
      if (!Array.isArray(source.mediaMessageIds) || source.mediaMessageIds.length > 12) {
        fail(`${label}[${index}].mediaMessageIds is invalid`);
      }
      mediaMessageIds = source.mediaMessageIds.map((itemId, itemIndex) =>
        safeId(itemId, `${label}[${index}].mediaMessageIds[${itemIndex}]`)
      );
      if (new Set(mediaMessageIds).size !== mediaMessageIds.length
        || mediaMessageIds.some((itemId) => !itemIds.includes(itemId))) {
        fail(`${label}[${index}].mediaMessageIds must be unique source item IDs`);
      }
    }
    return {
      ...source,
      sourceKey,
      provider: "telegram",
      itemIds,
      ...(mediaMessageIds ? { mediaMessageIds } : {}),
    };
  });
}

export function parseBriefingPayload(value: unknown): BriefingPayload {
  const root = record(value, "root");
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) {
    fail("schemaVersion must equal 1 or 2");
  }
  const schemaVersion = root.schemaVersion;

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
  const parsedAddons = addonEnvelopes(root.addons);
  let live: LiveSnapshot | undefined;
  if (root.live !== undefined) {
    const value = record(root.live, "live");
    live = {
      refreshedAt: timestamp(value.refreshedAt, "live.refreshedAt"),
      state: sectionState(value.state, "live.state"),
      ...(value.lastSuccessAt !== undefined
        ? { lastSuccessAt: timestamp(value.lastSuccessAt, "live.lastSuccessAt") }
        : {}),
    };
  }
  let weather: BriefingPayload["weather"];
  if (root.weather !== undefined) {
    const value = record(root.weather, "weather");
    weather = normalizeWeather(value);
  }
  const calendar = record(root.calendar, "calendar");
  calendar.state = sectionState(calendar.state, "calendar.state");
  const mail = record(root.mail, "mail");
  mail.state = sectionState(mail.state, "mail.state");
  if (!Array.isArray(mail.items)) fail("mail.items must be an array");
  const mailItems = mail.items.map((raw, index) => {
    const item = record(raw, `mail.items[${index}]`);
    if (schemaVersion === 2 && item.class === undefined) {
      fail(`mail.items[${index}].class is required in schemaVersion 2`);
    }
    const classification = item.class ?? item.classification ?? "GENERAL";
    const normalizedClass = mailClass(classification, `mail.items[${index}].class`);
    let provider: "gmail" | undefined;
    let providerItemId: string | undefined;
    if (item.provider !== undefined || item.providerItemId !== undefined) {
      if (string(item.provider, `mail.items[${index}].provider`) !== "gmail") {
        fail(`mail.items[${index}].provider is unsupported`);
      }
      provider = "gmail";
      providerItemId = safeId(item.providerItemId, `mail.items[${index}].providerItemId`);
    }
    if (item.demo !== true && (!provider || !providerItemId)) {
      fail(`mail.items[${index}] requires provider and providerItemId unless demo is true`);
    }
    const { classification: _legacyClassification, ...canonicalItem } = item;
    return {
      ...canonicalItem,
      id: safeId(item.id, `mail.items[${index}].id`),
      class: normalizedClass,
      ...(provider && providerItemId ? { provider, providerItemId } : {}),
    };
  });

  const news = record(root.news, "news");
  news.state = sectionState(news.state, "news.state");
  if (!Array.isArray(news.items)) fail("news.items must be an array");
  const newsItems = news.items.map((raw, index) => {
    const item = record(raw, `news.items[${index}]`);
    const sources = storySources(item.sources, `news.items[${index}].sources`, schemaVersion);
    return {
      ...item,
      id: safeId(item.id, `news.items[${index}].id`),
      fingerprint: safeId(item.fingerprint, `news.items[${index}].fingerprint`),
      headline: string(item.headline, `news.items[${index}].headline`),
      summary: string(item.summary, `news.items[${index}].summary`),
      details: details(item.details, `news.items[${index}].details`),
      topics: topics(item.topics, `news.items[${index}].topics`),
      media: media(item.media, `news.items[${index}].media`),
      editorialSignals: editorialSignals(item.editorialSignals, `news.items[${index}].editorialSignals`),
      ...(sources ? { sources } : {}),
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
  const exclusions = newsExclusions(news.exclusions);

  const dataQuality = record(root.dataQuality, "dataQuality");
  dataQuality.state = sectionState(dataQuality.state, "dataQuality.state");
  const parsed: BriefingPayload = {
    ...root,
    schemaVersion,
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
    ...(parsedAddons ? { addons: parsedAddons } : {}),
    ...(live ? { live } : {}),
    ...(weather ? { weather } : {}),
    calendar: calendar as BriefingPayload["calendar"],
    mail: { ...mail, items: mailItems } as BriefingPayload["mail"],
    news: { ...news, items: newsItems, ...(exclusions ? { exclusions } : {}) } as BriefingPayload["news"],
    dataQuality: dataQuality as BriefingPayload["dataQuality"],
  };

  if (parsed.notes) {
    const noteBudget = Math.min(6, Math.max(2, Math.ceil(parsed.news.items.length / 8)));
    if (parsed.notes.length > noteBudget) {
      fail(`notes exceeds the ${noteBudget}-note budget for ${parsed.news.items.length} stories`);
    }
  }

  if (parsed.notes) {
    const calendarIds = new Set<string>();
    for (const key of ["events", "allDayEvents", "demoEvents"] as const) {
      const values = parsed.calendar[key];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string") {
          calendarIds.add(String((value as Record<string, unknown>).id));
        }
      }
    }
    const mailIds = new Set(parsed.mail.items.map((item) => item.id));
    const storyIds = new Set(parsed.news.items.map((item) => item.id));
    for (const note of parsed.notes) {
      if (note.target.startsWith("calendar-event:") && !calendarIds.has(note.target.slice(15))) {
        fail(`note ${note.id} targets an unknown calendar event`);
      }
      if (note.target.startsWith("mail-item:") && !mailIds.has(note.target.slice(10))) {
        fail(`note ${note.id} targets an unknown mail item`);
      }
      if (note.target.startsWith("story:") && !storyIds.has(note.target.slice(6))) {
        fail(`note ${note.id} targets an unknown story`);
      }
    }
  }

  return parsed;
}

/**
 * Legacy schemaVersion 1 payloads remain readable so already-published pages
 * can still be served and refreshed. New daily production writes must use the
 * ingestion-gated schemaVersion 2 contract.
 */
export function assertProductionBriefingPayload(payload: BriefingPayload): void {
  if (payload.edition.type === "daily" && payload.schemaVersion !== 2) {
    fail("new daily production editions require schemaVersion 2");
  }
}

export function persistedItems(payload: BriefingPayload): PersistedItem[] {
  const items: PersistedItem[] = briefingAddonEnabled(payload, "news")
    ? payload.news.items.map((story) => ({
    itemId: story.id,
    itemType: "story",
    storyFingerprint: story.fingerprint,
    topics: story.topics,
    }))
    : [];
  const seen = new Set(items.map((item) => item.itemId));
  for (const message of briefingAddonEnabled(payload, "mail") ? payload.mail.items : []) {
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
