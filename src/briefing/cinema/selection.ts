import type { CinemaNewsCandidate } from "./providers/rss.ts";
import type { YouTubeTrailerCandidate } from "./providers/youtube.ts";

export type SelectedTrailerCandidate = YouTubeTrailerCandidate & {
  trailerType: "main" | "teaser" | "final" | "other";
  filmKey: string;
  score: number;
};

export type SelectedNewsCandidate = CinemaNewsCandidate & {
  score: number;
};

const TRAILER_REJECT = /\b(?:clip|interview|reaction|recap|featurette|behind[ -]the[ -]scenes|fan[ -]made|review|breakdown|ending explained|soundtrack|music video|podcast)\b/iu;
const TRAILER_ACCEPT = /\b(?:official\s+)?(?:trailer|teaser)\b/iu;
const TRAILER_PROMO_COPY = /\b(?:trailer just dropped|watch the (?:brand )?new trailer|tickets? (?:are )?on sale|hitting theaters? everywhere)\b/iu;
const CINEMA_NEWS = /\b(?:film|movie|cinema|theatrical|box[ -]office|filmmaker|director|actor|actress|stars?|starring|cast|casting|studio|production|distribution|distributor|festival|oscar|release|sequel|franchise|screenplay|screenwriter|cinematograph|animation|documentary)\b/iu;
const EXPLICIT_FILM_TITLE = /\b(?:film|movie|cinema|theatrical|box[ -]office|filmmaker|director|actor|actress|stars?|starring|cast|casting|studio|production|distribution|festival|oscar|release|sequel|franchise|screenplay|animation|documentary)\b/iu;
const ADJACENT_NON_FILM_TITLE = /\b(?:hotel|resort|restaurant|fashion|beauty|property|real estate|season\s+\d+|tv series|television series|showrunner)\b/iu;
const SCREEN_ADJACENT_TITLE = /\b(?:tv|television|series|unscripted|competition series|conference|broadcast|streaming series)\b/iu;
const EXPLICIT_CINEMA_TITLE = /\b(?:film|movie|cinema|theatrical|box[ -]office|filmmaker|festival|oscar|documentary)\b/iu;
const HIGH_IMPACT = /\b(?:acquire|acquisition|merger|deal|greenlit|greenlight|production|distribution|release date|delay|cancell?ed|festival|box[ -]office|record|lawsuit|strike|agreement|chief executive|ceo|director|filmmaker)\b/iu;
const LOW_SIGNAL = /\b(?:review|ranked|best .* movies|every .* explained|recap|trailer|teaser|photos?|first look|watch|listicle|gift guide)\b/iu;

function normalizedWords(value: string): string[] {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "official", "trailer", "teaser"].includes(word));
}

