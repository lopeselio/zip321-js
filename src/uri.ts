import { decodeAddress, type DecodedAddress, type Network } from './address.ts';
import { formatZec, parseZec, toZatoshi, type Amount } from './amount.ts';
import { decodeAsset, encodeAsset, type AssetAmount } from './asset.ts';
import { base64urlDecode, base64urlEncode } from './encoding/base64url.ts';
import { ZIP321Error } from './errors.ts';
import { MAX_MEMO_BYTES, textMemo } from './memo.ts';

/** A payment as you pass it to `formatPaymentRequest`. */
export interface PaymentInput {
  address: string;
  /** ZEC amount in zatoshi. Mutually exclusive with `asset`. */
  amount?: Amount;
  /** Custom Asset amount (`req-asset`). Requires a Unified Address with an Orchard receiver. */
  asset?: AssetAmount;
  /** Raw memo bytes, or text (encoded as UTF-8). At most 512 bytes. */
  memo?: Uint8Array | string;
  label?: string;
  message?: string;
  /** Extra non-`req-` parameters. `null` writes the name without a value. */
  otherParams?: Record<string, string | null>;
}

/** A payment as `parsePaymentRequest` returns it. */
export interface Payment {
  /** The `paramindex` it was given (0 for none). */
  index: number;
  address: string;
  /** Present when address validation is on. */
  addressInfo?: DecodedAddress;
  amount?: bigint;
  asset?: AssetAmount;
  memo?: Uint8Array;
  label?: string;
  message?: string;
  /** Unrecognized non-`req-` parameters, which ZIP-321 says to ignore. Kept for round-tripping. */
  otherParams: Record<string, string | null>;
}

export interface PaymentRequest {
  /** Payments in `paramindex` order. Always at least one. */
  payments: Payment[];
  /** The network, when `options.network` was given or the addresses pin it down. */
  network?: Network;
}

export interface ZIP321Options {
  /** Reject addresses that are not for this network. */
  network?: Network;
  /**
   * Decode and checksum every address (default `true`). With `false`, any alphanumeric
   * address is accepted and transparent addresses are recognized by prefix only.
   */
  validateAddresses?: boolean;
}

const SCHEME = /^zcash:/i;
const ADDRESS = /^[A-Za-z0-9]+$/;
const PARAM_NAME = /^([A-Za-z][A-Za-z0-9+-]*)(?:\.([1-9][0-9]{0,3}))?$/;
const QCHARS = /^(?:[A-Za-z0-9\-._~!$'()*+,;:@]|%[0-9A-Fa-f]{2})*$/;
const KNOWN = new Set(['address', 'amount', 'memo', 'label', 'message', 'req-asset']);
const ALL_NETWORKS: readonly Network[] = ['main', 'test', 'regtest'];

interface RawParam {
  name: string;
  key: string; // name as written, with index: used in errors
  value: string | null;
}

/**
 * Parses and validates a ZIP-321 payment request URI.
 * Throws `ZIP321Error` for anything the ZIP says MUST NOT be accepted.
 */
export function parsePaymentRequest(uri: string, options: ZIP321Options = {}): PaymentRequest {
  if (!SCHEME.test(uri)) throw new ZIP321Error('INVALID_URI', 'A payment request URI starts with "zcash:"');
  const rest = uri.slice(6);
  const q = rest.indexOf('?');
  const leadAddress = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? undefined : rest.slice(q + 1);
  if (leadAddress === '' && query === undefined) throw new ZIP321Error('INVALID_URI', 'Missing address or parameters');
  if (leadAddress !== '' && !ADDRESS.test(leadAddress)) {
    throw new ZIP321Error('INVALID_URI', `Invalid address part "${leadAddress}" (only letters and digits are allowed)`);
  }

  const groups = new Map<number, Map<string, RawParam>>();
  const add = (index: number, param: RawParam) => {
    let group = groups.get(index);
    if (!group) groups.set(index, (group = new Map()));
    if (group.has(param.name)) throw new ZIP321Error('DUPLICATE_PARAM', `Duplicate parameter ${param.key}`, param.key);
    group.set(param.name, param);
  };
  if (leadAddress) add(0, { name: 'address', key: 'address', value: leadAddress });

  for (const part of query?.split('&') ?? []) {
    if (part === '') continue; // the grammar allows empty parameters
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? null : part.slice(eq + 1);
    const match = PARAM_NAME.exec(key);
    if (!match) throw new ZIP321Error('INVALID_PARAM', `Invalid parameter name "${key}"`, key);
    const lower = match[1]!.toLowerCase(); // ABNF literals are case-insensitive
    const name = KNOWN.has(lower) ? lower : match[1]!;
    if (lower.startsWith('req-') && !KNOWN.has(lower)) {
      throw new ZIP321Error('UNSUPPORTED_REQUIRED_PARAM', `Unsupported required parameter ${key}`, key);
    }
    add(match[2] ? Number(match[2]) : 0, { name, key, value });
  }

  const payments = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, params]) => buildPayment(index, params, options.validateAddresses !== false));
  if (payments.length === 0) throw new ZIP321Error('NO_PAYMENTS', 'The request contains no payments');

  const network = checkNetworks(payments, options);
  for (const p of payments) checkPayment(p, options.validateAddresses !== false);
  return network ? { payments, network } : { payments };
}

