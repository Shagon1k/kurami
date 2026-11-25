import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";

export const MAX_IMAGES = 16;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
export type PredecessorImage = { imageId: string; sha256: string; bytes: Buffer };

/** Only the native PNG data form observed in owner rollouts is supported.
 * Never resolve a path, fetch a URL, or include the data URL in an error/evidence.
 */
export function decodePredecessorImage(value: unknown): { bytes: Buffer; sha256: string } {
  const prefix = "data:image/png;base64,";
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > prefix.length + Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new Error("unsupported or oversized owner image");
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
    throw new Error("malformed owner image");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== encoded || bytes.length < 45 ||
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
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function assertImageBounds(images: PredecessorImage[]): void {
  if (images.length > MAX_IMAGES || images.reduce((size, image) => size + image.bytes.length, 0) > MAX_TOTAL_IMAGE_BYTES)
    throw new Error("Predecessor conversation unavailable: images exceed 16 attachments or 8 MiB; nothing was truncated. No successor may start.");
}
