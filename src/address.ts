import { base58CheckDecode } from './encoding/base58.ts';
import { bech32Decode } from './encoding/bech32.ts';
import { f4jumbleInverse } from './encoding/f4jumble.ts';
import { ZIP321Error } from './errors.ts';

export type Network = 'main' | 'test' | 'regtest';
export type AddressKind = 'p2pkh' | 'p2sh' | 'sapling' | 'unified' | 'tex';
export type ReceiverKind = 'p2pkh' | 'p2sh' | 'sapling' | 'orchard' | 'unknown';

/** One receiver inside a Unified Address. Ironwood payments use Orchard-format (typecode 3) receivers. */
export interface Receiver {
  kind: ReceiverKind;
  typecode: number;
  data: Uint8Array;
}

export interface DecodedAddress {
  kind: AddressKind;
  /**
   * Networks this address is valid on. Transparent Base58 addresses share one prefix on
   * testnet and regtest, so they report both.
   */
  networks: readonly Network[];
  /** Receivers, in encoding order. Only present for Unified Addresses. */
  receivers?: readonly Receiver[];
  /** Whether a memo can be delivered (the address has a Sapling or Orchard receiver). */
  canReceiveMemo: boolean;
  /** Whether payments would go to a transparent output (no Sapling or Orchard receiver). */
  transparentOnly: boolean;
}

const BASE58_PREFIXES: Record<string, { kind: 'p2pkh' | 'p2sh' | 'sprout'; networks: Network[] }> = {
  '1cb8': { kind: 'p2pkh', networks: ['main'] },
  '1cbd': { kind: 'p2sh', networks: ['main'] },
  '169a': { kind: 'sprout', networks: ['main'] },
  '1d25': { kind: 'p2pkh', networks: ['test', 'regtest'] },
  '1cba': { kind: 'p2sh', networks: ['test', 'regtest'] },
  '16b6': { kind: 'sprout', networks: ['test', 'regtest'] },
};

const HRPS: Record<string, { kind: 'sapling' | 'unified' | 'tex'; network: Network }> = {
  zs: { kind: 'sapling', network: 'main' },
  ztestsapling: { kind: 'sapling', network: 'test' },
  zregtestsapling: { kind: 'sapling', network: 'regtest' },
  u: { kind: 'unified', network: 'main' },
  utest: { kind: 'unified', network: 'test' },
  uregtest: { kind: 'unified', network: 'regtest' },
  tex: { kind: 'tex', network: 'main' },
  textest: { kind: 'tex', network: 'test' },
  texregtest: { kind: 'tex', network: 'regtest' },
};

const RECEIVER_KINDS: ReceiverKind[] = ['p2pkh', 'p2sh', 'sapling', 'orchard'];
const RECEIVER_SIZES = [20, 20, 43, 43];
const MAX_COMPACT_SIZE = 0x0200_0000;

const invalid = (address: string, why: string) =>
  new ZIP321Error('INVALID_ADDRESS', `Invalid Zcash address ${address}: ${why}`);

/**
 * Decodes and validates a Zcash payment address: checksum, encoding, network, and for Unified
 * Addresses the full ZIP 316 structure (F4Jumble, padding, receiver ordering and sizes).
 * Throws `ZIP321Error` with code `INVALID_ADDRESS` (or `UNSUPPORTED_ADDRESS` for Sprout).
 */
