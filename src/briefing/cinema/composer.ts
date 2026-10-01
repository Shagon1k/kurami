import type { CinemaRuntimeConfig } from "../runtime-config.ts";
import type { SectionState } from "../model.ts";
import type { CinemaCollectionCandidate } from "./collector.ts";
import { parseCinemaEditorialDraft, type CinemaEditorialDraft } from "./editorial.ts";
import { parseCinemaEnvelope, type CinemaEnvelope, type CinemaSourceReference } from "./model.ts";

export type CinemaMediaMap = Record<string, string>;

function sourceIdFor(provenance: CinemaSourceReference[], provider: string): string {
  const source = provenance.find((item) => item.provider === provider);
  if (!source) throw new Error(`Cinema candidate is missing provenance for ${provider}`);
  return source.id;
}

function finalState(state: SectionState, itemCount: number): SectionState {
  if (state === "failed" || state === "stale") return state;
  if (itemCount === 0) return state === "partial" ? "partial" : "empty";
  return state === "partial" ? "partial" : "ready";
}

function eligibleNewsIds(candidate: CinemaCollectionCandidate, limit: number): Set<string> {
  const ordered = candidate.news.candidates;
  if (!ordered.length) return new Set();
  const boundary = ordered[Math.min(limit, ordered.length) - 1]?.score ?? ordered[0]!.score;
  const minimum = Math.max(80, boundary - 12);
  return new Set(ordered.filter((item) => item.score >= minimum).map((item) => item.id));
}

function orderedNewsDrafts(
  candidate: CinemaCollectionCandidate,
  draft: CinemaEditorialDraft,
  limit: number,
): Array<{ source: CinemaCollectionCandidate["news"]["candidates"][number]; editorial: CinemaEditorialDraft["news"][number] }> {
  const candidates = new Map(candidate.news.candidates.map((item) => [item.id, item]));
  const eligible = eligibleNewsIds(candidate, limit);
  const requested = draft.news.map((editorial) => {
    const source = candidates.get(editorial.candidateId);
    if (!source) throw new Error(`Cinema editorial draft selected unknown candidate ${editorial.candidateId}`);
    if (!eligible.has(source.id)) throw new Error(`Cinema editorial draft selected out-of-band candidate ${source.id}`);
    return { source, editorial };
  }).sort((left, right) => right.source.score - left.source.score
    || right.source.publishedAt.localeCompare(left.source.publishedAt)
    || left.source.sourceUrl.localeCompare(right.source.sourceUrl));

  const result: typeof requested = [];
  const publisherCounts = new Map<string, number>();
  const sourceLimit = Math.max(3, Math.ceil(limit * 0.4));
  for (const item of requested) {
    const count = publisherCounts.get(item.source.publisher) ?? 0;
    const hasAlternative = requested.some((alternative) => alternative.source.publisher !== item.source.publisher
      && !result.some((selected) => selected.source.id === alternative.source.id));
    if (count >= sourceLimit && hasAlternative) continue;
    result.push(item);
    publisherCounts.set(item.source.publisher, count + 1);
    if (result.length >= limit) break;
  }
  return result;
}

function validatedNotes(draft: CinemaEditorialDraft, selectedNewsIds: Set<string>): CinemaEditorialDraft["notes"] {
  const allowed = new Set(["box-office", "trailers", "premieres", "news", ...[...selectedNewsIds].map((id) => `news:${id}`)]);
  for (const note of draft.notes) {
    if (!allowed.has(note.target)) throw new Error(`Cinema editorial note targets unavailable content: ${note.target}`);
  }
  if (selectedNewsIds.size >= 10 && (draft.notes.length < 2 || draft.notes.length > 3)) {
    throw new Error("A full Cinema news section requires 2-3 grounded Kurami Notes");
  }
  return draft.notes;
}

function envelopeState(states: SectionState[], contentSections: number): CinemaEnvelope["state"] {
  if (contentSections === 0) return states.some((state) => state === "failed") ? "failed" : "empty";
  return states.every((state) => state === "ready" || state === "empty") ? "ready" : "partial";
}

