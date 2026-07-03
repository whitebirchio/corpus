/**
 * Generates the committed PWA icons (public/*.png) with zero dependencies:
 * a minimal PNG encoder (zlib + hand-rolled CRC32) drawing the Corpus "C" —
 * a white ring with a right-side gap on a deep blue rounded square.
 *
 * Rerun after design changes: node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = [0x10, 0x42, 0x81]; // reference palette blue 650
const FG = [0xfc, 0xfc, 0xfb]; // light surface white

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing ----------------------------------------------------------------

/** 1 inside the rounded square, else 0. */
function roundedSquare(x, y, size, radius) {
  const lo = radius;
  const hi = size - radius;
  const cx = x < lo ? lo : x > hi ? hi : x;
  const cy = y < lo ? lo : y > hi ? hi : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius ? 1 : 0;
}

/** 1 inside the "C" ring (annulus with a gap opening to the right), else 0. */
function cRing(x, y, size) {
  const c = size / 2;
  const dx = x - c;
  const dy = y - c;
  const dist = Math.hypot(dx, dy);
  const rOuter = size * 0.31;
  const rInner = size * 0.185;
  if (dist > rOuter || dist < rInner) return 0;
  // Gap: ±38° around the positive x axis, with rounded ends via cap dots.
  const angle = Math.atan2(dy, dx);
  const gap = (38 * Math.PI) / 180;
  if (Math.abs(angle) > gap) return 1;
  // Rounded stroke ends at the gap edges
  const rMid = (rOuter + rInner) / 2;
  const capR = (rOuter - rInner) / 2;
  for (const a of [gap, -gap]) {
    const ex = c + rMid * Math.cos(a);
    const ey = c + rMid * Math.sin(a);
    if (Math.hypot(x - ex, y - ey) <= capR) return 1;
  }
  return 0;
}

/**
 * Render at `size` with 3x3 supersampling.
 * mode "rounded": rounded-square tile (home-screen icon, transparent corners)
 * mode "maskable": full-bleed background, glyph shrunk into the 80% safe zone
 */
function drawIcon(size, mode) {
  const rgba = Buffer.alloc(size * size * 4);
  const glyphScale = mode === "maskable" ? 0.8 : 1;
  const radius = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3;
          const py = y + (sy + 0.5) / 3;
          const inBg = mode === "maskable" ? 1 : roundedSquare(px, py, size, radius);
          bgHits += inBg;
          if (inBg) {
            const gx = (px - size / 2) / glyphScale + size / 2;
            const gy = (py - size / 2) / glyphScale + size / 2;
            fgHits += cRing(gx, gy, size);
          }
        }
      }
      const i = (y * size + x) * 4;
      const bgA = bgHits / 9;
      const fgA = fgHits / 9;
      rgba[i] = Math.round(FG[0] * fgA + BG[0] * (1 - fgA));
      rgba[i + 1] = Math.round(FG[1] * fgA + BG[1] * (1 - fgA));
      rgba[i + 2] = Math.round(FG[2] * fgA + BG[2] * (1 - fgA));
      rgba[i + 3] = Math.round(255 * bgA);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "pwa-192.png"), drawIcon(192, "rounded"));
writeFileSync(join(OUT, "pwa-512.png"), drawIcon(512, "rounded"));
writeFileSync(join(OUT, "pwa-maskable-512.png"), drawIcon(512, "maskable"));
// iOS composites its own corner mask; ship it full-bleed opaque.
writeFileSync(join(OUT, "apple-touch-icon.png"), drawIcon(180, "maskable"));
console.log(`icons written to ${OUT}`);
