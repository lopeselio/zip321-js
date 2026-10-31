import { ZIP321Error } from './errors.ts';

export const ZATOSHI_PER_ZEC = 100_000_000n;
/** 21,000,000 ZEC, the most any ZIP-321 amount may request. */
export const MAX_MONEY = 21_000_000n * ZATOSHI_PER_ZEC;

/** Zatoshi, as a `bigint` or a non-negative safe-integer `number`. */
export type Amount = bigint | number;

const DECIMAL = /^(\d+)(?:\.(\d{1,8}))?$/;

/**
 * Parses decimal ZEC exactly as ZIP-321 writes it (`1`, `0.5`, `050.00`) into zatoshi.
 * Rejects signs, exponents, separators, a bare `.`, more than 8 decimals, and amounts
 * above 21,000,000 ZEC.
 */
export function parseZec(text: string, param?: string): bigint {
  const match = DECIMAL.exec(text);
  if (!match) throw new ZIP321Error('INVALID_AMOUNT', `Invalid ZEC amount "${text}"`, param);
  const zatoshi = BigInt(match[1]!) * ZATOSHI_PER_ZEC + BigInt((match[2] ?? '').padEnd(8, '0'));
  if (zatoshi > MAX_MONEY) throw new ZIP321Error('INVALID_AMOUNT', `Amount ${text} exceeds 21,000,000 ZEC`, param);
  return zatoshi;
}

/** Normalizes and range-checks a zatoshi amount. */
export function toZatoshi(amount: Amount, param?: string): bigint {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new ZIP321Error('INVALID_AMOUNT', `Zatoshi amount must be an integer, got ${amount}`, param);
  }
  const zatoshi = BigInt(amount);
  if (zatoshi < 0n || zatoshi > MAX_MONEY) {
    throw new ZIP321Error('INVALID_AMOUNT', `Amount ${zatoshi} zatoshi is outside 0-21,000,000 ZEC`, param);
  }
  return zatoshi;
}

/** Formats zatoshi as the shortest decimal ZEC string (`150000000n` → `"1.5"`). */
export function formatZec(amount: Amount): string {
  const zatoshi = toZatoshi(amount);
  const whole = zatoshi / ZATOSHI_PER_ZEC;
  const fraction = (zatoshi % ZATOSHI_PER_ZEC).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
