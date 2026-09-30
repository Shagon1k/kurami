import type { CinemaNote } from "./model.ts";

export type CinemaEditorialNews = {
  candidateId: string;
  headline: string;
  summary: string;
  en?: {headline:string;summary:string};
};

export type CinemaEditorialDraft = {
  version: 1;
  localeVersion?: 2;
  localDate: string;
  news: CinemaEditorialNews[];
  notes: CinemaNote[];
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MARKS = new Set<CinemaNote["mark"]>(["arrow-down", "arrow-down-left", "arrow-down-right", "arrow-right"]);
const GENERIC_COPY = /^(?:что произошло|подробности|главное за неделю|стало известно)\s*[:—-]/iu;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const result = value.replace(/\s+/gu, " ").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`${label} must contain ${minimum}-${maximum} characters`);
  }
  return result;
}

function safeId(value: unknown, label: string): string {
  const result = text(value, label, 1, 160);
  if (!SAFE_ID.test(result)) throw new Error(`${label} is unsafe`);
  return result;
}

function russianEditorial(value: unknown, label: string, minimum: number, maximum: number): string {
  const result = text(value, label, minimum, maximum);
  if (!/[А-ЯЁа-яё]/u.test(result)) throw new Error(`${label} must contain Russian editorial copy`);
  if (GENERIC_COPY.test(result)) throw new Error(`${label} starts with forbidden generic copy`);
  return result;
}

export function parseCinemaEditorialDraft(value: unknown): CinemaEditorialDraft {
  const root = record(value, "Cinema editorial draft");
  if (root.version !== 1) throw new Error("Cinema editorial draft.version must equal 1");
  if (root.localeVersion !== undefined && root.localeVersion !== 2) throw new Error("Cinema editorial draft.localeVersion must be 2");
  const localDate = text(root.localDate, "Cinema editorial draft.localDate", 10, 10);
  if (!LOCAL_DATE.test(localDate)) throw new Error("Cinema editorial draft.localDate must be YYYY-MM-DD");
  if (!Array.isArray(root.news) || root.news.length > 15) {
    throw new Error("Cinema editorial draft.news must contain at most 15 stories");
  }
  const news = root.news.map((value, index): CinemaEditorialNews => {
    const item = record(value, `Cinema editorial draft.news[${index}]`);
    if(root.localeVersion===2 && item.en===undefined)throw new Error(`Cinema editorial draft.news[${index}].en is required for bilingual editions`);
    const headline = russianEditorial(item.headline, `Cinema editorial draft.news[${index}].headline`, 12, 150);
    const summary = russianEditorial(item.summary, `Cinema editorial draft.news[${index}].summary`, 45, 420);
    if (headline.toLocaleLowerCase("ru-RU") === summary.toLocaleLowerCase("ru-RU")) {
      throw new Error(`Cinema editorial draft.news[${index}] repeats its headline as summary`);
    }
    return {
      candidateId: safeId(item.candidateId, `Cinema editorial draft.news[${index}].candidateId`),
      headline,
      summary,
      ...(item.en!==undefined?{en:(()=>{const en=record(item.en,`Cinema editorial draft.news[${index}].en`);return {
        headline:text(en.headline,`Cinema editorial draft.news[${index}].en.headline`,12,150),
        summary:text(en.summary,`Cinema editorial draft.news[${index}].en.summary`,45,420),
      };})()}:{}),
    };
  });
  if (new Set(news.map((item) => item.candidateId)).size !== news.length) {
    throw new Error("Cinema editorial draft.news candidate IDs must be unique");
  }
  if (!Array.isArray(root.notes) || root.notes.length > 3) {
    throw new Error("Cinema editorial draft.notes must contain at most 3 notes");
  }
  const notes = root.notes.map((value, index): CinemaNote => {
    const item = record(value, `Cinema editorial draft.notes[${index}]`);
    if(root.localeVersion===2 && item.enText===undefined)throw new Error(`Cinema editorial draft.notes[${index}].enText is required for bilingual editions`);
    const note = russianEditorial(item.text, `Cinema editorial draft.notes[${index}].text`, 2, 48);
    if (note.split(/\s+/u).length > 4) throw new Error(`Cinema editorial draft.notes[${index}].text exceeds four words`);
    if (typeof item.mark !== "string" || !MARKS.has(item.mark as CinemaNote["mark"])) {
      throw new Error(`Cinema editorial draft.notes[${index}].mark is unsupported`);
    }
    return {
      id: safeId(item.id, `Cinema editorial draft.notes[${index}].id`),
      target: safeId(item.target, `Cinema editorial draft.notes[${index}].target`),
      text: note,
      ...(item.enText!==undefined?{enText:text(item.enText,`Cinema editorial draft.notes[${index}].enText`,2,48)}:{}),
      mark: item.mark as CinemaNote["mark"],
    };
  });
  if (new Set(notes.map((item) => item.id)).size !== notes.length) {
    throw new Error("Cinema editorial draft.note IDs must be unique");
  }
  return { version: 1, ...(root.localeVersion===2?{localeVersion:2 as const}:{}), localDate, news, notes };
}
