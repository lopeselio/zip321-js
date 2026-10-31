import { sha256 } from '../hash/sha256.ts';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Decodes Base58Check, returning the payload without its checksum, or `undefined` if invalid. */
export function base58CheckDecode(text: string): Uint8Array | undefined {
  if (text.length === 0) return undefined;
  const bytes: number[] = [];
  for (const char of text) {
    let carry = INDEX.get(char);
    if (carry === undefined) return undefined;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  const decoded = Uint8Array.from(bytes.reverse());
  if (decoded.length < 4) return undefined;
  const payload = decoded.subarray(0, -4);
  const checksum = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (checksum[i] !== decoded[decoded.length - 4 + i]) return undefined;
  return payload;
}

export function base58CheckEncode(payload: Uint8Array): string {
  const data = new Uint8Array(payload.length + 4);
  data.set(payload);
  data.set(sha256(sha256(payload)).subarray(0, 4), payload.length);
  const digits: number[] = [];
  for (const byte of data) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of data) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}
