import type { CinemaChart } from "../model.ts";

function articleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<\/(?:p|li|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;|&#34;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .trim();
}

function amount(value: string, unit: string): number {
  const number = Number.parseFloat(value.replace(/,/gu, ""));
  if (!Number.isFinite(number) || number < 0) throw new Error("Invalid AP box-office amount");
  return number * (unit.toLocaleLowerCase("en-US") === "billion" ? 1_000_000_000 : 1_000_000);
}

export function parseApTopTen(input: {
  html: string;
  sourceUrl: string;
  sourceId: string;
}): CinemaChart {
  if (Buffer.byteLength(input.html, "utf8") > 2 * 1_024 * 1_024) {
    throw new Error("AP article exceeds 2 MiB");
  }
  const source = new URL(input.sourceUrl);
  if (source.protocol !== "https:" || source.hostname !== "apnews.com") {
    throw new Error("Invalid AP article URL");
  }
  const text = articleText(input.html);
  const marker = text.lastIndexOf("Top 10 movies by domestic box office");
  if (marker < 0) throw new Error("AP article has no explicit domestic Top 10");
  const body = text.slice(marker);
  const entries = [...body.matchAll(/(?:^|\n)\s*(10|[1-9])\.\s*[“"]?(.+?),[”"]?\s*\$([\d,.]+)\s+(million|billion)\b/giu)]
    .map((match) => ({
      rank: Number(match[1]),
      title: match[2]!.trim().replace(/^[“"]|[”"]$/gu, ""),
      amount: amount(match[3]!, match[4]!),
    }))
    .sort((left, right) => left.rank - right.rank);
  if (entries.length !== 10 || entries.some((entry, index) => entry.rank !== index + 1)) {
    throw new Error("AP article domestic Top 10 is incomplete or drifted");
  }
  return {
    id: "us-weekend",
    label: "США — уикенд",
    region: "US/CA",
    period: "weekend",
    entries: entries.map((entry) => ({
      id: `ap:${entry.title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
        .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 100)}`,
      title: entry.title,
      rank: entry.rank,
      gross: { amount: entry.amount, currency: "USD" },
      sourceId: input.sourceId,
    })),
  };
}

export function apArticlePublishedAt(html: string): string | undefined {
  const raw = /(?:article:published_time["'][^>]*content=["']([^"']+)|["']datePublished["']\s*:\s*["']([^"']+))/iu.exec(html);
  const value = raw?.[1] ?? raw?.[2];
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function discoverApBoxOfficeLinks(
  html: string,
  limit = 30,
  baseUrl = "https://apnews.com/hub/movies",
): string[] {
  if (Buffer.byteLength(html, "utf8") > 2 * 1_024 * 1_024) throw new Error("AP discovery page exceeds 2 MiB");
  const candidates = [
    ...[...html.matchAll(/https:\/\/apnews\.com\/article\/[A-Za-z0-9-]*box-office[A-Za-z0-9-]*/gu)]
      .map((match) => match[0]),
    ...[...html.matchAll(/href=["'](\/article\/[A-Za-z0-9-]*box-office[A-Za-z0-9-]*)["']/gu)]
      .map((match) => new URL(match[1]!, baseUrl).toString()),
  ];
  return [...new Set(candidates)].slice(0, Math.min(50, Math.max(1, limit)));
}
