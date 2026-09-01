import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

type BatchState = "ready" | "empty" | "partial" | "failed";

export type ChannelReport = {
  sourceKey: string;
  channelId: number;
  label: string;
  state: BatchState;
  capturedUnread: number;
  fetched: number;
  normalized: number;
  upperMessageId: number | null;
  /** Eligible image messages only. */
  mediaMessages: number;
  skippedNonImageMessages: number;
  albumGroups: number;
  itemIds: number[];
  /** Eligible image message IDs only; this is the commit-gate inventory. */
  mediaItemIds: number[];
  /** Diagnostic-only IDs; these stay available through the Telegram source URL. */
  nonImageMediaItemIds: number[];
};

export type TelegramBatchReport = {
  complete: boolean;
  configuredChannels: number;
  capturedUnread: number;
  fetched: number;
  normalized: number;
  /** Eligible image messages only. */
  mediaMessages: number;
  skippedNonImageMessages: number;
  albumGroups: number;
  channels: ChannelReport[];
};

function fail(message: string): never {
  throw new Error(`Invalid Telegram batch: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value.trim();
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${label} must be a safe integer`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 0) fail(`${label} must be non-negative`);
  return result;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return integer(value, label);
}

function state(value: unknown, label: string): BatchState {
  const result = nonEmptyString(value, label) as BatchState;
  if (!["ready", "empty", "partial", "failed"].includes(result)) fail(`${label} is unsupported`);
  return result;
}

function integerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) => integer(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicate message IDs`);
  return result;
}

async function readJson(path: string, label: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024) fail(`${label} exceeds 8 MiB`);
  return JSON.parse(text) as unknown;
}

async function configuredChannels(path: string): Promise<Array<{ sourceKey: string; channelId: number; label: string }>> {
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > 512 * 1024) fail("briefing config exceeds 512 KiB");
  const root = record(parseYaml(text), "briefing config");
  const sources = record(root.sources, "briefing config.sources");
  const news = record(sources.news, "briefing config.sources.news");
  if (news.enabled !== true) return [];
  if (!Array.isArray(news.channels)) fail("briefing config.sources.news.channels must be an array");
  const result = news.channels
    .filter((raw) => record(raw, "configured channel").enabled !== false)
    .map((raw, index) => {
      const channel = record(raw, `briefing config.sources.news.channels[${index}]`);
      return {
        sourceKey: nonEmptyString(channel.key, `configured channel[${index}].key`),
        channelId: integer(channel.id, `configured channel[${index}].id`),
        label: nonEmptyString(channel.label, `configured channel[${index}].label`),
      };
    });
  if (new Set(result.map((channel) => channel.channelId)).size !== result.length) {
    fail("briefing config contains duplicate Telegram channel IDs");
  }
  return result;
}

function itemIdentity(raw: unknown, label: string): { chatId: number; messageId: number; metadata: Record<string, unknown> } {
  const item = record(raw, label);
  const metadata = record(item.metadata, `${label}.metadata`);
  return {
    chatId: integer(metadata.telegramChatId, `${label}.metadata.telegramChatId`),
    messageId: integer(metadata.telegramMessageId, `${label}.metadata.telegramMessageId`),
    metadata,
  };
}

function identities(items: unknown[], label: string): Map<number, Map<number, Record<string, unknown>>> {
  const result = new Map<number, Map<number, Record<string, unknown>>>();
  for (const [index, raw] of items.entries()) {
    const identity = itemIdentity(raw, `${label}[${index}]`);
    const channel = result.get(identity.chatId) ?? new Map<number, Record<string, unknown>>();
    if (channel.has(identity.messageId)) fail(`${label} contains duplicate ${identity.chatId}:${identity.messageId}`);
    channel.set(identity.messageId, identity.metadata);
    result.set(identity.chatId, channel);
  }
  return result;
}

function sameIds(actual: number[], expected: number[], label: string): void {
  const left = [...actual].sort((a, b) => a - b);
  const right = [...expected].sort((a, b) => a - b);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    fail(`${label} does not match the captured message IDs`);
  }
}

function mediaType(metadata: Record<string, unknown>, label: string): string {
  return nonEmptyString(metadata.mediaType, `${label}.mediaType`).toLowerCase();
}

function isImageMedia(metadata: Record<string, unknown>, label: string): boolean {
  const value = mediaType(metadata, label);
  const mime = typeof metadata.mediaMimeType === "string"
    ? metadata.mediaMimeType.trim().toLowerCase()
    : "";
  return value === "photo" || value === "image" || value.startsWith("image/") || mime.startsWith("image/");
}

export async function validateTelegramBatch(
  configPath: string,
  rawPath: string,
  normalizedPath: string,
): Promise<TelegramBatchReport> {
  const expectedChannels = await configuredChannels(configPath);
  const raw = record(await readJson(rawPath, "raw batch"), "raw batch");
  const normalized = record(await readJson(normalizedPath, "normalized batch"), "normalized batch");
  if (raw.sourceKey !== "news" || raw.profile !== "telegram-user") {
    fail("raw batch must identify news with profile telegram-user");
  }
  const rootState = state(raw.status, "raw batch.status");
  const capture = record(raw.capture, "raw batch.capture");
  if (!Array.isArray(capture.channels)) fail("raw batch.capture.channels must be an array");
  if (!Array.isArray(raw.items)) fail("raw batch.items must be an array");
  if (!Array.isArray(normalized.items)) fail("normalized batch.items must be an array");

  const rawByChannel = identities(raw.items, "raw batch.items");
  const normalizedByChannel = identities(normalized.items, "normalized batch.items");
  const captures = new Map<number, Record<string, unknown>>();
  for (const [index, value] of capture.channels.entries()) {
    const channel = record(value, `raw batch.capture.channels[${index}]`);
    const channelId = integer(channel.channelId, `capture channel[${index}].channelId`);
    if (captures.has(channelId)) fail(`capture contains duplicate channel ${channelId}`);
    captures.set(channelId, channel);
  }

  if (captures.size !== expectedChannels.length) {
    fail(`capture covers ${captures.size} channels; configuration enables ${expectedChannels.length}`);
  }

  const reports: ChannelReport[] = [];
  for (const expected of expectedChannels) {
    const channel = captures.get(expected.channelId);
    if (!channel) fail(`capture is missing configured channel ${expected.sourceKey}`);
    if (nonEmptyString(channel.sourceKey, `${expected.sourceKey}.sourceKey`) !== expected.sourceKey) {
      fail(`${expected.sourceKey} has a mismatched sourceKey`);
    }
    if (nonEmptyString(channel.label, `${expected.sourceKey}.label`) !== expected.label) {
      fail(`${expected.sourceKey} has a mismatched label`);
    }
    const channelState = state(channel.status, `${expected.sourceKey}.status`);
    const capturedUnread = nonNegativeInteger(channel.capturedUnreadCount, `${expected.sourceKey}.capturedUnreadCount`);
    const upperMessageId = nullableInteger(channel.upperMessageId, `${expected.sourceKey}.upperMessageId`);
    const fetchedMessageIds = integerArray(channel.fetchedMessageIds, `${expected.sourceKey}.fetchedMessageIds`);
    const rawMessages = rawByChannel.get(expected.channelId) ?? new Map();
    const normalizedMessages = normalizedByChannel.get(expected.channelId) ?? new Map();
    sameIds([...rawMessages.keys()], fetchedMessageIds, `${expected.sourceKey} raw items`);
    sameIds([...normalizedMessages.keys()], fetchedMessageIds, `${expected.sourceKey} normalized items`);
    if (capturedUnread === 0) {
      if (channelState !== "empty" || upperMessageId !== null || fetchedMessageIds.length !== 0) {
        fail(`${expected.sourceKey} must be empty with no upper boundary or fetched items`);
      }
    } else {
      if (upperMessageId === null) fail(`${expected.sourceKey} is missing its upper message ID`);
      if (fetchedMessageIds.some((messageId) => messageId > upperMessageId)) {
        fail(`${expected.sourceKey} contains a message newer than its captured upper boundary`);
      }
      if (channelState === "ready" && fetchedMessageIds.length !== capturedUnread) {
        fail(`${expected.sourceKey} claims ready but fetched ${fetchedMessageIds.length} of ${capturedUnread}`);
      }
      if (channelState === "empty") fail(`${expected.sourceKey} cannot be empty with unread messages`);
    }

    const groupIdentifier = (value: unknown, label: string): string => {
      if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
      if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
      fail(`${label} must be an integer identifier`);
    };
    const groups = new Map<string, Array<{ messageId: number; image: boolean }>>();
    let mediaMessages = 0;
    let skippedNonImageMessages = 0;
    for (const [messageId, metadata] of normalizedMessages) {
      const rawMetadata = rawMessages.get(messageId);
      if (!rawMetadata) fail(`${expected.sourceKey}:${messageId} is missing its raw item`);
      if ((metadata.hasMedia === true) !== (rawMetadata.hasMedia === true)) {
        fail(`${expected.sourceKey}:${messageId}.hasMedia changed during normalization`);
      }
    }
    for (const [messageId, metadata] of rawMessages) {
      if (metadata.hasMedia !== true) continue;
      const image = isImageMedia(metadata, `${expected.sourceKey}:${messageId}`);
      if (image) mediaMessages += 1;
      else skippedNonImageMessages += 1;
      const groupValue = metadata.telegramGroupId;
      const groupId = groupValue === null || groupValue === undefined
        ? String(messageId)
        : groupIdentifier(groupValue, `${expected.sourceKey}:${messageId}.telegramGroupId`);
      const members = groups.get(groupId) ?? [];
      members.push({ messageId, image });
      groups.set(groupId, members);
    }
    for (const [messageId, metadata] of normalizedMessages) {
      if (metadata.hasMedia !== true) continue;
      const rawMetadata = rawMessages.get(messageId);
      if (!rawMetadata) fail(`${expected.sourceKey}:${messageId} is missing its raw item`);
      if (mediaType(metadata, `${expected.sourceKey}:${messageId}`)
        !== mediaType(rawMetadata, `${expected.sourceKey}:${messageId} raw`)) {
        fail(`${expected.sourceKey}:${messageId}.mediaType changed during normalization`);
      }
      const normalizedMime = typeof metadata.mediaMimeType === "string" ? metadata.mediaMimeType.trim().toLowerCase() : "";
      const rawMime = typeof rawMetadata.mediaMimeType === "string" ? rawMetadata.mediaMimeType.trim().toLowerCase() : "";
      if (normalizedMime !== rawMime) {
        fail(`${expected.sourceKey}:${messageId}.mediaMimeType changed during normalization`);
      }
      const groupValue = metadata.telegramGroupId;
      const groupId = groupValue === null || groupValue === undefined
        ? String(messageId)
        : groupIdentifier(groupValue, `${expected.sourceKey}:${messageId}.telegramGroupId`);
      const expectedMembers = groups.get(groupId) ?? [{
        messageId,
        image: isImageMedia(rawMetadata, `${expected.sourceKey}:${messageId}`),
      }];
      const expectedAllMedia = expectedMembers.map((member) => member.messageId);
      const expectedMedia = expectedMembers.filter((member) => member.image).map((member) => member.messageId);
      const expectedNonImageMedia = expectedMembers.filter((member) => !member.image).map((member) => member.messageId);
      const actualAllMedia = integerArray(metadata.allMediaMessageIds, `${expected.sourceKey}:${messageId}.allMediaMessageIds`);
      const actualMedia = integerArray(metadata.mediaMessageIds, `${expected.sourceKey}:${messageId}.mediaMessageIds`);
      const actualNonImageMedia = integerArray(
        metadata.nonImageMediaMessageIds,
        `${expected.sourceKey}:${messageId}.nonImageMediaMessageIds`,
      );
      sameIds(actualAllMedia, expectedAllMedia, `${expected.sourceKey}:${messageId}.allMediaMessageIds`);
      sameIds(actualMedia, expectedMedia, `${expected.sourceKey}:${messageId}.mediaMessageIds`);
      sameIds(actualNonImageMedia, expectedNonImageMedia, `${expected.sourceKey}:${messageId}.nonImageMediaMessageIds`);
    }
    reports.push({
      sourceKey: expected.sourceKey,
      channelId: expected.channelId,
      label: expected.label,
      state: channelState,
      capturedUnread,
      fetched: fetchedMessageIds.length,
      normalized: normalizedMessages.size,
      upperMessageId,
      mediaMessages,
      skippedNonImageMessages,
      albumGroups: groups.size,
      itemIds: fetchedMessageIds,
      mediaItemIds: [...rawMessages]
        .filter(([messageId, metadata]) => metadata.hasMedia === true
          && isImageMedia(metadata, `${expected.sourceKey}:${messageId}`))
        .map(([messageId]) => messageId)
        .sort((left, right) => left - right),
      nonImageMediaItemIds: [...rawMessages]
        .filter(([messageId, metadata]) => metadata.hasMedia === true
          && !isImageMedia(metadata, `${expected.sourceKey}:${messageId}`))
        .map(([messageId]) => messageId)
        .sort((left, right) => left - right),
    });
  }

  const configuredIds = new Set(expectedChannels.map((channel) => channel.channelId));
  for (const channelId of new Set([...rawByChannel.keys(), ...normalizedByChannel.keys(), ...captures.keys()])) {
    if (!configuredIds.has(channelId)) fail(`batch contains unconfigured channel ${channelId}`);
  }
  const complete = reports.every((channel) =>
    (channel.state === "ready" && channel.fetched === channel.capturedUnread)
    || (channel.state === "empty" && channel.capturedUnread === 0));
  if (complete && !["ready", "empty"].includes(rootState)) {
    fail(`all channels are complete but raw batch.status is ${rootState}`);
  }
  if (!complete && ["ready", "empty"].includes(rootState)) {
    fail(`raw batch.status ${rootState} hides an incomplete channel`);
  }
  const sum = (key: keyof Pick<ChannelReport, "capturedUnread" | "fetched" | "normalized" | "mediaMessages" | "skippedNonImageMessages" | "albumGroups">) =>
    reports.reduce((total, channel) => total + channel[key], 0);
  return {
    complete,
    configuredChannels: reports.length,
    capturedUnread: sum("capturedUnread"),
    fetched: sum("fetched"),
    normalized: sum("normalized"),
    mediaMessages: sum("mediaMessages"),
    skippedNonImageMessages: sum("skippedNonImageMessages"),
    albumGroups: sum("albumGroups"),
    channels: reports,
  };
}
