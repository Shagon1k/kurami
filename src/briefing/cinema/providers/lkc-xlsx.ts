import { inflateRawSync } from "node:zlib";

export type LkcWorkbookReference = {
  url: string;
  weekendStart: string;
  weekendEnd: string;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function isoDate(year: string, month: string, day: string): string {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid LKC report date");
  }
  return value;
}

export function discoverLkcWeekendWorkbook(
  html: string,
  pageUrl: string,
  editionDate: string,
): LkcWorkbookReference {
  if (Buffer.byteLength(html, "utf8") > 2 * 1_024 * 1_024) throw new Error("LKC discovery page exceeds 2 MiB");
  const base = new URL(pageUrl);
  const candidates: LkcWorkbookReference[] = [];
  for (const match of html.matchAll(/href=["']([^"']+\.xlsx(?:\?[^"']*)?)["']/giu)) {
    const href = decodeEntities(match[1]!);
    const filename = decodeURIComponent(new URL(href, base).pathname.split("/").at(-1) ?? "");
    const dates = /Savaitgalio\s+\(Weekend\)\s+TOP\s+(\d{4})\.(\d{2})\.(\d{2})-(?:(\d{4})\.)?(\d{2})\.(\d{2})\.xlsx$/iu.exec(filename);
    if (!dates) continue;
    const start = isoDate(dates[1]!, dates[2]!, dates[3]!);
    const end = isoDate(dates[4] ?? dates[1]!, dates[5]!, dates[6]!);
    const url = new URL(href, base);
    if (url.protocol !== "https:" || url.hostname !== base.hostname || url.username || url.password) continue;
    const ageDays = (Date.parse(`${editionDate}T12:00:00Z`) - Date.parse(`${end}T12:00:00Z`)) / 86_400_000;
    if (ageDays < 0 || ageDays > 14) continue;
    candidates.push({ url: url.toString(), weekendStart: start, weekendEnd: end });
  }
  candidates.sort((left, right) => right.weekendEnd.localeCompare(left.weekendEnd) || left.url.localeCompare(right.url));
  if (!candidates.length) throw new Error("No fresh LKC weekend workbook found");
  return candidates[0]!;
}

type ZipEntry = { compression: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function zipEntries(buffer: Buffer): Map<string, ZipEntry> {
  if (buffer.byteLength < 22 || buffer.byteLength > 2 * 1_024 * 1_024) throw new Error("Invalid bounded LKC XLSX archive");
  let end = -1;
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("LKC XLSX end record is missing");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count < 1 || count > 2_000) throw new Error("LKC XLSX entry count is invalid");
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("LKC XLSX central directory is invalid");
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!name || name.includes("\\") || name.split("/").includes("..")) throw new Error("LKC XLSX entry path is unsafe");
    entries.set(name, { compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function unzipEntry(buffer: Buffer, entries: Map<string, ZipEntry>, name: string): Buffer {
  const entry = entries.get(name);
  if (!entry) throw new Error(`LKC XLSX entry ${name} is missing`);
  const offset = entry.localOffset;
  if (offset + 30 > buffer.byteLength || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("LKC XLSX local header is invalid");
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.byteLength || entry.uncompressedSize > 8 * 1_024 * 1_024) throw new Error("LKC XLSX entry exceeds bounds");
  const compressed = buffer.subarray(start, end);
  const value = entry.compression === 0 ? Buffer.from(compressed)
    : entry.compression === 8 ? inflateRawSync(compressed)
    : (() => { throw new Error("LKC XLSX compression method is unsupported"); })();
  if (value.byteLength !== entry.uncompressedSize) throw new Error("LKC XLSX entry size mismatch");
  return value;
}

function xmlTexts(block: string): string {
  return [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/giu)]
    .map((match) => decodeEntities(match[1]!))
    .join("");
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/u.exec(reference)?.[0];
  if (!letters) throw new Error("LKC XLSX cell reference is invalid");
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function parseLkcWorkbook(buffer: Buffer): unknown[][] {
  const entries = zipEntries(buffer);
  const shared = entries.has("xl/sharedStrings.xml")
    ? [...unzipEntry(buffer, entries, "xl/sharedStrings.xml").toString("utf8").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/giu)]
      .map((match) => xmlTexts(match[1]!))
    : [];
  const sheetName = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name)).sort()[0];
  if (!sheetName) throw new Error("LKC XLSX first worksheet is missing");
  const sheet = unzipEntry(buffer, entries, sheetName).toString("utf8");
  const rows: unknown[][] = [];
  for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/giu)) {
    const row: unknown[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/giu)) {
      const attributes = cellMatch[1]!;
      const body = cellMatch[2]!;
      const reference = /\br="([A-Z]+\d+)"/u.exec(attributes)?.[1];
      if (!reference) continue;
      const type = /\bt="([^"]+)"/u.exec(attributes)?.[1] ?? "n";
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1] ?? "";
      let value: unknown = null;
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = xmlTexts(body);
      else if (type === "str") value = decodeEntities(raw);
      else if (raw.trim() && Number.isFinite(Number(raw))) value = Number(raw);
      row[columnIndex(reference)] = value;
    }
    rows.push(row);
    if (rows.length > 500) throw new Error("LKC XLSX worksheet exceeds row limit");
  }
  if (!rows.length) throw new Error("LKC XLSX worksheet is empty");
  return rows;
}
