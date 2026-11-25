import { deflateSync } from "node:zlib";

// Synthetic RGBA PNG; no owner screenshots are copied into the repository.
export function imageBytes(red = 40, idatLayout: "single" | "consecutive" | "separated" = "single"): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, body, suffix]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1,4); header[8]=8; header[9]=6;
  const compressed = deflateSync(Buffer.from([0,red,80,120,255]));
  const dataChunks = idatLayout === "single" ? [chunk("IDAT",compressed)] : [
    chunk("IDAT",compressed.subarray(0,4)),
    ...(idatLayout === "separated" ? [chunk("tEXt",Buffer.from("note\0synthetic"))] : []),
    chunk("IDAT",compressed.subarray(4)),
  ];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
    ...dataChunks,chunk("IEND",Buffer.alloc(0))]);
}
export function imageMessage(red = 40) {
  return {type:"response_item",payload:{type:"message",role:"user",content:[
    {type:"input_text",text:"Original owner text before screenshot."},
    {type:"input_image",image_url:`data:image/png;base64,${imageBytes(red).toString("base64")}`,detail:"high"},
    {type:"input_text",text:"Owner correction after screenshot; do not lose it."},
  ],internal_chat_message_metadata_passthrough:{content_item_kinds:["user.text","user.image","user.text"]}}};
}
