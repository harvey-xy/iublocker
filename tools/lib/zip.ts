/**
 * Minimal, dependency-free ZIP writer (store + deflate) for `tools/package.ts`.
 *
 * Only the subset the Chrome Web Store needs: no zip64, no encryption, no data
 * descriptors. Entries are written in the order they are added and timestamps are fixed
 * by default so two builds of the same tree produce byte-identical archives.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01T00:00:00Z — the earliest timestamp DOS date fields can express. */
export const FIXED_MTIME = new Date(Date.UTC(1980, 0, 1));

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

interface Entry {
  name: string;
  data: Buffer;
  method: 0 | 8;
  crc: number;
  uncompressedSize: number;
  mtime: Date;
  offset: number;
}

export interface ZipOptions {
  /** Deflate level 0-9 (default 9). Level 0 forces stored entries. */
  level?: number;
  /** Timestamp for every entry (default FIXED_MTIME, for reproducible archives). */
  mtime?: Date;
}

export class ZipWriter {
  private readonly chunks: Buffer[] = [];
  private readonly entries: Entry[] = [];
  private offset = 0;
  private readonly level: number;
  private readonly mtime: Date;

  constructor(options: ZipOptions = {}) {
    this.level = options.level ?? 9;
    this.mtime = options.mtime ?? FIXED_MTIME;
  }

  get fileCount(): number {
    return this.entries.length;
  }

  /** Add a file. `name` uses forward slashes and must be relative. */
  add(name: string, content: Buffer | Uint8Array | string): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content as Uint8Array | string);
    const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.length === 0) throw new Error('zip: empty entry name');
    if (this.entries.some((e) => e.name === normalized)) throw new Error(`zip: duplicate entry ${normalized}`);

    const deflated = this.level > 0 && data.length > 0 ? deflateRawSync(data, { level: this.level }) : null;
    const useDeflate = deflated !== null && deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const entry: Entry = {
      name: normalized,
      data: payload,
      method: useDeflate ? 8 : 0,
      crc: crc32(data),
      uncompressedSize: data.length,
      mtime: this.mtime,
      offset: this.offset,
    };
    this.entries.push(entry);

    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.mtime);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    this.chunks.push(header, nameBuf, payload);
    this.offset += header.length + nameBuf.length + payload.length;
  }

  /** Finish the archive and return its bytes. */
  toBuffer(): Buffer {
    const central: Buffer[] = [];
    let centralSize = 0;
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const { time, date } = dosDateTime(entry.mtime);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x031e, 4); // made by: UNIX, zip 3.0
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(time, 12);
      header.writeUInt16LE(date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.data.length, 20);
      header.writeUInt32LE(entry.uncompressedSize, 24);
      header.writeUInt16LE(nameBuf.length, 28);
      header.writeUInt16LE(0, 30); // extra
      header.writeUInt16LE(0, 32); // comment
      header.writeUInt16LE(0, 34); // disk
      header.writeUInt16LE(0, 36); // internal attrs
      header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, 0644
      header.writeUInt32LE(entry.offset, 42);
      central.push(header, nameBuf);
      centralSize += header.length + nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(this.offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...this.chunks, ...central, eocd]);
  }
}
