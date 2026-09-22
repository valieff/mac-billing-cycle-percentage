import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const assetsDir = path.join(import.meta.dirname, "..", "assets");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function drawRing(size) {
  const pixels = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const outer = size * 0.46;
  const inner = size * 0.28;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const edge = Math.min(distance - inner, outer - distance);
      const alpha = Math.max(0, Math.min(1, edge + 0.65));
      if (alpha <= 0) {
        continue;
      }
      const offset = (y * size + x) * 4;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function png(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, "iconTemplate.png"), png(16, drawRing(16)));
fs.writeFileSync(path.join(assetsDir, "iconTemplate@2x.png"), png(32, drawRing(32)));
