import { ZIP321Error } from './errors.ts';

/** A shielded memo holds at most 512 bytes; shorter memos are zero-padded on chain. */
export const MAX_MEMO_BYTES = 512;

/** Encodes text as a UTF-8 memo (ZIP 302). Throws `INVALID_MEMO` above 512 bytes. */
export function textMemo(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_MEMO_BYTES) {
    throw new ZIP321Error('INVALID_MEMO', `Memo is ${bytes.length} bytes; the limit is ${MAX_MEMO_BYTES}`);
  }
  return bytes;
}

/**
 * Reads a memo as text if ZIP 302 says it is text: the first byte is at most 0xF4 and the
 * bytes, without trailing zero padding, are valid UTF-8. Returns `undefined` otherwise
 * (binary data, "no memo" 0xF6, or reserved formats).
 */
export function memoText(memo: Uint8Array): string | undefined {
  if (memo.length > 0 && memo[0]! > 0xf4) return undefined;
  let end = memo.length;
  while (end > 0 && memo[end - 1] === 0) end--;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(memo.subarray(0, end));
  } catch {
    return undefined;
  }
}
