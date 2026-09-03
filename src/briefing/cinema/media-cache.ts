import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { CinemaRuntimeConfig } from "../runtime-config.ts";
import { fetchBuffer, fetchText, type FetchLike, type RetryPolicy } from "../providers/common.ts";
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

function selectedNews(candidate: CinemaCollectionCandidate, draftValue: unknown): CinemaCollectionCandidate["news"]["candidates"] {
  const draft = parseCinemaEditorialDraft(draftValue);
  if (draft.localDate !== candidate.localDate) throw new Error("Cinema media draft and candidate dates differ");
  const news = new Map(candidate.news.candidates.map((item) => [item.id, item]));
  return draft.news.map((item) => {
    const candidateItem = news.get(item.candidateId);
    if (!candidateItem) throw new Error(`Cinema media draft selected unknown candidate ${item.candidateId}`);
    return candidateItem;
  });
}

function directAssets(candidate: CinemaCollectionCandidate, draftValue: unknown, config: CinemaRuntimeConfig): Asset[] {
  const news = selectedNews(candidate, draftValue);
  const result: Asset[] = [];
  for (const item of candidate.trailers.candidates.slice(0, config.limits.trailers)) {
    if (item.thumbnailUrl) result.push({ id: item.id, url: item.thumbnailUrl, allowedHosts: ["ytimg.com"] });
  }
  for (const item of candidate.premieres.candidates.slice(0, config.limits.premieres)) {
    if (item.posterUrl) result.push({ id: item.id, url: item.posterUrl, allowedHosts: ["s3.eu-central-1.amazonaws.com"] });
  }
  for (const item of news) {
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

function metaContent(html: string, property: string): string | undefined {
  for (const match of html.matchAll(/<meta\s+([^>]+)>/giu)) {
    const attributes = match[1]!;
    const propertyValue = /(?:property|name)\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]?.toLocaleLowerCase("en-US");
    if (propertyValue !== property.toLocaleLowerCase("en-US")) continue;
    return /content\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]
      ?.replace(/&(?:amp|#0*38|#x0*26);/giu, "&")
      .replace(/&(?:quot|#0*34|#x0*22);/giu, '"')
      .replace(/&(?:apos|#0*39|#x0*27);/giu, "'");
  }
  return undefined;
}

async function discoverNewsAssets(input: {
  candidate: CinemaCollectionCandidate;
  draft: unknown;
  fetchImpl?: FetchLike;
  retry?: Partial<RetryPolicy>;
}): Promise<{ assets: Asset[]; diagnostics: string[] }> {
  const missing = selectedNews(input.candidate, input.draft).filter((item) => !item.imageUrl);
  const result: Asset[] = [];
  const diagnostics: string[] = [];
  // Four at a time keeps the weekly run bounded without serially waiting on
  // every publisher page. Only the final editorial selection is inspected.
  for (let offset = 0; offset < missing.length; offset += 4) {
    await Promise.all(missing.slice(offset, offset + 4).map(async (item) => {
      const hosts = publisherHosts(item.publisher);
      if (!hosts.length) return;
      try {
        const page = allowed(item.sourceUrl, hosts);
        const response = await fetchText(page, {
          fetchImpl: input.fetchImpl,
          retry: input.retry,
          maximumBytes: 2 * 1_024 * 1_024,
          accept: "text/html",
        });
        if (!response.ok) throw new Error(`${response.issue.code}:${response.issue.message}`);
        const image = metaContent(response.value, "og:image") || metaContent(response.value, "twitter:image");
        if (!image) throw new Error("article_image_not_found");
        // Publisher-owned media only: this intentionally rejects unrelated
        // ad/tracker/CDN hosts instead of broadening the SSRF allowlist.
        allowed(new URL(image, page).toString(), hosts);
        result.push({ id: item.id, url: new URL(image, page).toString(), allowedHosts: hosts });
      } catch (error) {
        diagnostics.push(`${item.id}:image_discovery:${error instanceof Error ? error.message : String(error)}`.slice(0, 360));
      }
    }));
  }
  return { assets: result, diagnostics };
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
  const direct = directAssets(input.candidate, input.draft, input.config);
  const discovered = await discoverNewsAssets(input);
  diagnostics.push(...discovered.diagnostics);
  const assets = [...direct, ...discovered.assets].filter((asset, index, all) => all.findIndex((item) => item.id === asset.id) === index);
  for (const asset of assets) {
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
