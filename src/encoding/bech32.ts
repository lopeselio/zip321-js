// Bech32 (BIP 173) and Bech32m (BIP 350) without the 90-character limit, which Zcash
// lifts: regtest Sapling addresses are 91 characters and Unified Addresses are longer still
// (ZIP 173, ZIP 316).

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const INDEX = new Map([...CHARSET].map((c, i) => [c, i]));
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export type Bech32Variant = 'bech32' | 'bech32m';
const CONSTANT: Record<Bech32Variant, number> = { bech32: 1, bech32m: 0x2bc830a3 };

function polymod(values: Iterable<number>): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
  }
  return chk >>> 0;
}

function* hrpExpand(hrp: string): Generator<number> {
  for (const c of hrp) yield c.charCodeAt(0) >> 5;
  yield 0;
  for (const c of hrp) yield c.charCodeAt(0) & 31;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | undefined {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | data[i]!;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || acc !== 0) {
    return undefined; // more than a symbol of padding, or nonzero padding bits
  }
  return out;
}

export interface Bech32Decoded {
  hrp: string;
  variant: Bech32Variant;
  data: Uint8Array;
}

/** Decodes a Bech32 or Bech32m string to its lowercase HRP and 8-bit payload, or `undefined`. */
export function bech32Decode(text: string): Bech32Decoded | undefined {
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return undefined; // mixed case
  const sep = lower.lastIndexOf('1');
  if (sep < 1 || lower.length - sep - 1 < 6) return undefined;
  const hrp = lower.slice(0, sep);
  for (const c of hrp) {
    const code = c.charCodeAt(0);
    if (code < 33 || code > 126) return undefined;
  }
  const values: number[] = [];
  for (const c of lower.slice(sep + 1)) {
    const v = INDEX.get(c);
    if (v === undefined) return undefined;
    values.push(v);
  }
  const residue = polymod([...hrpExpand(hrp), ...values]);
  const variant = residue === CONSTANT.bech32 ? 'bech32' : residue === CONSTANT.bech32m ? 'bech32m' : undefined;
  if (!variant) return undefined;
  const data = convertBits(values.slice(0, -6), 5, 8, false);
  if (!data) return undefined;
  return { hrp, variant, data: Uint8Array.from(data) };
}

export function bech32Encode(hrp: string, data: Uint8Array, variant: Bech32Variant): string {
  const values = convertBits(data, 8, 5, true)!;
  const mod = polymod([...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0]) ^ CONSTANT[variant];
  let out = `${hrp}1`;
  for (const v of values) out += CHARSET[v];
  for (let i = 0; i < 6; i++) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
  return out;
}
