type JsonRecord = Record<string, unknown>;

export type TmdbMovieCandidate = {
  id: number;
  title: string;
  originalTitle: string;
  originalLanguage?: string;
  releaseDate?: string;
  posterPath?: string;
  genreIds: number[];
  popularity: number;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid TMDB response: ${label}`);
  return value as JsonRecord;
}

export function normalizeTmdbMovieResults(value: unknown): TmdbMovieCandidate[] {
  const root = record(value, "root");
  if (!Array.isArray(root.results) || root.results.length > 100) {
    throw new Error("Invalid TMDB response: results");
  }
  return root.results.map((entry, index) => {
    const raw = record(entry, `results[${index}]`);
    if (!Number.isSafeInteger(raw.id) || Number(raw.id) < 1) throw new Error("Invalid TMDB response: movie ID");
    if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error("Invalid TMDB response: title");
    if (typeof raw.original_title !== "string" || !raw.original_title.trim()) {
      throw new Error("Invalid TMDB response: original title");
    }
    const releaseDate = typeof raw.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(raw.release_date)
      ? raw.release_date
      : undefined;
    const posterPath = typeof raw.poster_path === "string" && /^\/[A-Za-z0-9._-]+$/u.test(raw.poster_path)
      ? raw.poster_path
      : undefined;
    const genreIds = Array.isArray(raw.genre_ids)
      ? raw.genre_ids.filter((item): item is number => Number.isSafeInteger(item) && Number(item) > 0).slice(0, 12)
      : [];
    return {
      id: Number(raw.id),
      title: raw.title.trim().slice(0, 220),
      originalTitle: raw.original_title.trim().slice(0, 220),
      ...(typeof raw.original_language === "string" && /^[a-z]{2,3}$/u.test(raw.original_language)
        ? { originalLanguage: raw.original_language }
        : {}),
      ...(releaseDate ? { releaseDate } : {}),
      ...(posterPath ? { posterPath } : {}),
      genreIds,
      popularity: typeof raw.popularity === "number" && Number.isFinite(raw.popularity) ? raw.popularity : 0,
    };
  });
}