function similarity(left: string, right: string): number {
  const a = new Set(normalizedWords(left));
  const b = new Set(normalizedWords(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / new Set([...a, ...b]).size;
}

function sameNewsSubject(left: string, right: string): boolean {
  if (similarity(left, right) >= 0.64) return true;
  const a = new Set(normalizedWords(left));
  const b = new Set(normalizedWords(right));
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((word) => b.has(word)).length;
  const containment = shared / Math.min(a.size, b.size);
  // Four shared meaningful title tokens catches syndicated reporting of the
  // same announcement even when one outlet translates a film title.
  return shared >= 4 && containment >= 0.34;
}

function filmKey(title: string): string {
  const trailerMarker = title.search(TRAILER_ACCEPT);
  const beforeMarker = trailerMarker > 0 ? title.slice(0, trailerMarker) : title;
  const segments = title.split(/[|—–]/u).map((part) => part.trim()).filter(Boolean);
  const trailerSegment = segments.findIndex((part) => TRAILER_ACCEPT.test(part));
  const adjacentTitle = trailerSegment > 0 ? segments[trailerSegment - 1]! : beforeMarker;
  const cleaned = adjacentTitle
    .replace(/\b(?:official|final|main|new|first|second|international|red band|teaser|trailer)\b/giu, " ")
    .replace(/\b(?:hd|4k|imax)\b/giu, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  return cleaned || title.toLocaleLowerCase("en-US");
}

function archivalTrailer(title: string, publishedAt: string): boolean {
  const explicitYear = /\((19\d{2}|20\d{2})(?:\s+movie)?\)/iu.exec(title);
  if (!explicitYear) return false;
  const publicationYear = new Date(publishedAt).getUTCFullYear();
  return Number(explicitYear[1]) <= publicationYear - 2;
}

function trailerType(title: string): SelectedTrailerCandidate["trailerType"] {
  if (/\bfinal trailer\b/iu.test(title)) return "final";
  if (/\bteaser\b/iu.test(title)) return "teaser";
  if (/\btrailer\b/iu.test(title)) return "main";
  return "other";
}

export function selectTrailerCandidates(
  candidates: YouTubeTrailerCandidate[],
  limit: number,
): SelectedTrailerCandidate[] {
  const qualified = candidates.flatMap((candidate) => {
    const combined = `${candidate.title} ${candidate.description}`;
    if (!TRAILER_ACCEPT.test(candidate.title)
      || TRAILER_REJECT.test(combined)
      || TRAILER_PROMO_COPY.test(candidate.title)
      || archivalTrailer(candidate.title, candidate.publishedAt)) return [];
    const type = trailerType(candidate.title);
    const key = filmKey(candidate.title);
    const score = (candidate.publisherRole === "official" ? 1_000 : 500)
      + (type === "main" ? 80 : type === "final" ? 60 : type === "teaser" ? 40 : 0)
      + Math.floor(Date.parse(candidate.publishedAt) / 86_400_000) % 31;
    return [{ ...candidate, trailerType: type, filmKey: key, score }];
  }).sort((left, right) => right.score - left.score
    || right.publishedAt.localeCompare(left.publishedAt)
    || left.sourceUrl.localeCompare(right.sourceUrl));

  const selected: SelectedTrailerCandidate[] = [];
  const publisherCounts = new Map<string, number>();
  for (const candidate of qualified) {
    if (selected.some((existing) => existing.filmKey === candidate.filmKey
      || similarity(existing.title, candidate.title) >= 0.72)) continue;
    const publisherCount = publisherCounts.get(candidate.publisherChannelId) ?? 0;
    // A prolific studio or streamer must not turn the weekly selection into
    // its private playlist. This is a hard cap: returning fewer trailers is
    // preferable to silently relaxing the editorial contract.
    if (publisherCount >= 3) continue;
    selected.push(candidate);
    publisherCounts.set(candidate.publisherChannelId, publisherCount + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function newsScore(candidate: CinemaNewsCandidate, coverageEnd: string): number {
  const titleAndCategories = `${candidate.title} ${candidate.categories.join(" ")}`;
  const combined = `${titleAndCategories} ${candidate.excerpt}`;
  // General publisher feeds also carry travel, fashion and hospitality. An
  // incidental cinema word in the excerpt is insufficient qualification.
  if (!CINEMA_NEWS.test(titleAndCategories)) return -1;
  // Publisher categories can be broad (for example, a film-festival hotel
  // story). Adjacent lifestyle or TV-only headlines need an explicit film
  // signal in the headline itself before entering the Cinema candidate pool.
  if (ADJACENT_NON_FILM_TITLE.test(candidate.title) && !EXPLICIT_FILM_TITLE.test(candidate.title)) return -1;
  // General entertainment feeds mix cinema with television, unscripted shows
  // and industry conferences. Those enter Cinema only when the headline itself
  // contains an explicit film signal; a broad RSS category is not sufficient.
  if (SCREEN_ADJACENT_TITLE.test(candidate.title) && !EXPLICIT_CINEMA_TITLE.test(candidate.title)) return -1;
  const ageHours = Math.max(0, (Date.parse(coverageEnd) - Date.parse(candidate.publishedAt)) / 3_600_000);
  return 100
    + (HIGH_IMPACT.test(combined) ? 35 : 0)
    - (LOW_SIGNAL.test(candidate.title) ? 45 : 0)
    + Math.max(0, 30 - Math.floor(ageHours / 8));
}

export function selectNewsCandidates(
  candidates: CinemaNewsCandidate[],
  coverageEnd: string,
  limit: number,
): SelectedNewsCandidate[] {
  const qualified = candidates.map((candidate) => ({
    ...candidate,
    score: newsScore(candidate, coverageEnd),
  })).filter((candidate) => candidate.score >= 80)
    .sort((left, right) => right.score - left.score
      || right.publishedAt.localeCompare(left.publishedAt)
      || left.sourceUrl.localeCompare(right.sourceUrl));
  const selected: SelectedNewsCandidate[] = [];
  const publisherCounts = new Map<string, number>();
  for (const candidate of qualified) {
    if (selected.some((existing) => sameNewsSubject(existing.title, candidate.title))) continue;
    const publisherCount = publisherCounts.get(candidate.publisher) ?? 0;
    const softPublisherLimit = Math.max(3, Math.ceil(limit * 0.4));
    if (publisherCount >= softPublisherLimit
      && qualified.some((alternative) => alternative.publisher !== candidate.publisher
        && !selected.some((entry) => entry.id === alternative.id))) continue;
    selected.push(candidate);
    publisherCounts.set(candidate.publisher, publisherCount + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}
