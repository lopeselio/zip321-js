import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { base58CheckDecode, base58CheckEncode } from '../src/encoding/base58.ts';
import { bech32Decode, bech32Encode } from '../src/encoding/bech32.ts';
import { f4jumble, f4jumbleInverse } from '../src/encoding/f4jumble.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const f4 = JSON.parse(readFileSync(new URL('./fixtures/f4jumble.json', import.meta.url), 'utf8')) as {
  vectors: { normal: string; jumbled: string }[];
};

test('base58check decodes the zero-hash transparent vectors from zcash_address', () => {
  assert.equal(hex(base58CheckDecode('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs')!), '1cb8' + '00'.repeat(20));
  assert.equal(hex(base58CheckDecode('t3JZcvsuaXE6ygokL4XUiZSTrQBUoPYFnXJ')!), '1cbd' + '00'.repeat(20));
  assert.equal(hex(base58CheckDecode('tm9iMLAuYMzJ6jtFLcA7rzUmfreGuKvr7Ma')!), '1d25' + '00'.repeat(20));
  assert.equal(hex(base58CheckDecode('t26YoyZ1iPgiMEWL4zGUm74eVWfhyDMXzY2')!), '1cba' + '00'.repeat(20));
});

test('base58check rejects bad checksums and characters', () => {
  assert.equal(base58CheckDecode('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbt'), undefined);
  assert.equal(base58CheckDecode('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLb0'), undefined); // '0' is not base58
  assert.equal(base58CheckDecode(''), undefined);
});

test('base58check round-trips, including leading zero bytes', () => {
  for (const payload of [new Uint8Array([0, 0, 1, 2, 3]), fromHex('1cb8' + 'ab'.repeat(20)), new Uint8Array(0)]) {
    assert.equal(hex(base58CheckDecode(base58CheckEncode(payload))!), hex(payload));
  }
});

test('bech32 decodes the zero Sapling vectors for every network', () => {
  for (const [addr, hrp] of [
    ['zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpq6d8g', 'zs'],
    ['ztestsapling1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfhgwqu', 'ztestsapling'],
    ['zregtestsapling1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqknpr3m', 'zregtestsapling'],
  ] as const) {
    const decoded = bech32Decode(addr)!;
    assert.equal(decoded.hrp, hrp);
    assert.equal(decoded.variant, 'bech32');
    assert.equal(hex(decoded.data), '00'.repeat(43));
  }
});

test('bech32m decodes the TEX vector', () => {
  const decoded = bech32Decode('tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte')!;
  assert.equal(decoded.variant, 'bech32m');
  assert.equal(decoded.hrp, 'tex');
  assert.equal(decoded.data.length, 20);
});

test('bech32 accepts all-uppercase but rejects mixed case and bad checksums', () => {
  const addr = 'zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpq6d8g';
  assert.ok(bech32Decode(addr.toUpperCase()));
  assert.equal(bech32Decode('Zs1' + addr.slice(3)), undefined);
  assert.equal(bech32Decode(addr.slice(0, -1) + 'h'), undefined);
  assert.equal(bech32Decode('zs1qqqqqq'), undefined);
});

test('bech32 and bech32m round-trip', () => {
  const data = fromHex('00ff10' + '7a'.repeat(40));
  for (const variant of ['bech32', 'bech32m'] as const) {
    const decoded = bech32Decode(bech32Encode('uregtest', data, variant))!;
    assert.equal(decoded.variant, variant);
    assert.equal(hex(decoded.data), hex(data));
  }
});

test('f4jumble matches the zcash-test-vectors vectors in both directions', () => {
  assert.equal(f4.vectors.length, 8);
  for (const v of f4.vectors) {
    assert.equal(hex(f4jumble(fromHex(v.normal))), v.jumbled);
    assert.equal(hex(f4jumbleInverse(fromHex(v.jumbled))), v.normal);
  }
});

test('f4jumble rejects inputs shorter than 48 bytes', () => {
  assert.throws(() => f4jumble(new Uint8Array(47)), RangeError);
});
