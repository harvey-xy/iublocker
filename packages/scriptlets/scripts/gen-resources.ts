/**
 * Generates packages/extension/public/resources/** (docs/SCRIPTLETS.md §5).
 *
 * Everything here is produced programmatically so the repository holds no opaque
 * binaries: run `pnpm --filter @iublocker/scriptlets gen:resources` to rebuild.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry, serializeScriptletFn } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'extension', 'public', 'resources');

/* ------------------------------------------------------------------ PNG --- */

const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}
/** A fully transparent 8-bit RGBA PNG. */
function transparentPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const raw = Buffer.alloc(height * (width * 4 + 1)); // filter byte 0 + zeroed pixels
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ MP3 --- */

/**
 * MPEG-1 Layer III, 44.1 kHz, 32 kbit/s, mono. Each frame carries 1152 samples
 * (~26.12 ms) and 104 bytes; four frames is ~0.105 s of digital silence.
 */
function silentMp3(frames: number): Buffer {
  const frameSize = Math.floor((144 * 32000) / 44100); // 104
  const out = Buffer.alloc(frames * frameSize);
  for (let i = 0; i < frames; i++) {
    const o = i * frameSize;
    out[o] = 0xff; // frame sync
    out[o + 1] = 0xfb; // MPEG-1, Layer III, no CRC
    out[o + 2] = 0x10; // 32 kbit/s, 44.1 kHz, no padding
    out[o + 3] = 0xc0; // mono
  }
  return out;
}

/* ------------------------------------------------------------------ MP4 --- */

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
}
function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
}
function u16(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16BE(v & 0xffff, i * 2));
  return b;
}
const UNITY_MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

/**
 * A structurally valid ISO base media file: one AAC audio track, one second of
 * declared duration and an empty sample table (so it decodes to nothing at all).
 */
function noopMp4(seconds: number): Buffer {
  const timescale = 1000;
  const duration = seconds * timescale;
  const audioRate = 44100;

  const ftyp = box('ftyp', Buffer.from('isom', 'ascii'), u32(512), Buffer.from('isomiso2mp41', 'ascii'));
  const mvhd = box(
    'mvhd',
    u32(0, 0, 0, timescale, duration, 0x00010000),
    u16(0x0100, 0),
    u32(0, 0),
    UNITY_MATRIX,
    Buffer.alloc(24),
    u32(2),
  );
  const tkhd = box(
    'tkhd',
    u32(0x00000007, 0, 0, 1, 0, duration),
    Buffer.alloc(8),
    u16(0, 0, 0x0100, 0),
    UNITY_MATRIX,
    u32(0, 0),
  );
  const mdhd = box('mdhd', u32(0, 0, 0, audioRate, seconds * audioRate), u16(0x55c4, 0));
  const hdlr = box(
    'hdlr',
    u32(0, 0),
    Buffer.from('soun', 'ascii'),
    Buffer.alloc(12),
    Buffer.from('SoundHandler\0', 'ascii'),
  );
  const smhd = box('smhd', u32(0), u16(0, 0));
  const dref = box('dref', u32(0, 1), box('url ', u32(1)));
  const dinf = box('dinf', dref);
  // A minimal AAC-LC 44.1 kHz stereo decoder configuration.
  const esdsPayload = Buffer.from([
    0x03, 0x19, 0x00, 0x00, 0x00, 0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x05, 0x02, 0x12, 0x10, 0x06, 0x01, 0x02,
  ]);
  const esds = box('esds', u32(0), esdsPayload);
  const mp4a = box(
    'mp4a',
    Buffer.alloc(6),
    u16(1, 0, 0),
    u32(0),
    u16(2, 16, 0, 0),
    u32(audioRate << 16),
    esds,
  );
  const stsd = box('stsd', u32(0, 1), mp4a);
  const stbl = box(
    'stbl',
    stsd,
    box('stts', u32(0, 0)),
    box('stsc', u32(0, 0)),
    box('stsz', u32(0, 0, 0)),
    box('stco', u32(0, 0)),
  );
  const minf = box('minf', smhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const moov = box('moov', mvhd, trak);
  const mdat = box('mdat');
  return Buffer.concat([ftyp, moov, mdat]);
}

/* -------------------------------------------------------------- text ------ */

const NOOP_JS = '(function () {})();\n';
const NOOP_TXT = '';
const NOOP_CSS = '';
const NOOP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>iuBlocker</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
    </style>
  </head>
  <body></body>
</html>
`;

const CLICK2LOAD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blocked content</title>
    <style>
      :root {
        color-scheme: light dark;
        --fg: #111;
        --bg: #f4f4f5;
        --muted: #52525b;
        --accent: #2563eb;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --fg: #f4f4f5;
          --bg: #18181b;
          --muted: #a1a1aa;
          --accent: #60a5fa;
        }
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
        color: var(--fg);
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 1.25rem;
        text-align: center;
      }
      h1 {
        font-size: 1rem;
        margin: 0 0 0.5rem;
      }
      p {
        margin: 0 0 0.75rem;
        color: var(--muted);
        overflow-wrap: anywhere;
      }
      button {
        font: inherit;
        padding: 0.4rem 0.9rem;
        border: 1px solid var(--accent);
        border-radius: 0.375rem;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 2px solid var(--fg);
        outline-offset: 2px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>This frame was blocked by iuBlocker</h1>
      <p id="url"></p>
      <button id="load" type="button">Load original content</button>
    </main>
    <script src="click2load.js"></script>
  </body>
</html>
`;

// Kept in its own file: extension pages run under \`script-src 'self'\`.
const CLICK2LOAD_JS = `/* eslint-disable */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var target = params.get('url') || '';
  var label = document.getElementById('url');
  var button = document.getElementById('load');
  if (label !== null) label.textContent = target === '' ? 'Unknown source' : target;
  if (button === null) return;
  if (target === '' || /^(https?|ftp):/i.test(target) === false) {
    button.disabled = true;
    return;
  }
  button.addEventListener('click', function () {
    location.replace(target);
  });
})();
`;

/* ------------------------------------------------------------------ run --- */

function surrogateSource(name: string, source: string): string {
  return `/* eslint-disable */
/* iuBlocker surrogate for ${name}. Generated by packages/scriptlets/scripts/gen-resources.ts. */
(function () {
  try {
    (${source})();
  } catch (ex) {
    void ex;
  }
})();
`;
}

export function generateResources(dir: string = outDir): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, data: string | Buffer): void => {
    writeFileSync(join(dir, name), data);
    written.push(name);
  };

  write('noop.js', NOOP_JS);
  write('noop.txt', NOOP_TXT);
  write('noop.css', NOOP_CSS);
  write('noop.html', NOOP_HTML);
  write('empty', '');
  write('click2load.html', CLICK2LOAD_HTML);
  write('click2load.js', CLICK2LOAD_JS);

  // The canonical 43-byte fully transparent GIF89a.
  write('1x1.gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  write('2x2.png', transparentPng(2, 2));
  write('3x2.png', transparentPng(3, 2));
  write('32x32.png', transparentPng(32, 32));
  write('noop-0.1s.mp3', silentMp3(4));
  write('noop-1s.mp4', noopMp4(1));

  for (const def of Object.values(registry)) {
    if (def.redirectResource === undefined) continue;
    write(def.redirectResource, surrogateSource(def.name, serializeScriptletFn(def.fn, def.name)));
  }
  return written;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-resources.ts');
if (invokedDirectly) {
  const written = generateResources();
  console.info(`scriptlets: wrote ${written.length} files to ${outDir}`);
}
