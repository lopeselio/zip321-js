import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAddress } from '../src/address.ts';
import { bech32Encode } from '../src/encoding/bech32.ts';
import { f4jumble } from '../src/encoding/f4jumble.ts';
import { ZIP321Error } from '../src/errors.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ua = JSON.parse(readFileSync(new URL('./fixtures/unified-addresses.json', import.meta.url), 'utf8')) as {
  vectors: {
    p2pkh_bytes: string | null;
    p2sh_bytes: string | null;
    sapling_raw_addr: string | null;
    orchard_raw_addr: string | null;
    unknown_typecode: number | null;
    unknown_bytes: string | null;
    unified_addr: string;
  }[];
};

const code = (c: string) => (err: unknown) => err instanceof ZIP321Error && err.code === c;

/** Encodes raw (typecode, bytes) items as a Unified Address, bypassing validity rules. */
function encodeUnified(hrp: string, items: [number, Uint8Array][], padding?: Uint8Array): string {
  const parts: number[] = [];
  for (const [typecode, data] of items) parts.push(typecode, data.length, ...data);
  const pad = padding ?? new Uint8Array(16);
  if (!padding) pad.set(new TextEncoder().encode(hrp));
  return bech32Encode(hrp, f4jumble(Uint8Array.from([...parts, ...pad])), 'bech32m');
}
const sapling = new Uint8Array(43).fill(2);
const orchard = new Uint8Array(43).fill(3);
const p2pkh = new Uint8Array(20).fill(1);

test('decodes all 60 zcash-test-vectors Unified Addresses to their receivers', () => {
  assert.equal(ua.vectors.length, 60);
  for (const v of ua.vectors) {
    const decoded = decodeAddress(v.unified_addr);
    assert.equal(decoded.kind, 'unified');
    assert.deepEqual(decoded.networks, ['main']);
    const expected: [string, number, string][] = [];
    if (v.p2pkh_bytes) expected.push(['p2pkh', 0, v.p2pkh_bytes]);
    if (v.p2sh_bytes) expected.push(['p2sh', 1, v.p2sh_bytes]);
    if (v.sapling_raw_addr) expected.push(['sapling', 2, v.sapling_raw_addr]);
    if (v.orchard_raw_addr) expected.push(['orchard', 3, v.orchard_raw_addr]);
    if (v.unknown_typecode !== null) expected.push(['unknown', v.unknown_typecode, v.unknown_bytes!]);
    expected.sort((a, b) => a[1] - b[1]);
    assert.deepEqual(
      decoded.receivers!.map((r) => [r.kind, r.typecode, hex(r.data)]),
      expected,
      v.unified_addr,
    );
    assert.equal(decoded.canReceiveMemo, true);
    assert.equal(decoded.transparentOnly, false);
  }
});

test('decodes testnet and regtest Unified Addresses', () => {
  assert.deepEqual(
    decodeAddress('utest10c5kutapazdnf8ztl3pu43nkfsjx89fy3uuff8tsmxm6s86j37pe7uz94z5jhkl49pqe8yz75rlsaygexk6jpaxwx0esjr8wm5ut7d5s').networks,
    ['test'],
  );
  assert.deepEqual(
    decodeAddress('uregtest15xk7vj4grjkay6mnfl93dhsflc2yeunhxwdh38rul0rq3dfhzzxgm5szjuvtqdha4t4p2q02ks0jgzrhjkrav70z9xlvq0plpcjkd5z3').networks,
    ['regtest'],
  );
});

test('decodes transparent, Sapling and TEX addresses with their networks', () => {
  const cases: [string, string, string[], boolean][] = [
    ['t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs', 'p2pkh', ['main'], false],
    ['t3JZcvsuaXE6ygokL4XUiZSTrQBUoPYFnXJ', 'p2sh', ['main'], false],
    ['tm9iMLAuYMzJ6jtFLcA7rzUmfreGuKvr7Ma', 'p2pkh', ['test', 'regtest'], false],
    ['t26YoyZ1iPgiMEWL4zGUm74eVWfhyDMXzY2', 'p2sh', ['test', 'regtest'], false],
    ['zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpq6d8g', 'sapling', ['main'], true],
    ['ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez', 'sapling', ['test'], true],
    ['zregtestsapling1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqknpr3m', 'sapling', ['regtest'], true],
    ['tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte', 'tex', ['main'], false],
    ['textest1qyqszqgpqyqszqgpqyqszqgpqyqszqgpfcjgfy', 'tex', ['test'], false],
  ];
  for (const [address, kind, networks, memo] of cases) {
    const decoded = decodeAddress(address);
    assert.equal(decoded.kind, kind, address);
    assert.deepEqual(decoded.networks, networks, address);
    assert.equal(decoded.canReceiveMemo, memo, address);
    assert.equal(decoded.transparentOnly, !memo, address);
  }
});

