import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZipWriter, crc32 } from '../lib/zip';

/** Read entries back out of an archive the way a real unzip does (central directory first). */
function readZip(buf: Buffer): { name: string; data: Buffer; method: number }[] {
  const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);
  const out: { name: string; data: Buffer; method: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(offset)).toBe(0x02014b50);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const payload = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);
    expect(data.length).toBe(uncompressedSize);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data, method });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('ZipWriter', () => {
  it('round-trips stored and deflated entries', () => {
    const zip = new ZipWriter();
    const compressible = Buffer.from('a'.repeat(5_000));
    zip.add('manifest.json', '{"name":"iuBlocker"}');
    zip.add('assets/big.txt', compressible);
    zip.add('empty.txt', '');
    const entries = readZip(zip.toBuffer());
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'assets/big.txt', 'empty.txt']);
    expect(entries[0]?.data.toString()).toBe('{"name":"iuBlocker"}');
    expect(entries[1]?.data).toEqual(compressible);
    expect(entries[1]?.method).toBe(8);
    expect(entries[2]?.data.length).toBe(0);
    expect(entries[2]?.method).toBe(0);
  });

  it('is reproducible and rejects duplicates', () => {
    const build = () => {
      const zip = new ZipWriter();
      zip.add('a.txt', 'one');
      zip.add('b/c.txt', 'two');
      return zip.toBuffer();
    };
    expect(build().equals(build())).toBe(true);

    const zip = new ZipWriter();
    zip.add('a.txt', 'one');
    expect(() => zip.add('a.txt', 'two')).toThrow(/duplicate/);
    expect(() => zip.add('', 'x')).toThrow(/empty entry name/);
  });

  it('normalises separators and matches a known CRC32', () => {
    const zip = new ZipWriter();
    zip.add('nested\\dir\\file.txt', 'hello');
    expect(readZip(zip.toBuffer())[0]?.name).toBe('nested/dir/file.txt');
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686);
  });
});
