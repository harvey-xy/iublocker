/**
 * FNV-1a (64-bit) over UTF-8 bytes, implemented with two 32-bit halves so the compiler
 * stays isomorphic (no `node:crypto`, no BigInt).
 */

const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
/** 0x00000100_000001b3 */
const PRIME_HI = 0x00000100;
const PRIME_LO = 0x000001b3;

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 64-bit FNV-1a digest as 16 lower-case hex digits. */
export function fnv1a64(text: string): string {
  let hi = OFFSET_HI;
  let lo = OFFSET_LO;
  for (const byte of toBytes(text)) {
    lo = (lo ^ byte) >>> 0;
    // (hi:lo) * (PRIME_HI:PRIME_LO), truncated to 64 bits.
    const l0 = lo & 0xffff;
    const l1 = lo >>> 16;
    const p0 = PRIME_LO & 0xffff;
    const p1 = PRIME_LO >>> 16;
    const t0 = l0 * p0;
    const t1 = l1 * p0 + (t0 >>> 16);
    const t2 = l0 * p1 + (t1 & 0xffff);
    const carry = l1 * p1 + (t1 >>> 16) + (t2 >>> 16);
    const nextLo = (((t2 & 0xffff) << 16) | (t0 & 0xffff)) >>> 0;
    const nextHi = (hi * PRIME_LO + lo * PRIME_HI + carry) >>> 0;
    hi = nextHi;
    lo = nextLo;
  }
  return hex32(hi) + hex32(lo);
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** Short digest used to name scriptlet group bundles. */
export function shortHash(text: string, length = 12): string {
  return fnv1a64(text).slice(0, length);
}