test('rejects Sprout addresses as unsupported', () => {
  for (const sprout of [
    'zc8E5gYid86n4bo2Usdq1cpr7PpfoJGzttwBHEEgGhGkLUg7SPPVFNB2AkRFXZ7usfphup5426dt1buMmY3fkYeRrQGLa8y',
    'ztJ1EWLKcGwF2S4NA17pAJVdco8Sdkz4AQPxt1cLTEfNuyNswJJc2BbBqYrsRZsp31xbVZwhF7c7a2L9jsF3p3ZwRWpqqyS',
  ]) {
    assert.throws(() => decodeAddress(sprout), code('UNSUPPORTED_ADDRESS'));
  }
});

test('rejects typos, unknown prefixes and the wrong checksum variant', () => {
  const bad = [
    't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbt', // checksum
    'ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kex', // checksum
    bech32Encode('zs', new Uint8Array(43), 'bech32m'), // Sapling must be bech32
    bech32Encode('tex', new Uint8Array(20), 'bech32'), // TEX must be bech32m
    bech32Encode('bc', new Uint8Array(20), 'bech32'), // not Zcash
    bech32Encode('zs', new Uint8Array(42), 'bech32'), // wrong length
    'utest1qpsw0d7s6e5t7dv8x8yyw5e4v4jh8p5kux6g5v4kthh0nngwh2c5ue2x8p3wxy7qsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7egr7p', // ZIP-321 placeholder
    'hello',
  ];
  for (const address of bad) assert.throws(() => decodeAddress(address), code('INVALID_ADDRESS'), address);
});

test('validates Unified Address structure per ZIP 316', () => {
  // Sanity: the helper produces a valid address.
  assert.deepEqual(
    decodeAddress(encodeUnified('u', [[0, p2pkh], [2, sapling], [3, orchard]])).receivers!.map((r) => r.kind),
    ['p2pkh', 'sapling', 'orchard'],
  );
  const bad: [string, [number, Uint8Array][], Uint8Array?][] = [
    ['out of order', [[3, orchard], [2, sapling]]],
    ['duplicate typecode', [[2, sapling], [2, sapling]]],
    ['P2PKH and P2SH', [[0, p2pkh], [1, p2pkh], [2, sapling]]],
    ['wrong receiver size', [[2, new Uint8Array(42)], [3, orchard]]],
    ['bad padding', [[2, sapling]], new Uint8Array(16)],
  ];
  for (const [why, items, padding] of bad) {
    assert.throws(() => decodeAddress(encodeUnified('u', items, padding)), code('INVALID_ADDRESS'), why);
  }
  // A lone transparent receiver is shorter than F4Jumble's 48-byte minimum.
  assert.throws(() => decodeAddress(bech32Encode('u', new Uint8Array(38), 'bech32m')), code('INVALID_ADDRESS'));
  // A Unified Address must be Bech32m.
  const raw = Uint8Array.from([2, 43, ...sapling, ...new TextEncoder().encode('u'), ...new Uint8Array(15)]);
  assert.throws(() => decodeAddress(bech32Encode('u', f4jumble(raw), 'bech32')), code('INVALID_ADDRESS'));
});

test('allows unknown receiver typecodes alongside a transparent one', () => {
  const decoded = decodeAddress(encodeUnified('uregtest', [[0, p2pkh], [5, new Uint8Array(10)]]));
  assert.deepEqual(decoded.receivers!.map((r) => [r.kind, r.typecode]), [['p2pkh', 0], ['unknown', 5]]);
  assert.equal(decoded.canReceiveMemo, false);
  assert.equal(decoded.transparentOnly, true);
});