function buildPayment(index: number, params: Map<string, RawParam>, validate: boolean): Payment {
  const address = params.get('address');
  if (!address) {
    const key = params.values().next().value!.key;
    throw new ZIP321Error('MISSING_ADDRESS', `Parameter ${key} has no matching address${index ? `.${index}` : ''}`, key);
  }
  const payment: Payment = { index, address: '', otherParams: {} };
  for (const { name, key, value } of params.values()) {
    if (value === null && name !== 'address' && KNOWN.has(name)) {
      throw new ZIP321Error('INVALID_PARAM', `${key} needs a value`, key);
    }
    switch (name) {
      case 'address':
        if (value === null || !ADDRESS.test(value)) throw new ZIP321Error('INVALID_PARAM', `Invalid address in ${key}`, key);
        payment.address = value;
        if (validate) payment.addressInfo = decodeAddress(value);
        break;
      case 'amount':
        payment.amount = parseZec(value!, key);
        break;
      case 'memo': {
        const memo = base64urlDecode(value!);
        if (!memo) throw new ZIP321Error('INVALID_MEMO', `${key} is not unpadded base64url`, key);
        if (memo.length > MAX_MEMO_BYTES) {
          throw new ZIP321Error('INVALID_MEMO', `${key} is ${memo.length} bytes; the limit is ${MAX_MEMO_BYTES}`, key);
        }
        payment.memo = memo;
        break;
      }
      case 'req-asset':
        payment.asset = decodeAsset(value!, key);
        break;
      case 'label':
        payment.label = percentDecode(value!, key);
        break;
      case 'message':
        payment.message = percentDecode(value!, key);
        break;
      default:
        payment.otherParams[name] = value === null ? null : percentDecode(value, key);
    }
  }
  return payment;
}

function checkNetworks(payments: Payment[], options: ZIP321Options): Network | undefined {
  if (options.validateAddresses === false) return options.network;
  let possible = options.network ? [options.network] : ALL_NETWORKS;
  for (const p of payments) {
    const networks = p.addressInfo!.networks;
    if (options.network && !networks.includes(options.network)) {
      throw new ZIP321Error('WRONG_NETWORK', `${p.address} is not a ${options.network} address`, paramKey('address', p.index));
    }
    possible = possible.filter((n) => networks.includes(n));
    if (possible.length === 0) {
      throw new ZIP321Error('WRONG_NETWORK', 'The addresses in this request are for different networks', paramKey('address', p.index));
    }
  }
  return possible.length === 1 ? possible[0] : undefined;
}

function checkPayment(p: Payment, validated: boolean) {
  const info = p.addressInfo;
  // Without decoding, recognize transparent and TEX addresses by prefix.
  const transparentOnly = info ? info.transparentOnly : /^(t[1-3m]|tex)/i.test(p.address);
  if (p.memo && (info ? !info.canReceiveMemo : transparentOnly)) {
    throw new ZIP321Error('MEMO_NOT_ALLOWED', `${p.address} cannot receive a memo`, paramKey('memo', p.index));
  }
  if (p.amount === 0n && transparentOnly) {
    throw new ZIP321Error('ZERO_TRANSPARENT_AMOUNT', 'A transparent output cannot have a zero value', paramKey('amount', p.index));
  }
  if (p.asset) {
    if (p.amount !== undefined) {
      throw new ZIP321Error('AMOUNT_AND_ASSET', 'amount and req-asset cannot both be set', paramKey('req-asset', p.index));
    }
    const orchard = validated
      ? info!.receivers?.some((r) => r.kind === 'orchard')
      : /^u(test|regtest)?1/i.test(p.address);
    if (!orchard) {
      throw new ZIP321Error('INVALID_ASSET', 'Custom Asset payments need a Unified Address with an Orchard receiver', paramKey('req-asset', p.index));
    }
  }
}

