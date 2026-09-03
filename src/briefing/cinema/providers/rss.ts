import type { CinemaCoverage } from "../model.ts";

export type CinemaNewsCandidate = {
  id: string;
  publisher: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  sourceUrl: string;
  categories: string[];
  imageUrl?: string;
};

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;|&#34;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/gu, " ")
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "iu").exec(block)?.[1];
  return value === undefined ? undefined : decodeXml(value);
}

function attributes(block: string, name: string): Record<string, string> | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const raw = new RegExp(`<${escaped}\\s+([^>]+?)(?:\\/?>)`, "iu").exec(block)?.[1];
  if (!raw) return undefined;
  return Object.fromEntries([...raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:]*)="([^"]*)"/gu)]
    .map((match) => [match[1]!, decodeXml(match[2]!) ]));
}

function canonicalUrl(value: string, expectedHost: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== expectedHost) {
    throw new Error(`Invalid cinema RSS destination for ${expectedHost}`);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|ref$|source$|output$)/iu.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function candidateId(publisher: string, url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1)
    ?.replace(/[^A-Za-z0-9-]/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  if (!slug) throw new Error("Cinema RSS item has no stable URL slug");
  return `rss:${publisher.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-")}:${slug.slice(0, 100)}`;
}

export function parseCinemaRss(input: {
  xml: string;
  publisher: string;
  expectedHost: string;
  coverage: CinemaCoverage;
  limit?: number;
}): CinemaNewsCandidate[] {
  if (Buffer.byteLength(input.xml, "utf8") > 2 * 1_024 * 1_024) {
    throw new Error(`${input.publisher} RSS exceeds 2 MiB`);
  }
  if (!/<rss\b/iu.test(input.xml) || !/<channel\b/iu.test(input.xml)) {
    throw new Error(`${input.publisher} RSS root drifted`);
  }
  const limit = Math.min(100, Math.max(1, input.limit ?? 100));
  const result: CinemaNewsCandidate[] = [];
  const seen = new Set<string>();
  for (const itemMatch of input.xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const item = itemMatch[1]!;
    const rawTitle = tag(item, "title");
    const rawUrl = tag(item, "link");
    const rawDate = tag(item, "pubDate");
    if (!rawTitle || !rawUrl || !rawDate) continue;
    const published = new Date(rawDate);
    if (!Number.isFinite(published.getTime())) continue;
    const publishedAt = published.toISOString();
    if (
      published.getTime() < Date.parse(input.coverage.start)
      || published.getTime() >= Date.parse(input.coverage.end)
    ) continue;
    const sourceUrl = canonicalUrl(rawUrl, input.expectedHost);
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const categories = [...item.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/giu)]
      .map((match) => decodeXml(match[1]!))
      .filter(Boolean)
      .slice(0, 24);
    const excerpt = tag(item, "description") ?? tag(item, "content:encoded") ?? rawTitle;
    const media = attributes(item, "media:thumbnail") ?? attributes(item, "media:content");
    let imageUrl: string | undefined;
    if (media?.url) {
      try {
        const candidate = new URL(media.url);
        if (candidate.protocol === "https:" && !candidate.username && !candidate.password) {
          imageUrl = candidate.toString();
        }
      } catch {
        imageUrl = undefined;
      }
    }
    result.push({
      id: candidateId(input.publisher, sourceUrl),
      publisher: input.publisher,
      title: rawTitle.slice(0, 240),
      excerpt: excerpt.slice(0, 1_000),
      publishedAt,
      sourceUrl,
      categories: [...new Set(categories)],
      ...(imageUrl ? { imageUrl } : {}),
    });
    if (result.length >= limit) break;
  }
  return result;
}
