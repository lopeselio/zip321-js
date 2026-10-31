// F4Jumble (ZIP 316): the unkeyed 4-round Feistel permutation applied to Unified Address bytes.
import { blake2b } from '../hash/blake2b.ts';

const MIN_LENGTH = 48;
const MAX_LENGTH = 4_194_368;
const OUT = 64;
const PREFIX = new TextEncoder().encode('UA_F4Jumble_');

function personal(kind: 'H' | 'G', i: number, j = 0): Uint8Array {
  const p = new Uint8Array(16);
  p.set(PREFIX);
  p[12] = kind.charCodeAt(0);
  p[13] = i;
  p[14] = j & 0xff;
  p[15] = j >> 8;
  return p;
}

function xorInto(target: Uint8Array, source: Uint8Array) {
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i++) target[i]! ^= source[i]!;
}

function rounds(message: Uint8Array, inverse: boolean): Uint8Array {
  if (message.length < MIN_LENGTH || message.length > MAX_LENGTH) {
    throw new RangeError(`F4Jumble input must be ${MIN_LENGTH}-${MAX_LENGTH} bytes`);
  }
  const out = Uint8Array.from(message);
  const leftLength = Math.min(OUT, Math.floor(out.length / 2));
  const left = out.subarray(0, leftLength);
  const right = out.subarray(leftLength);

  const h = (i: number) => xorInto(left, blake2b(right, leftLength, personal('H', i)));
  const g = (i: number) => {
    for (let j = 0; j * OUT < right.length; j++) {
      xorInto(right.subarray(j * OUT), blake2b(left, OUT, personal('G', i, j)));
    }
  };

  if (inverse) {
    h(1);
    g(1);
    h(0);
    g(0);
  } else {
    g(0);
    h(0);
    g(1);
    h(1);
  }
  return out;
}

export const f4jumble = (message: Uint8Array): Uint8Array => rounds(message, false);
export const f4jumbleInverse = (message: Uint8Array): Uint8Array => rounds(message, true);
