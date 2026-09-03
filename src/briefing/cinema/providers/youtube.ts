import type { CinemaChannelSeed } from "../../runtime-config.ts";
import type { CinemaCoverage } from "../model.ts";

type JsonRecord = Record<string, unknown>;

export type YouTubeTrailerCandidate = {
  id: string;
  videoId: string;
  title: string;
  description: string;
  publisher: string;
  publisherChannelId: string;
  publisherRole: "official" | "discovery";
  publishedAt: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function videoId(value: unknown): string | null {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{11}$/u.test(value)) return value;
  const raw = record(value);
  return raw ? videoId(raw.videoId ?? raw.video_id ?? raw.id) : null;
}

function recordVideoId(raw: JsonRecord): string | null {
  const details = snippet(raw);
  return videoId(raw.videoId)
    ?? videoId(raw.video_id)
    ?? videoId(details.resourceId)
    ?? videoId(raw.id);
}

function durationSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 7_200) return value;
  const raw = text(value);
  if (!raw) return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(raw);
  if (!match) return undefined;
  const result = Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return result > 0 && result <= 7_200 ? result : undefined;
}

function candidateRecords(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => candidateRecords(entry, depth + 1));
  const raw = record(value);
  if (!raw) return [];
  if (recordVideoId(raw)) return [raw];
  return ["items", "results", "videos", "data", "response_data", "result"]
    .flatMap((key) => candidateRecords(raw[key], depth + 1));
}

function snippet(raw: JsonRecord): JsonRecord {
  return record(raw.snippet) ?? raw;
}

function bestThumbnail(raw: JsonRecord): string | undefined {
  const thumbnails = record(snippet(raw).thumbnails);
  if (!thumbnails) return undefined;
  for (const key of ["maxres", "standard", "high", "medium", "default"] as const) {
    const url = text(record(thumbnails[key])?.url);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

export function normalizeYouTubeCandidates(input: {
  response: unknown;
  channels: CinemaChannelSeed[];
  coverage: CinemaCoverage;
  limit?: number;
}): YouTubeTrailerCandidate[] {
  const allowed = new Map(input.channels.map((channel) => [channel.id, channel]));
  const result: YouTubeTrailerCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of candidateRecords(input.response)) {
    const id = recordVideoId(raw);
    const details = snippet(raw);
    const channelId = text(details.channelId ?? raw.channelId ?? raw.channel_id);
    const seed = channelId ? allowed.get(channelId) : undefined;
    const title = text(details.title ?? raw.title);
    const publishedRaw = text(details.publishedAt ?? raw.publishedAt ?? raw.published_at);
    if (!id || !seed || !title || !publishedRaw || seen.has(id)) continue;
    const publishedAt = new Date(publishedRaw).toISOString();
    if (!Number.isFinite(Date.parse(publishedAt))) continue;
    const published = Date.parse(publishedAt);
    if (published < Date.parse(input.coverage.start) || published >= Date.parse(input.coverage.end)) continue;
    seen.add(id);
    const duration = durationSeconds(record(raw.contentDetails)?.duration ?? raw.duration);
    result.push({
      id: `youtube:${id}`,
      videoId: id,
      title: title.slice(0, 240),
      description: (text(details.description ?? raw.description) ?? "").slice(0, 1_000),
      publisher: seed.label,
      publisherChannelId: seed.id,
      publisherRole: seed.role,
      publishedAt,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      ...(bestThumbnail(raw) ? { thumbnailUrl: bestThumbnail(raw)! } : {}),
      ...(duration ? { durationSeconds: duration } : {}),
    });
    if (result.length >= Math.min(200, input.limit ?? 100)) break;
  }
  return result.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
    || left.videoId.localeCompare(right.videoId));
}
