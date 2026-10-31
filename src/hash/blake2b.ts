// BLAKE2b (RFC 7693) with an output length and 16-byte personalization, as F4Jumble needs.
// 64-bit words are held as (low, high) pairs of 32-bit integers.

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
].flatMap((row) => row.map((i) => i * 2));

/** v[a] += v[b] (64-bit). */
function add(v: Uint32Array, a: number, b: number) {
  const lo = v[a]! + v[b]!;
  v[a + 1] = v[a + 1]! + v[b + 1]! + (lo >= 0x1_0000_0000 ? 1 : 0);
  v[a] = lo;
}

/** v[a] += (lo, hi) (64-bit). */
function addWord(v: Uint32Array, a: number, lo: number, hi: number) {
  const sum = v[a]! + lo;
  v[a + 1] = v[a + 1]! + hi + (sum >= 0x1_0000_0000 ? 1 : 0);
  v[a] = sum;
}

function mix(v: Uint32Array, m: Uint32Array, a: number, b: number, c: number, d: number, x: number, y: number) {
  add(v, a, b);
  addWord(v, a, m[x]!, m[x + 1]!);
  let lo = v[d]! ^ v[a]!;
  let hi = v[d + 1]! ^ v[a + 1]!;
  v[d] = hi; // rotr 32
  v[d + 1] = lo;
  add(v, c, d);
  lo = v[b]! ^ v[c]!;
  hi = v[b + 1]! ^ v[c + 1]!;
  v[b] = (lo >>> 24) ^ (hi << 8); // rotr 24
  v[b + 1] = (hi >>> 24) ^ (lo << 8);
  add(v, a, b);
  addWord(v, a, m[y]!, m[y + 1]!);
  lo = v[d]! ^ v[a]!;
  hi = v[d + 1]! ^ v[a + 1]!;
  v[d] = (lo >>> 16) ^ (hi << 16); // rotr 16
  v[d + 1] = (hi >>> 16) ^ (lo << 16);
  add(v, c, d);
  lo = v[b]! ^ v[c]!;
  hi = v[b + 1]! ^ v[c + 1]!;
  v[b] = (hi >>> 31) ^ (lo << 1); // rotr 63
  v[b + 1] = (lo >>> 31) ^ (hi << 1);
}

function compress(h: Uint32Array, block: Uint8Array, counter: number, last: boolean) {
  const v = new Uint32Array(32);
  const m = new Uint32Array(32);
  const view = new DataView(block.buffer, block.byteOffset, 128);
  for (let i = 0; i < 32; i++) m[i] = view.getUint32(i * 4, true);
  v.set(h);
  v.set(IV, 16);
  v[24] = v[24]! ^ counter;
  v[25] = v[25]! ^ Math.floor(counter / 0x1_0000_0000);
  if (last) {
    v[28] = ~v[28]!;
    v[29] = ~v[29]!;
  }
  for (let round = 0; round < 12; round++) {
    const s = ((round % 10) * 16);
    mix(v, m, 0, 8, 16, 24, SIGMA[s]!, SIGMA[s + 1]!);
    mix(v, m, 2, 10, 18, 26, SIGMA[s + 2]!, SIGMA[s + 3]!);
    mix(v, m, 4, 12, 20, 28, SIGMA[s + 4]!, SIGMA[s + 5]!);
    mix(v, m, 6, 14, 22, 30, SIGMA[s + 6]!, SIGMA[s + 7]!);
    mix(v, m, 0, 10, 20, 30, SIGMA[s + 8]!, SIGMA[s + 9]!);
    mix(v, m, 2, 12, 22, 24, SIGMA[s + 10]!, SIGMA[s + 11]!);
    mix(v, m, 4, 14, 16, 26, SIGMA[s + 12]!, SIGMA[s + 13]!);
    mix(v, m, 6, 8, 18, 28, SIGMA[s + 14]!, SIGMA[s + 15]!);
  }
  for (let i = 0; i < 16; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 16]!;
}

/**
 * Unkeyed BLAKE2b with a 1-64 byte digest and an optional 16-byte personalization.
 */
export function blake2b(data: Uint8Array, outLength: number, personal?: Uint8Array): Uint8Array {
  if (!Number.isInteger(outLength) || outLength < 1 || outLength > 64) throw new RangeError('outLength must be 1-64');
  if (personal && personal.length !== 16) throw new RangeError('personal must be 16 bytes');

  const h = new Uint32Array(IV);
  h[0] = h[0]! ^ 0x01010000 ^ outLength; // depth 1, fanout 1, no key
  if (personal) {
    const p = new DataView(personal.buffer, personal.byteOffset, 16);
    for (let i = 0; i < 4; i++) h[12 + i] = h[12 + i]! ^ p.getUint32(i * 4, true);
  }

  let offset = 0;
  while (data.length - offset > 128) {
    compress(h, data.subarray(offset, offset + 128), offset + 128, false);
    offset += 128;
  }
  const last = new Uint8Array(128);
  last.set(data.subarray(offset));
  compress(h, last, data.length, true);

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setUint32(i * 4, h[i]!, true);
  return out.slice(0, outLength);
}
