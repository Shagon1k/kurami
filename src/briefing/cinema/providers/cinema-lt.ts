import type { CinemaCoverage } from "../model.ts";

export type CinemaLtPremiereCandidate = {
  id: string;
  localTitle: string;
  originalTitle?: string;
  releaseDate: string;
  sourceUrl: string;
  posterUrl?: string;
  genres?: string[];
  runtimeMinutes?: number;
  ageRating?: string;
  directors?: string[];
  cast?: string[];
};

export type CinemaLtMovieDetails = Pick<CinemaLtPremiereCandidate,
  "genres" | "runtimeMinutes" | "ageRating" | "directors" | "cast">;

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

function stringList(value: unknown, maximum: number): string[] | undefined {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const result = raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  }).map((item) => decodeHtml(item).slice(0, 120)).filter(Boolean).slice(0, maximum);
  return result.length ? [...new Set(result)] : undefined;
}

const ENGLISH_GENRES: ReadonlyMap<string, string> = new Map([
  ["action", "Action"],
  ["adventure", "Adventure"],
  ["animation", "Animation"],
  ["biography", "Biography"],
  ["comedy", "Comedy"],
  ["crime", "Crime"],
  ["documentary", "Documentary"],
  ["drama", "Drama"],
  ["family", "Family"],
  ["fantasy", "Fantasy"],
  ["history", "History"],
  ["horror", "Horror"],
  ["music", "Music"],
  ["musical", "Musical"],
  ["mystery", "Mystery"],
  ["romance", "Romance"],
  ["science fiction", "Science Fiction"],
  ["thriller", "Thriller"],
  ["war", "War"],
] as const);

const LITHUANIAN_GENRES: ReadonlyMap<string, string> = new Map([
  ["animaciniai", "Animation"],
  ["biografiniai", "Biography"],
  ["dokumentiniai", "Documentary"],
  ["dramos", "Drama"],
  ["fantastiniai", "Fantasy"],
  ["istoriniai", "History"],
  ["kariniai", "War"],
  ["komedijos", "Comedy"],
  ["kriminaliniai", "Crime"],
  ["maginė fantastika", "Fantasy"],
  ["mokslinė fantastika", "Science Fiction"],
  ["muzikiniai", "Music"],
  ["mistiniai", "Mystery"],
  ["nuotykių", "Adventure"],
  ["romantiniai", "Romance"],
  ["siaubo", "Horror"],
  ["šeimai", "Family"],
  ["trileriai", "Thriller"],
  ["veiksmo", "Action"],
] as const);

/**
 * cinema.lt publishes localized genre labels. The UI contract is English-only,
 * so unknown localized values are omitted instead of leaking mixed-language UI.
 */
export function normalizeCinemaLtGenres(value: unknown): string[] | undefined {
  const raw = stringList(value, 8) ?? [];
  const normalized = raw.flatMap((genre) => {
    const key = genre.normalize("NFKC").trim().toLocaleLowerCase("lt-LT");
    const mapped = LITHUANIAN_GENRES.get(key) ?? ENGLISH_GENRES.get(key);
    return mapped ? [mapped] : [];
  }).slice(0, 5);
  return normalized.length ? [...new Set(normalized)] : undefined;
}

/** Extracts the stable Schema.org Movie payload already published by cinema.lt. */
export function parseCinemaLtMovieDetails(html: string): CinemaLtMovieDetails {
  if (Buffer.byteLength(html, "utf8") > 2 * 1_024 * 1_024) throw new Error("cinema.lt detail response exceeds 2 MiB");
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)];
  for (const match of scripts) {
    let value: unknown;
    try {
      value = JSON.parse(match[1]!.trim());
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    if (raw["@type"] !== "Movie") continue;
    const duration = typeof raw.duration === "object" && raw.duration && !Array.isArray(raw.duration)
      ? (raw.duration as Record<string, unknown>).name
      : raw.duration;
    const durationMatch = typeof duration === "string" ? /^PT(?:(\d+)H)?(?:(\d+)M)?$/u.exec(duration) : null;
    const runtimeMinutes = durationMatch
      ? Number(durationMatch[1] ?? 0) * 60 + Number(durationMatch[2] ?? 0)
      : 0;
    const genres = normalizeCinemaLtGenres(raw.genre);
    const directors = stringList(raw.director, 3);
    const cast = stringList(raw.actor, 4);
    const ageRating = typeof raw.contentRating === "string" && raw.contentRating.trim()
      ? decodeHtml(raw.contentRating).slice(0, 20)
      : undefined;
    return {
      ...(genres ? { genres } : {}),
      ...(runtimeMinutes > 0 ? { runtimeMinutes } : {}),
      ...(ageRating ? { ageRating } : {}),
      ...(directors ? { directors } : {}),
      ...(cast ? { cast } : {}),
    };
  }
  throw new Error("cinema.lt detail page has no Schema.org Movie payload");
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
