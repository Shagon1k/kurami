import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";
import jpeg from "jpeg-js";

// Only fixed, non-secret reasons cross the rollout error boundary.
export class PredecessorImageError extends Error {}

export const MAX_IMAGES = 16;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
export type PredecessorImage = { imageId: string; sha256: string; bytes: Buffer };

/** Native PNG/JPEG data images only. Never resolve paths or fetch URLs. */
export function decodePredecessorImage(value: unknown): { bytes: Buffer; sha256: string } {
  const prefix = typeof value === "string" ? /^(data:image\/(png|jpeg);base64,)/u.exec(value) : null;
  if (!prefix) throw new PredecessorImageError("unsupported owner image representation; only PNG/JPEG base64 data images are supported (no paths or URLs)");
  const encoded = (value as string).slice(prefix[1]!.length);
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new PredecessorImageError("owner image exceeds the 2 MiB file-byte bound");
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
    throw new PredecessorImageError("malformed owner image base64");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new PredecessorImageError("owner image exceeds the 2 MiB file-byte bound");
  if (bytes.toString("base64") !== encoded) throw new PredecessorImageError("malformed owner image base64");
  if (prefix[2] === "jpeg") {
    try {
      // Require the complete JPEG envelope as well as a real strict decode.
      // Keep original bytes; decoded pixels are validation only, never transcoded.
      if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9)
        throw new Error();
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false,
        tolerantDecoding: false, maxResolutionInMP: 16 * 1024 * 1024 / 1_000_000, maxMemoryUsageInMB: 256 });
      if (!decoded.width || !decoded.height) throw new Error();
    } catch {
      throw new PredecessorImageError("corrupt, unsupported, or oversized JPEG owner image; strict decode requires at most 16 Mi pixels and 256 MiB decoder memory");
    }
  } else {
    try { validatePng(bytes); }
    catch {
      throw new PredecessorImageError("corrupt, unsupported, or oversized PNG owner image; requires complete 8-bit non-interlaced RGB/RGBA, consecutive IDAT chunks, and at most 16 Mi pixels");
    }
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function validatePng(bytes: Buffer): void {
  if (bytes.length < 45 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii",12,16) !== "IHDR" ||
      bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0 ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16 * 1024 * 1024 ||
      !bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex")))
    throw new Error("unsupported or oversized PNG owner image");
  // Bounded native screenshot subset: 8-bit, non-interlaced RGB/RGBA PNG.
  // Validate chunks and scanlines before claim; corrupt images must not become
  // a CLI warning followed by a text-only task.
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
    throw new Error("unsupported PNG owner image encoding");
  const compressed: Buffer[] = [];
  let offset = 8, ended = false, idatEnded = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("malformed PNG owner image");
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error("malformed PNG owner image");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if ((offset !== 8 && kind === "IHDR") || ["acTL", "fcTL", "fdAT"].includes(kind) ||
        (!(bytes[offset + 4]! & 32) && !["IHDR", "PLTE", "IDAT", "IEND"].includes(kind)))
      throw new Error("unsupported PNG owner image chunk");
    if (kind === "IDAT") {
      if (idatEnded) throw new Error("nonconsecutive PNG owner image IDAT chunks");
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (compressed.length) idatEnded = true;
    if (kind === "IEND") { if (end !== bytes.length || length !== 0) throw new Error("malformed PNG owner image"); ended = true; }
    offset = end;
  }
  if (!ended || !compressed.length) throw new Error("incomplete PNG owner image");
  const stride = bytes.readUInt32BE(16) * (bytes[25] === 6 ? 4 : 3) + 1;
  const expected = stride * bytes.readUInt32BE(20);
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (pixels.length !== expected) throw new Error("incomplete PNG owner image pixels");
  for (let row = 0; row < pixels.length; row += stride)
    if (pixels[row]! > 4) throw new Error("unsupported PNG owner image filter");
}

export function assertImageBounds(images: PredecessorImage[]): void {
  if (images.length > MAX_IMAGES || images.reduce((size, image) => size + image.bytes.length, 0) > MAX_TOTAL_IMAGE_BYTES)
    throw new Error("Predecessor conversation unavailable: images exceed 16 attachments or 8 MiB; nothing was truncated. No successor may start.");
}
