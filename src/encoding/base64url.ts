// Unpadded base64url (RFC 4648 §5). Decoding is strict: no `+`, `/` or `=`, and the unused
// bits of the final character must be zero, matching the reference Rust implementation.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/** Returns the decoded bytes, or `undefined` if `text` is not canonical unpadded base64url. */
export function base64urlDecode(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of text) {
    const v = INDEX.get(c);
    if (v === undefined) return undefined;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) return undefined; // non-canonical trailing bits
  return out;
}
