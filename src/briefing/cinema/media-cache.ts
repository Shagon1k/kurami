import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { CinemaRuntimeConfig } from "../runtime-config.ts";
import { fetchBuffer, type FetchLike, type RetryPolicy } from "../providers/common.ts";
import type { CinemaCollectionCandidate } from "./collector.ts";
import { parseCinemaEditorialDraft } from "./editorial.ts";
import type { CinemaMediaMap } from "./composer.ts";

type Asset = { id: string; url: string; allowedHosts: string[] };

export type CinemaMediaCacheResult = {
  media: CinemaMediaMap;
  cached: number;
  bytes: number;
  diagnostics: string[];
};

const MAX_IMAGE_BYTES = 8 * 1_024 * 1_024;
const MAX_TOTAL_BYTES = 96 * 1_024 * 1_024;

function imageExtension(buffer: Buffer): ".jpg" | ".png" | ".webp" | ".gif" | ".avif" {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return ".gif";
  if (buffer.subarray(4, 12).toString("ascii").startsWith("ftypavif")) return ".avif";
  throw new Error("unsupported_image_payload");
}

function allowed(urlValue: string, hosts: string[]): URL {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe_image_url");
  if (!hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("untrusted_image_host");
  }
  return url;
}

function publisherHosts(publisher: string): string[] {
  if (publisher === "Variety") return ["variety.com"];
  if (publisher === "Deadline") return ["deadline.com"];
  if (publisher === "The Hollywood Reporter") return ["hollywoodreporter.com"];
  if (publisher === "IndieWire") return ["indiewire.com"];
  return [];
}

function assets(candidate: CinemaCollectionCandidate, draftValue: unknown, config: CinemaRuntimeConfig): Asset[] {
  const draft = parseCinemaEditorialDraft(draftValue);
  if (draft.localDate !== candidate.localDate) throw new Error("Cinema media draft and candidate dates differ");
  const news = new Map(candidate.news.candidates.map((item) => [item.id, item]));
  const result: Asset[] = [];
  for (const item of candidate.trailers.candidates.slice(0, config.limits.trailers)) {
    if (item.thumbnailUrl) result.push({ id: item.id, url: item.thumbnailUrl, allowedHosts: ["ytimg.com"] });
  }
  for (const item of candidate.premieres.candidates.slice(0, config.limits.premieres)) {
    if (item.posterUrl) result.push({ id: item.id, url: item.posterUrl, allowedHosts: ["s3.eu-central-1.amazonaws.com"] });
  }
  for (const selected of draft.news) {
    const item = news.get(selected.candidateId);
    if (!item) throw new Error(`Cinema media draft selected unknown candidate ${selected.candidateId}`);
    const hosts = publisherHosts(item.publisher);
    if (item.imageUrl && hosts.length) result.push({ id: item.id, url: item.imageUrl, allowedHosts: hosts });
  }
  const seen = new Set<string>();
  return result.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function cacheCinemaMedia(input: {
  candidate: CinemaCollectionCandidate;
  draft: unknown;
  config: CinemaRuntimeConfig;
  mediaRoot: string;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
}): Promise<CinemaMediaCacheResult> {
  const root = resolve(input.mediaRoot);
  const directory = resolve(root, "cinema", input.candidate.localDate);
  if (relative(root, directory).startsWith("..")) throw new Error("Cinema media directory escapes its root");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const media: CinemaMediaMap = {};
  const diagnostics: string[] = [];
  let bytes = 0;
  for (const asset of assets(input.candidate, input.draft, input.config)) {
    try {
      const url = allowed(asset.url, asset.allowedHosts);
      const response = await fetchBuffer(url, {
        fetchImpl: input.fetchImpl,
        retry: input.retry,
        maximumBytes: MAX_IMAGE_BYTES,
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8",
      });
      if (!response.ok) throw new Error(`${response.issue.code}:${response.issue.message}`);
      if (bytes + response.value.byteLength > MAX_TOTAL_BYTES) throw new Error("edition_media_budget_exceeded");
      const extension = imageExtension(response.value);
      const name = `${createHash("sha256").update(`${asset.id}:${url.toString()}`).digest("hex").slice(0, 24)}${extension}`;
      const destination = resolve(directory, name);
      const temporary = resolve(directory, `.${name}.${process.pid}.tmp`);
      await writeFile(temporary, response.value, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
      bytes += response.value.byteLength;
      media[asset.id] = `/media/cinema/${input.candidate.localDate}/${name}`;
    } catch (error) {
      diagnostics.push(`${asset.id}:${error instanceof Error ? error.message : String(error)}`.slice(0, 360));
    }
  }
  return { media, cached: Object.keys(media).length, bytes, diagnostics };
}
