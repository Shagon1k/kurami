import type { CinemaCoverage } from "../model.ts";

export type CinemaLtPremiereCandidate = {
  id: string;
  localTitle: string;
  originalTitle?: string;
  releaseDate: string;
  sourceUrl: string;
  posterUrl?: string;
};

const CARD = /<a\s+href="(https:\/\/cinema\.lt\/filmai\/[^"]+)"[^>]*class="[^"]*movie-card-vertical[^>]*>([\s\S]*?)<\/a>/gu;
const PREMIERE = /Premjera\s+(\d{4}-\d{2}-\d{2})/u;
const LOCAL_TITLE = /<h3[^>]*class="[^"]*movie-card-vertical-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/u;
const ORIGINAL_TITLE = /<h4[^>]*class="[^"]*movie-card-vertical-original-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/u;
const POSTER = /<img[^>]+src="(https:\/\/s3\.eu-central-1\.amazonaws\.com\/cinema-lt\/images\/movies\/poster\/[^"]+)"/u;

function decodeHtml(value: string): string {
  return value
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

function localDate(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid cinema.lt coverage instant");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function stableId(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!slug || !/^[a-z0-9-]{1,140}$/u.test(slug)) throw new Error("Invalid cinema.lt movie URL");
  return `cinema-lt:${slug}`;
}

export function parseCinemaLtPremieres(input: {
  html: string;
  coverage: CinemaCoverage;
  timeZone: string;
  limit?: number;
}): CinemaLtPremiereCandidate[] {
  if (Buffer.byteLength(input.html, "utf8") > 2 * 1_024 * 1_024) {
    throw new Error("cinema.lt response exceeds 2 MiB");
  }
  const startDate = localDate(input.coverage.start, input.timeZone);
  const endDate = localDate(input.coverage.end, input.timeZone);
  const limit = Math.min(20, Math.max(1, input.limit ?? 12));
  const result: CinemaLtPremiereCandidate[] = [];
  const seen = new Set<string>();
  for (const match of input.html.matchAll(CARD)) {
    const sourceUrl = match[1]!;
    const card = match[2]!;
    const releaseDate = PREMIERE.exec(card)?.[1];
    const localTitleRaw = LOCAL_TITLE.exec(card)?.[1];
    if (!releaseDate || releaseDate < startDate || releaseDate >= endDate || !localTitleRaw) continue;
    const id = stableId(sourceUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    const localTitle = decodeHtml(localTitleRaw);
    if (!localTitle || localTitle.length > 220) throw new Error("Invalid cinema.lt local title");
    const originalTitleRaw = ORIGINAL_TITLE.exec(card)?.[1];
    const originalTitle = originalTitleRaw ? decodeHtml(originalTitleRaw) : "";
    const posterUrl = POSTER.exec(card)?.[1]?.replace(/&amp;/gu, "&");
    result.push({
      id,
      localTitle,
      ...(originalTitle && originalTitle !== localTitle ? { originalTitle } : {}),
      releaseDate,
      sourceUrl: new URL(sourceUrl).toString(),
      ...(posterUrl ? { posterUrl: new URL(posterUrl).toString() } : {}),
    });
    if (result.length >= limit) break;
  }
  return result;
}
