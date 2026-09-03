export type LkcWeekendEntry = {
  id: string;
  rank: number;
  previousRank?: number;
  title: string;
  weekendGrossEur: number;
  previousWeekendGrossEur?: number;
  changePercent?: number;
  admissions?: number;
  showCount?: number;
  weekInRelease?: number;
  cumulativeGrossEur: number;
  cumulativeAdmissions?: number;
  releaseDate?: string;
  distributor?: string;
};

const EXPECTED_HEADERS = [
  "Filmas (Movie)",
  "Pajamos (GBO)",
  "Pajamos praeita sav. (GBO LW)",
  "Pakitimas (Change)",
  "Žiūrovų sk. (ADM)",
  "Seansų sk. (Show count)",
  "Rodymo savaitė (Week on screen)",
  "Bendros pajamos (Total GBO)",
  "Bendras žiūrovų sk. (Total ADM)",
  "Premjeros data (Release date)",
  "Platintojas (Distributor)",
] as const;

function normalizedCell(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid LKC workbook: ${label} must be a non-negative number`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid LKC workbook: ${label} must be an integer`);
  return result;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function excelDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const instant = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  return instant.toISOString().slice(0, 10);
}

function id(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 100);
  if (!slug) throw new Error("Invalid LKC workbook: movie title cannot form an ID");
  return `lkc:${slug}`;
}

/**
 * Pure row normalizer. XLSX decoding is kept at the collector boundary so the
 * semantic mapping can be fixture-tested without coupling Cinema to a UI.
 */
export function normalizeLkcSheetRows(rows: unknown[][]): LkcWeekendEntry[] {
  if (rows.length < 3 || rows.length > 500) throw new Error("Invalid LKC workbook: unexpected row count");
  const headers = rows[1]!.map(normalizedCell);
  for (const expected of EXPECTED_HEADERS) {
    if (!headers.includes(expected)) throw new Error(`Invalid LKC workbook: missing header ${expected}`);
  }
  const column = (expected: typeof EXPECTED_HEADERS[number]): number => headers.indexOf(expected);
  const result: LkcWeekendEntry[] = [];
  for (const [index, row] of rows.slice(2).entries()) {
    const rankValue = row[0];
    const title = normalizedCell(row[column("Filmas (Movie)")]);
    if (!title || typeof rankValue !== "number") continue;
    // The workbook's footer formula can leak a numeric style/value into the
    // first cell. It is an aggregate row, not another ranked film.
    if (/^total(?:\s|\()/iu.test(title)) continue;
    const change = optionalFinite(row[column("Pakitimas (Change)")]);
    result.push({
      id: id(title),
      rank: integer(rankValue, `row ${index + 3} rank`),
      ...(optionalInteger(row[1]) ? { previousRank: optionalInteger(row[1])! } : {}),
      title,
      weekendGrossEur: finite(row[column("Pajamos (GBO)")], `row ${index + 3} gross`),
      ...(optionalFinite(row[column("Pajamos praeita sav. (GBO LW)")]) !== undefined
        ? { previousWeekendGrossEur: optionalFinite(row[column("Pajamos praeita sav. (GBO LW)")])! }
        : {}),
      ...(change === undefined ? {} : { changePercent: Math.abs(change) <= 10 ? change * 100 : change }),
      ...(optionalInteger(row[column("Žiūrovų sk. (ADM)")]) === undefined
        ? {}
        : { admissions: optionalInteger(row[column("Žiūrovų sk. (ADM)")])! }),
      ...(optionalInteger(row[column("Seansų sk. (Show count)")]) === undefined
        ? {}
        : { showCount: optionalInteger(row[column("Seansų sk. (Show count)")])! }),
      ...(optionalInteger(row[column("Rodymo savaitė (Week on screen)")])
        ? { weekInRelease: optionalInteger(row[column("Rodymo savaitė (Week on screen)")])! }
        : {}),
      cumulativeGrossEur: finite(row[column("Bendros pajamos (Total GBO)")], `row ${index + 3} total gross`),
      ...(optionalInteger(row[column("Bendras žiūrovų sk. (Total ADM)")]) === undefined
        ? {}
        : { cumulativeAdmissions: optionalInteger(row[column("Bendras žiūrovų sk. (Total ADM)")])! }),
      ...(excelDate(row[column("Premjeros data (Release date)")])
        ? { releaseDate: excelDate(row[column("Premjeros data (Release date)")])! }
        : {}),
      ...(normalizedCell(row[column("Platintojas (Distributor)")])
        ? { distributor: normalizedCell(row[column("Platintojas (Distributor)")]) }
        : {}),
    });
  }
  if (result.length === 0) throw new Error("Invalid LKC workbook: no ranked entries");
  if (new Set(result.map((entry) => entry.rank)).size !== result.length) {
    throw new Error("Invalid LKC workbook: duplicate ranks");
  }
  return result.sort((left, right) => left.rank - right.rank);
}