/**
 * Builds a ZIP-321 payment request URI. A single payment puts its address in the URI path;
 * several payments are numbered `address`, `address.1`, `address.2`, … in order.
 * The result is re-parsed, so anything `parsePaymentRequest` would reject throws here.
 */
export function formatPaymentRequest(
  request: readonly PaymentInput[] | { payments: readonly PaymentInput[] },
  options: ZIP321Options = {},
): string {
  const payments = 'payments' in request ? request.payments : request;
  if (payments.length === 0) throw new ZIP321Error('NO_PAYMENTS', 'A payment request needs at least one payment');
  if (payments.length > 10_000) throw new ZIP321Error('INVALID_PARAM', 'At most 10,000 payments fit the paramindex range');

  const parts: string[] = [];
  let lead = '';
  payments.forEach((p, i) => {
    const index = i === 0 ? '' : `.${i}`;
    if (!ADDRESS.test(p.address ?? '')) {
      throw new ZIP321Error('INVALID_PARAM', `Invalid address "${p.address}"`, `address${index}`);
    }
    if (payments.length === 1) lead = p.address;
    else parts.push(`address${index}=${p.address}`);
    if (p.amount !== undefined) parts.push(`amount${index}=${formatZec(toZatoshi(p.amount, `amount${index}`))}`);
    if (p.asset !== undefined) parts.push(`req-asset${index}=${encodeAsset(p.asset, `req-asset${index}`)}`);
    if (p.memo !== undefined) {
      const memo = typeof p.memo === 'string' ? textMemo(p.memo) : p.memo;
      if (memo.length > MAX_MEMO_BYTES) {
        throw new ZIP321Error('INVALID_MEMO', `Memo is ${memo.length} bytes; the limit is ${MAX_MEMO_BYTES}`, `memo${index}`);
      }
      parts.push(`memo${index}=${base64urlEncode(memo)}`);
    }
    if (p.label !== undefined) parts.push(`label${index}=${percentEncode(p.label)}`);
    if (p.message !== undefined) parts.push(`message${index}=${percentEncode(p.message)}`);
    for (const [name, value] of Object.entries(p.otherParams ?? {})) {
      const lower = name.toLowerCase();
      if (!/^[A-Za-z][A-Za-z0-9+-]*$/.test(name) || KNOWN.has(lower) || lower.startsWith('req-')) {
        throw new ZIP321Error('INVALID_PARAM', `"${name}" cannot be used as an extra parameter`, name);
      }
      parts.push(value === null ? `${name}${index}` : `${name}${index}=${percentEncode(value)}`);
    }
  });

  const uri = `zcash:${lead}${parts.length ? `?${parts.join('&')}` : ''}`;
  parsePaymentRequest(uri, options);
  return uri;
}

const paramKey = (name: string, index: number) => (index ? `${name}.${index}` : name);

// Characters left as-is in label, message and other values: qchar minus `%`, and minus `+`,
// which some decoders read as a space.
const SAFE = /[A-Za-z0-9\-._~!$'()*,;:@]/;

function percentEncode(text: string): string {
  let out = '';
  for (const char of text) {
    if (SAFE.test(char)) {
      out += char;
      continue;
    }
    for (const byte of new TextEncoder().encode(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Decodes a `*qchar` value (label, message, other parameters). */
function percentDecode(value: string, key: string): string {
  if (!QCHARS.test(value)) throw new ZIP321Error('INVALID_PARAM', `Invalid characters in the value of ${key}`, key);
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '%') {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(value.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new ZIP321Error('INVALID_PARAM', `${key} is not valid UTF-8 after percent-decoding`, key);
  }
}