export function composeCinemaEnvelope(input: {
  candidate: CinemaCollectionCandidate;
  draft: unknown;
  config: CinemaRuntimeConfig;
  media?: CinemaMediaMap;
}): CinemaEnvelope {
  const draft = parseCinemaEditorialDraft(input.draft);
  const candidate = input.candidate;
  if (candidate.localDate !== draft.localDate) throw new Error("Cinema candidate and editorial dates differ");
  if (candidate.market !== input.config.market || candidate.timezone !== input.config.timeZone) {
    throw new Error("Cinema candidate does not match active market configuration");
  }
  const chosenNews = orderedNewsDrafts(candidate, draft, input.config.limits.news);
  if (candidate.news.candidates.length && !chosenNews.length) {
    throw new Error("Cinema editorial draft omitted every qualified news candidate");
  }
  const media = input.media ?? {};
  const trailers = candidate.trailers.candidates.slice(0, input.config.limits.trailers).map((item) => ({
    id: item.id,
    title: item.title,
    videoId: item.videoId,
    publisher: item.publisher,
    publisherChannelId: item.publisherChannelId,
    publisherRole: item.publisherRole,
    publishedAt: item.publishedAt,
    sourceUrl: item.sourceUrl,
    ...(media[item.id] ? { thumbnailSrc: media[item.id] } : {}),
    ...(item.durationSeconds === undefined ? {} : { durationSeconds: item.durationSeconds }),
    trailerType: item.trailerType,
    sourceId: sourceIdFor(candidate.provenance, "YouTube"),
  }));
  const premieres = candidate.premieres.candidates.slice(0, input.config.limits.premieres).map((item) => ({
    id: item.id,
    localTitle: item.localTitle,
    ...(item.originalTitle ? { originalTitle: item.originalTitle } : {}),
    releaseDate: item.releaseDate,
    sourceUrl: item.sourceUrl,
    ...(media[item.id] ? { posterSrc: media[item.id] } : {}),
    ...(item.genres?.length ? { genres: item.genres } : {}),
    ...(item.runtimeMinutes ? { runtimeMinutes: item.runtimeMinutes } : {}),
    ...(item.ageRating ? { ageRating: item.ageRating } : {}),
    ...(item.directors?.length ? { directors: item.directors } : {}),
    ...(item.cast?.length ? { cast: item.cast } : {}),
    sourceId: sourceIdFor(candidate.provenance, "cinema.lt"),
  }));
  const news = chosenNews.map(({ source, editorial }) => ({
    id: source.id,
    headline: editorial.headline,
    summary: editorial.summary,
    ...(editorial.en?{en:editorial.en}:{}),
    publisher: source.publisher,
    publishedAt: source.publishedAt,
    sourceUrl: source.sourceUrl,
    ...(media[source.id] ? { imageSrc: media[source.id] } : {}),
    sourceId: sourceIdFor(candidate.provenance, source.publisher),
  }));
  const selectedNewsIds = new Set(news.map((item) => item.id));
  const trailerState = finalState(candidate.trailers.state, trailers.length);
  const premiereState = finalState(candidate.premieres.state, premieres.length);
  const newsState = finalState(candidate.news.state, news.length);
  const states = [candidate.boxOffice.state, trailerState, premiereState, newsState];
  const contentSections = [
    candidate.boxOffice.charts.length,
    trailers.length,
    premieres.length,
    news.length,
  ].filter(Boolean).length;
  const failed = states.filter((state) => state === "failed").length;
  const partial = states.filter((state) => state === "partial").length;
  return parseCinemaEnvelope({
    version: 1,
    state: envelopeState(states, contentSections),
    capturedAt: candidate.capturedAt,
    data: {
      market: candidate.market,
      timezone: candidate.timezone,
      language: candidate.language,
      localDate: candidate.localDate,
      coverage: candidate.coverage,
      boxOffice: candidate.boxOffice,
      trailers: { state: trailerState, capturedAt: candidate.capturedAt, items: trailers, provenance: trailers.length ? candidate.trailers.provenance : [], diagnostics: candidate.trailers.diagnostics },
      premieres: { state: premiereState, capturedAt: candidate.capturedAt, items: premieres, provenance: premieres.length ? candidate.premieres.provenance : [], diagnostics: candidate.premieres.diagnostics },
      news: { state: newsState, capturedAt: candidate.capturedAt, items: news, provenance: [...new Set(news.map((item) => item.sourceId))], diagnostics: candidate.news.diagnostics },
      notes: validatedNotes(draft, selectedNewsIds),
      quality: {
        summary: failed || partial ? `Срез собран частично: ${failed} недоступно, ${partial} неполно.` : "Все Cinema-разделы собраны и проверены.",
        diagnostics: candidate.diagnostics,
      },
      provenance: candidate.provenance,
    },
  });
}

export function composeCinemaFallbackEnvelope(input: {
  candidate: CinemaCollectionCandidate;
  config: CinemaRuntimeConfig;
  media?: CinemaMediaMap;
}): CinemaEnvelope {
  const withoutEditorialNews: CinemaCollectionCandidate = {
    ...input.candidate,
    news: {
      state: "failed",
      candidates: [],
      provenance: [],
      diagnostics: [...input.candidate.news.diagnostics, "cinema-news:editorial_unavailable"],
    },
    diagnostics: [...input.candidate.diagnostics, "cinema-news:editorial_unavailable"],
  };
  return composeCinemaEnvelope({
    candidate: withoutEditorialNews,
    config: input.config,
    media: input.media,
    draft: { version: 1, localDate: input.candidate.localDate, news: [], notes: [] },
  });
}
