/**
 * Generates the extension icons from the design in `docs/assets/logo.svg` — a red shield
 * with the "iu" wordmark — without any image dependency.
 *
 * The shield outline is the SVG path flattened to a polygon, rasterised with 4x4
 * supersampling for antialiasing, and written as PNG by hand (zlib deflate + CRC32 chunks).
 *
 *   npx tsx packages/extension/src/ui/scripts/gen-icons.ts
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type RGB = readonly [number, number, number];
interface Point {
  x: number;
  y: number;
}

const DESIGN = 128; // logo.svg viewBox
const SUPERSAMPLE = 4;

const SHIELD_LIGHT: RGB = [0xb9, 0x1c, 0x1c];
const SHIELD_DARK: RGB = [0x7f, 0x1d, 0x1d];
const OFF_LIGHT: RGB = [0x8b, 0x92, 0x9d];
const OFF_DARK: RGB = [0x4b, 0x52, 0x5e];

/* ------------------------------------------------------------------ geometry */

function cubicTo(from: Point, c1: Point, c2: Point, to: Point, out: Point[], steps = 28): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({
      x: a * from.x + b * c1.x + c * c2.x + d * to.x,
      y: a * from.y + b * c1.y + c * c2.y + d * to.y,
    });
  }
}

/** `M64 6 L112 24 V62 C112 90 92 112 64 122 C36 112 16 90 16 62 V24 Z` */
function shieldOutline(): Point[] {
  const pts: Point[] = [
    { x: 64, y: 6 },
    { x: 112, y: 24 },
    { x: 112, y: 62 },
  ];
  cubicTo({ x: 112, y: 62 }, { x: 112, y: 90 }, { x: 92, y: 112 }, { x: 64, y: 122 }, pts);
  cubicTo({ x: 64, y: 122 }, { x: 36, y: 112 }, { x: 16, y: 90 }, { x: 16, y: 62 }, pts);
  pts.push({ x: 16, y: 24 });
  return pts;
}

/** `M64 16 L102 30 V62 C102 84 86 102 64 111 C42 102 26 84 26 62 V30 Z` (stroked, not filled) */
function shieldInnerRing(): Point[] {
  const pts: Point[] = [
    { x: 64, y: 16 },
    { x: 102, y: 30 },
    { x: 102, y: 62 },
  ];
  cubicTo({ x: 102, y: 62 }, { x: 102, y: 84 }, { x: 86, y: 102 }, { x: 64, y: 111 }, pts);
  cubicTo({ x: 64, y: 111 }, { x: 42, y: 102 }, { x: 26, y: 84 }, { x: 26, y: 62 }, pts);
  pts.push({ x: 26, y: 30 });
  return pts;
}

function pointInPolygon(poly: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToPolygon(poly: readonly Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const d = distanceToSegment(x, y, a, b);
    if (d < best) best = d;
  }
  return best;
}

interface RoundRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

function insideRoundRect(rect: RoundRect, x: number, y: number): boolean {
  const dx = Math.max(rect.x0 + rect.r - x, x - (rect.x1 - rect.r), 0);
  const dy = Math.max(rect.y0 + rect.r - y, y - (rect.y1 - rect.r), 0);
  return Math.hypot(dx, dy) <= rect.r;
}

/** The "iu" wordmark, hand-built from rounded rectangles in design units. */
const WORDMARK: RoundRect[] = [
  { x0: 44, y0: 40.5, x1: 52, y1: 48.5, r: 3.2 }, // dot of the i
  { x0: 44, y0: 53, x1: 52, y1: 80, r: 2.6 }, // stem of the i
  { x0: 59, y0: 53, x1: 67, y1: 80, r: 2.6 }, // left stem of the u
  { x0: 76, y0: 53, x1: 84, y1: 80, r: 2.6 }, // right stem of the u
  { x0: 59, y0: 71, x1: 84, y1: 80, r: 3.2 }, // bowl of the u
];

/* ------------------------------------------------------------------ raster */

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface IconOptions {
  size: number;
  /** Grey "blocking is off" variant. */
  off?: boolean;
}

function renderIcon({ size, off = false }: IconOptions): Uint8Array {
  const outline = shieldOutline();
  const ring = shieldInnerRing();
  // Small icons lose the padding and the inner ring: at 16 px they are pure noise.
  const zoom = size <= 32 ? 1.16 : 1;
  const drawRing = size > 32;
  const ringWidth = 3;
  const from = off ? OFF_LIGHT : SHIELD_LIGHT;
  const to = off ? OFF_DARK : SHIELD_DARK;
  const glyphAlpha = off ? 0.82 : 1;

  const pixels = new Uint8Array(size * size * 4);
  const unit = DESIGN / size / SUPERSAMPLE;
  const center = DESIGN / 2;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          // Design-space coordinates of this subsample, zoomed about the centre.
          const dx = center + ((px * SUPERSAMPLE + sx + 0.5) * unit - center) / zoom;
          const dy = center + ((py * SUPERSAMPLE + sy + 0.5) * unit - center) / zoom;
          if (!pointInPolygon(outline, dx, dy)) continue;

          const t = Math.min(1, Math.max(0, (dx / DESIGN + dy / DESIGN) / 2));
          let [r, g, b] = mix(from, to, t);

          if (drawRing && distanceToPolygon(ring, dx, dy) <= ringWidth / 2) {
            const k = 0.35;
            r = r * (1 - k) + 255 * k;
            g = g * (1 - k) + 255 * k;
            b = b * (1 - k) + 255 * k;
          }
          if (WORDMARK.some((rect) => insideRoundRect(rect, dx, dy))) {
            r = r * (1 - glyphAlpha) + 255 * glyphAlpha;
            g = g * (1 - glyphAlpha) + 255 * glyphAlpha;
            b = b * (1 - glyphAlpha) + 255 * glyphAlpha;
          }
          accR += r;
          accG += g;
          accB += b;
          accA += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (accA === 0) continue;
      pixels[offset] = Math.round(accR / accA);
      pixels[offset + 1] = Math.round(accG / accA);
      pixels[offset + 2] = Math.round(accB / accA);
      pixels[offset + 3] = Math.round((accA / samples) * 255);
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  const typed = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(typed), 8 + data.length);
  return out;
}

/** 8-bit RGBA PNG, filter type 0 on every scanline. */
function encodePng(size: number, rgba: Uint8Array): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/* ------------------------------------------------------------------ main */

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets: { file: string; options: IconOptions }[] = [
  { file: '16.png', options: { size: 16 } },
  { file: '32.png', options: { size: 32 } },
  { file: '48.png', options: { size: 48 } },
  { file: '128.png', options: { size: 128 } },
  { file: '16-off.png', options: { size: 16, off: true } },
  { file: '32-off.png', options: { size: 32, off: true } },
];

for (const { file, options } of targets) {
  const png = encodePng(options.size, renderIcon(options));
  writeFileSync(join(outDir, file), png);
  console.info(`icons: wrote ${file} (${png.length} bytes)`);
}