export function decodeAddress(address: string): DecodedAddress {
  const bech = bech32Decode(address);
  if (bech) {
    const known = HRPS[bech.hrp];
    if (!known) throw invalid(address, `unknown prefix "${bech.hrp}"`);
    const expected = known.kind === 'sapling' ? 'bech32' : 'bech32m';
    if (bech.variant !== expected) throw invalid(address, `${known.kind} addresses use ${expected}`);
    const networks = [known.network];
    if (known.kind === 'sapling') {
      if (bech.data.length !== 43) throw invalid(address, 'a Sapling address is 43 bytes');
      return { kind: 'sapling', networks, canReceiveMemo: true, transparentOnly: false };
    }
    if (known.kind === 'tex') {
      if (bech.data.length !== 20) throw invalid(address, 'a TEX address is 20 bytes');
      return { kind: 'tex', networks, canReceiveMemo: false, transparentOnly: true };
    }
    const receivers = decodeUnified(address, bech.hrp, bech.data);
    const shielded = receivers.some((r) => r.kind === 'sapling' || r.kind === 'orchard');
    const transparent = receivers.some((r) => r.kind === 'p2pkh' || r.kind === 'p2sh');
    return {
      kind: 'unified',
      networks,
      receivers,
      canReceiveMemo: shielded,
      transparentOnly: transparent && !shielded,
    };
  }

  const payload = base58CheckDecode(address);
  if (payload && payload.length >= 2) {
    const prefix = Array.from(payload.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('');
    const known = BASE58_PREFIXES[prefix];
    if (!known) throw invalid(address, 'unknown Base58Check prefix');
    if (known.kind === 'sprout') {
      throw new ZIP321Error('UNSUPPORTED_ADDRESS', `Sprout addresses are not supported in payment requests: ${address}`);
    }
    if (payload.length !== 22) throw invalid(address, 'a transparent address is 20 bytes');
    return { kind: known.kind, networks: known.networks, canReceiveMemo: false, transparentOnly: true };
  }

  throw invalid(address, 'not valid Bech32, Bech32m or Base58Check');
}

function decodeUnified(address: string, hrp: string, jumbled: Uint8Array): Receiver[] {
  if (jumbled.length < 48) throw invalid(address, 'too short for a Unified Address');
  const raw = f4jumbleInverse(jumbled);

  const padding = new Uint8Array(16);
  padding.set(new TextEncoder().encode(hrp));
  const tail = raw.subarray(raw.length - 16);
  if (!tail.every((b, i) => b === padding[i])) throw invalid(address, 'invalid padding');

  const body = raw.subarray(0, raw.length - 16);
  const receivers: Receiver[] = [];
  let pos = 0;
  // Zcash CompactSize: canonical encodings only, at most 0x02000000.
  const readCompactSize = (): number => {
    const flag = body[pos++];
    if (flag === undefined) throw invalid(address, 'truncated');
    if (flag < 253) return flag;
    if (flag === 255) throw invalid(address, 'CompactSize too large');
    const width = flag === 253 ? 2 : 4;
    if (pos + width > body.length) throw invalid(address, 'truncated');
    let value = 0;
    for (let i = width - 1; i >= 0; i--) value = value * 256 + body[pos + i]!;
    pos += width;
    if (value < (width === 2 ? 253 : 0x1_0000)) throw invalid(address, 'non-canonical CompactSize');
    if (value > MAX_COMPACT_SIZE) throw invalid(address, 'CompactSize too large');
    return value;
  };

  while (pos < body.length) {
    const typecode = readCompactSize();
    const length = readCompactSize();
    if (pos + length > body.length) throw invalid(address, 'truncated receiver');
    const data = body.slice(pos, pos + length);
    pos += length;
    const kind = RECEIVER_KINDS[typecode] ?? 'unknown';
    const size = RECEIVER_SIZES[typecode];
    if (size !== undefined && length !== size) throw invalid(address, `${kind} receiver must be ${size} bytes`);
    receivers.push({ kind, typecode, data });
  }

  let previous = -1;
  for (const r of receivers) {
    if (r.typecode === previous) throw invalid(address, `duplicate typecode ${r.typecode}`);
    if (r.typecode < previous) throw invalid(address, 'receivers out of order');
    if (r.typecode === 1 && previous === 0) throw invalid(address, 'contains both P2PKH and P2SH');
    previous = r.typecode;
  }
  // Unknown typecodes count as non-transparent, as in zcash_address.
  if (receivers.every((r) => r.kind === 'p2pkh' || r.kind === 'p2sh')) {
    throw invalid(address, 'a Unified Address needs a non-transparent receiver');
  }
  return receivers;
}
